import type { ScriptSourceIndex, StoredScriptSource } from "../bridge/handlers/shared/script-source-store.js";
import {
  readPersistedEmbedding,
  writePersistedEmbeddings,
} from "./embedding-cache.js";
import { embedTexts } from "./embeddings.js";
import type { SemanticSettings } from "./settings.js";
import { getSemanticProviderModel } from "./settings.js";

const CHUNK_LINES = 80;
const CHUNK_OVERLAP_LINES = 20;
const CHUNKING_VERSION = "lines-80-overlap-20-v1";
const OPENAI_EMBEDDING_BATCH_SIZE = 64;
const OLLAMA_EMBEDDING_BATCH_SIZE = 8;

export interface SemanticSearchResult {
  path: string;
  debugId: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export interface SemanticSearchProgress {
  message: string;
  completed: number;
  total: number;
}

interface ScriptChunk {
  id: string;
  embeddingId: string;
  debugId: string;
  path: string;
  startLine: number;
  endLine: number;
  body: string;
}

interface SourceChunkTemplate {
  embeddingId: string;
  startLine: number;
  endLine: number;
  body: string;
}

interface SemanticVectorSession {
  vectors: Map<string, number[]>;
}

const vectorSessionsByKey: Map<string, SemanticVectorSession> = new Map();
const sourceChunkTemplatesByHash: Map<string, SourceChunkTemplate[]> = new Map();
const inFlightEmbeddingsByKey: Map<string, Promise<number[]>> = new Map();

function sessionKey(index: ScriptSourceIndex, settings: SemanticSettings): string {
  return [
    index.clientId,
    index.placeId,
    index.jobId,
    settings.provider,
    getSemanticProviderModel(settings),
    CHUNKING_VERSION,
  ].join(":");
}

function chunkId(script: StoredScriptSource, startLine: number, endLine: number): string {
  return [script.debugId, script.sourceHash, startLine, endLine].join(":");
}

function chunkTemplatesForSource(script: StoredScriptSource): SourceChunkTemplate[] {
  const cached = sourceChunkTemplatesByHash.get(script.sourceHash);
  if (cached) return cached;

  const lines = script.source.split(/\r?\n/);
  const chunks: SourceChunkTemplate[] = [];

  for (let startIndex = 0; startIndex < lines.length; ) {
    const endIndex = Math.min(lines.length, startIndex + CHUNK_LINES);
    const startLine = startIndex + 1;
    const endLine = endIndex;
    const body = lines.slice(startIndex, endIndex).join("\n").trim();

    if (body) {
      chunks.push({
        embeddingId: [script.sourceHash, startLine, endLine].join(":"),
        startLine,
        endLine,
        body,
      });
    }

    if (endIndex >= lines.length) break;
    startIndex = Math.max(endIndex - CHUNK_OVERLAP_LINES, startIndex + 1);
  }

  sourceChunkTemplatesByHash.set(script.sourceHash, chunks);
  return chunks;
}

function chunkScript(script: StoredScriptSource): ScriptChunk[] {
  return chunkTemplatesForSource(script).map((chunk) => ({
    id: chunkId(script, chunk.startLine, chunk.endLine),
    embeddingId: chunk.embeddingId,
    debugId: script.debugId,
    path: script.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    body: chunk.body,
  }));
}

function buildChunks(scripts: StoredScriptSource[]): ScriptChunk[] {
  return scripts.flatMap(chunkScript);
}

function getOrCreateSession(key: string): SemanticVectorSession {
  const session = vectorSessionsByKey.get(key) ?? { vectors: new Map<string, number[]>() };
  vectorSessionsByKey.set(key, session);
  return session;
}

function getEmbeddingBatchSize(settings: SemanticSettings): number {
  return settings.provider === "ollama" ? OLLAMA_EMBEDDING_BATCH_SIZE : OPENAI_EMBEDDING_BATCH_SIZE;
}

function persistentEmbeddingKey(settings: SemanticSettings, embeddingId: string): string {
  return JSON.stringify([
    settings.provider,
    settings.provider === "openai" ? settings.openaiBaseUrl : settings.ollamaBaseUrl,
    getSemanticProviderModel(settings),
    CHUNKING_VERSION,
    embeddingId,
  ]);
}

function uniqueChunksByEmbedding(chunks: ScriptChunk[]): ScriptChunk[] {
  return [...new Map(chunks.map((chunk) => [chunk.embeddingId, chunk])).values()];
}

function pruneStaleVectors(session: SemanticVectorSession, chunks: ScriptChunk[]): void {
  const currentEmbeddingIds = new Set(chunks.map((chunk) => chunk.embeddingId));
  for (const embeddingId of session.vectors.keys()) {
    if (!currentEmbeddingIds.has(embeddingId)) session.vectors.delete(embeddingId);
  }
}

function countEmbeddedChunkAliases(session: SemanticVectorSession, chunks: ScriptChunk[]): number {
  let embeddedChunks = 0;
  for (const chunk of chunks) {
    if (session.vectors.has(chunk.embeddingId)) embeddedChunks += 1;
  }
  return embeddedChunks;
}

export function getSemanticIndexStats(
  index: ScriptSourceIndex,
  settings: SemanticSettings
): {
  chunkCount: number;
  embeddedChunks: number;
  uniqueChunkCount: number;
  embeddedUniqueChunks: number;
} {
  const chunks = buildChunks(index.scripts);
  const key = sessionKey(index, settings);
  const session = vectorSessionsByKey.get(key);
  const uniqueChunks = uniqueChunksByEmbedding(chunks);

  if (!session) {
    return {
      chunkCount: chunks.length,
      embeddedChunks: 0,
      uniqueChunkCount: uniqueChunks.length,
      embeddedUniqueChunks: 0,
    };
  }

  pruneStaleVectors(session, chunks);
  const embeddedChunks = countEmbeddedChunkAliases(session, chunks);
  const embeddedUniqueChunks = uniqueChunks.filter((chunk) =>
    session.vectors.has(chunk.embeddingId)
  ).length;

  return {
    chunkCount: chunks.length,
    embeddedChunks,
    uniqueChunkCount: uniqueChunks.length,
    embeddedUniqueChunks,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch (${a.length} vs ${b.length}).`);
  }

  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;

  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aMagnitude += av * av;
    bMagnitude += bv * bv;
  }

  if (aMagnitude === 0 || bMagnitude === 0) return 0;
  return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}

function formatSnippet(chunk: ScriptChunk): string {
  const lines = chunk.body.split("\n");
  const snippetLines = lines.slice(0, 24).map((line, index) => {
    return `${chunk.startLine + index}: ${line}`;
  });

  if (lines.length > snippetLines.length) {
    snippetLines.push("...");
  }

  return snippetLines.join("\n");
}

async function embedMissingChunks(
  session: SemanticVectorSession,
  sessionCacheKey: string,
  chunks: ScriptChunk[],
  settings: SemanticSettings,
  onProgress?: (progress: SemanticSearchProgress) => void
): Promise<void> {
  pruneStaleVectors(session, chunks);

  const uniqueChunks = uniqueChunksByEmbedding(chunks);
  let loadedFromDisk = 0;

  if (settings.saveEmbeddingsToDisk) {
    for (const chunk of uniqueChunks) {
      if (session.vectors.has(chunk.embeddingId)) continue;

      const embedding = await readPersistedEmbedding(
        persistentEmbeddingKey(settings, chunk.embeddingId)
      );
      if (!embedding) continue;

      session.vectors.set(chunk.embeddingId, embedding);
      loadedFromDisk += 1;
    }
  }

  const missing = uniqueChunks.filter((chunk) => !session.vectors.has(chunk.embeddingId));
  const waitingForExisting: Promise<void>[] = [];
  const toEmbed: ScriptChunk[] = [];

  for (const chunk of missing) {
    const inFlightKey = `${sessionCacheKey}\0${chunk.embeddingId}`;
    const inFlight = inFlightEmbeddingsByKey.get(inFlightKey);
    if (inFlight) {
      waitingForExisting.push(
        inFlight.then((embedding) => {
          session.vectors.set(chunk.embeddingId, embedding);
        })
      );
    } else {
      toEmbed.push(chunk);
    }
  }

  const alreadyEmbedded = countEmbeddedChunkAliases(session, chunks);

  onProgress?.({
    message:
      missing.length === 0
        ? `Using cached embeddings for ${chunks.length} chunks`
        : `Embedding ${toEmbed.length} unique chunks (${alreadyEmbedded} chunk hits cached, ${loadedFromDisk} loaded from disk, ${waitingForExisting.length} already running)`,
    completed: alreadyEmbedded,
    total: chunks.length,
  });

  const batchSize = getEmbeddingBatchSize(settings);
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const embeddingPromise = embedTexts(
      settings,
      batch.map((chunk) => chunk.body)
    );

    for (let j = 0; j < batch.length; j += 1) {
      const chunk = batch[j]!;
      const chunkPromise = embeddingPromise.then((embeddings) => {
        const embedding = embeddings[j];
        if (!embedding) {
          throw new Error("Embedding provider returned fewer vectors than expected.");
        }
        return embedding;
      });
      chunkPromise.catch(() => undefined);
      inFlightEmbeddingsByKey.set(`${sessionCacheKey}\0${chunk.embeddingId}`, chunkPromise);
    }

    try {
      const embeddings = await embeddingPromise;
      for (let j = 0; j < batch.length; j += 1) {
        const chunk = batch[j]!;
        const embedding = embeddings[j];
        if (!embedding) continue;
        session.vectors.set(chunk.embeddingId, embedding);
      }

      if (settings.saveEmbeddingsToDisk) {
        await writePersistedEmbeddings(
          batch.flatMap((chunk, index) => {
            const embedding = embeddings[index];
            return embedding
              ? [{ key: persistentEmbeddingKey(settings, chunk.embeddingId), embedding }]
              : [];
          })
        ).catch((error) => {
          console.error(`[Semantic] Failed to save embedding cache: ${String(error)}`);
        });
      }
    } finally {
      for (const chunk of batch) {
        inFlightEmbeddingsByKey.delete(`${sessionCacheKey}\0${chunk.embeddingId}`);
      }
    }

    onProgress?.({
      message: `Embedded ${Math.min(i + batch.length, toEmbed.length)} of ${toEmbed.length} new unique chunks`,
      completed: countEmbeddedChunkAliases(session, chunks),
      total: chunks.length,
    });

    await new Promise((resolve) => setImmediate(resolve));
  }

  if (waitingForExisting.length > 0) {
    await Promise.all(waitingForExisting);
    onProgress?.({
      message: "Reused embeddings from another running index job",
      completed: countEmbeddedChunkAliases(session, chunks),
      total: chunks.length,
    });
  }
}

export interface SemanticSearchOutput {
  results: SemanticSearchResult[];
  chunkCount: number;
  embeddedChunks: number;
  isPartialIndex: boolean;
}

export async function semanticSearchScripts(
  index: ScriptSourceIndex,
  settings: SemanticSettings,
  query: string,
  limit: number,
  minScore?: number,
  onProgress?: (progress: SemanticSearchProgress) => void
): Promise<SemanticSearchOutput> {
  const chunks = buildChunks(index.scripts);
  onProgress?.({
    message: index.hasFinishedMapping
      ? `Prepared ${chunks.length} code chunks`
      : `Prepared ${chunks.length} code chunks while scripts are still syncing (${index.mappedSources}/${index.sourcesToMap})`,
    completed: 0,
    total: chunks.length,
  });

  const key = sessionKey(index, settings);
  const session = getOrCreateSession(key);

  // Load any persisted embeddings from disk without generating new ones
  if (settings.saveEmbeddingsToDisk) {
    const uniqueChunks = uniqueChunksByEmbedding(chunks);
    for (const chunk of uniqueChunks) {
      if (session.vectors.has(chunk.embeddingId)) continue;
      const embedding = await readPersistedEmbedding(
        persistentEmbeddingKey(settings, chunk.embeddingId)
      );
      if (embedding) session.vectors.set(chunk.embeddingId, embedding);
    }
  }

  // Check how many chunks already have embeddings
  const embeddedCount = countEmbeddedChunkAliases(session, chunks);
  const uniqueChunks = uniqueChunksByEmbedding(chunks);
  const embeddedUniqueCount = uniqueChunks.filter((c) => session.vectors.has(c.embeddingId)).length;
  const totalUniqueCount = uniqueChunks.length;
  const isFullyIndexed = embeddedUniqueCount >= totalUniqueCount;

  if (isFullyIndexed) {
    // Fully indexed — embed any remaining aliases and search
    await embedMissingChunks(session, key, chunks, settings, onProgress);
  } else if (embeddedCount > 0) {
    // Partially indexed — skip blocking embed, search from what we have
    onProgress?.({
      message: `Searching from ${embeddedCount}/${chunks.length} cached embeddings (index incomplete: ${embeddedUniqueCount}/${totalUniqueCount} unique chunks)`,
      completed: embeddedCount,
      total: chunks.length,
    });
  } else {
    // No embeddings at all — must embed everything
    await embedMissingChunks(session, key, chunks, settings, onProgress);
  }

  onProgress?.({
    message: "Embedding query",
    completed: chunks.length,
    total: chunks.length + 1,
  });

  const [queryEmbedding] = await embedTexts(settings, [query]);
  if (!queryEmbedding) throw new Error("Embedding provider returned no query vector.");

  onProgress?.({
    message: "Ranking chunks",
    completed: chunks.length + 1,
    total: chunks.length + 1,
  });

  const scored: SemanticSearchResult[] = [];
  const finalEmbeddedCount = countEmbeddedChunkAliases(session, chunks);

  for (const chunk of chunks) {
    const embedding = session.vectors.get(chunk.embeddingId);
    if (!embedding) continue;

    const score = cosineSimilarity(queryEmbedding, embedding);
    if (minScore !== undefined && score < minScore) continue;

    scored.push({
      path: chunk.path,
      debugId: chunk.debugId,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score,
      snippet: formatSnippet(chunk),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    results: scored.slice(0, Math.max(0, Math.floor(limit))),
    chunkCount: chunks.length,
    embeddedChunks: finalEmbeddedCount,
    isPartialIndex: finalEmbeddedCount < chunks.length,
  };
}

export async function semanticIndexCodebase(
  index: ScriptSourceIndex,
  settings: SemanticSettings,
  onProgress?: (progress: SemanticSearchProgress) => void
): Promise<{ chunkCount: number; embeddedChunks: number }> {
  const chunks = buildChunks(index.scripts);
  onProgress?.({
    message: index.hasFinishedMapping
      ? `Prepared ${chunks.length} code chunks`
      : `Prepared ${chunks.length} code chunks while scripts are still syncing (${index.mappedSources}/${index.sourcesToMap})`,
    completed: 0,
    total: chunks.length,
  });

  const key = sessionKey(index, settings);
  const session = getOrCreateSession(key);

  await embedMissingChunks(session, key, chunks, settings, onProgress);
  return getSemanticIndexStats(index, settings);
}

export function clearSemanticIndexForClient(clientId: string): void {
  for (const key of vectorSessionsByKey.keys()) {
    if (key.startsWith(`${clientId}:`)) {
      vectorSessionsByKey.delete(key);
    }
  }

  for (const key of inFlightEmbeddingsByKey.keys()) {
    if (key.startsWith(`${clientId}:`)) {
      inFlightEmbeddingsByKey.delete(key);
    }
  }
}

export function clearAllSemanticIndexes(): void {
  vectorSessionsByKey.clear();
  inFlightEmbeddingsByKey.clear();
}

export function getScriptIndexStatus(
  debugId: string,
  index: ScriptSourceIndex,
  settings: SemanticSettings
): { totalChunks: number; embeddedChunks: number; isFullyIndexed: boolean } {
  const script = index.scripts.find((s) => s.debugId === debugId);
  if (!script) return { totalChunks: 0, embeddedChunks: 0, isFullyIndexed: false };

  const templates = chunkTemplatesForSource(script);
  const key = sessionKey(index, settings);
  const session = vectorSessionsByKey.get(key);

  if (!session || templates.length === 0) {
    return { totalChunks: templates.length, embeddedChunks: 0, isFullyIndexed: false };
  }

  let embedded = 0;
  for (const chunk of templates) {
    if (session.vectors.has(chunk.embeddingId)) embedded++;
  }

  return { totalChunks: templates.length, embeddedChunks: embedded, isFullyIndexed: embedded >= templates.length };
}
