import crypto from "crypto";
import { clearSemanticIndexForClient } from "../../../semantic/vector-index.js";

export interface StoredScriptSource {
  debugId: string;
  path: string;
  source: string;
  sourceHash: string;
  updatedAt: number;
}

export interface ScriptSourceIndex {
  clientId: string;
  placeId: number;
  jobId: string;
  hasFinishedMapping: boolean;
  mappedSources: number;
  processedSources: number;
  skippedSources: number;
  sourcesToMap: number;
  scripts: StoredScriptSource[];
}

export interface ScriptSourceStoreIdentity {
  clientId: string;
  placeId: number;
  jobId: string;
}

interface ClientScriptSourceStore {
  placeId: number;
  jobId: string;
  hasFinishedMapping: boolean;
  processedSources: number;
  skippedSources: number;
  sourcesToMap: number;
  scripts: Map<string, StoredScriptSource>;
}

export interface UpsertScriptSourcesInput {
  hasFinishedMapping?: boolean;
  sourcesToMap?: number;
  processedSources?: number;
  skippedSources?: number;
  scripts?: {
    debugId?: unknown;
    path?: unknown;
    source?: unknown;
  }[];
}

const storesByClientId: Map<string, ClientScriptSourceStore> = new Map();

function hashSource(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function getOrCreateStore(identity: ScriptSourceStoreIdentity): ClientScriptSourceStore {
  let store = storesByClientId.get(identity.clientId);
  if (!store || store.placeId !== identity.placeId || store.jobId !== identity.jobId) {
    if (store) clearSemanticIndexForClient(identity.clientId);
    store = {
      placeId: identity.placeId,
      jobId: identity.jobId,
      hasFinishedMapping: false,
      processedSources: 0,
      skippedSources: 0,
      sourcesToMap: 0,
      scripts: new Map(),
    };
    storesByClientId.set(identity.clientId, store);
  }
  return store;
}

export function upsertScriptSources(
  identity: ScriptSourceStoreIdentity,
  input: UpsertScriptSourcesInput
): ScriptSourceIndex {
  const store = getOrCreateStore(identity);

  if (typeof input.hasFinishedMapping === "boolean") {
    store.hasFinishedMapping = input.hasFinishedMapping;
  }

  if (typeof input.sourcesToMap === "number" && Number.isFinite(input.sourcesToMap)) {
    store.sourcesToMap = Math.max(0, Math.floor(input.sourcesToMap));
  }

  if (typeof input.processedSources === "number" && Number.isFinite(input.processedSources)) {
    store.processedSources = Math.max(0, Math.floor(input.processedSources));
  }

  if (typeof input.skippedSources === "number" && Number.isFinite(input.skippedSources)) {
    store.skippedSources = Math.max(0, Math.floor(input.skippedSources));
  }

  for (const script of input.scripts ?? []) {
    if (
      typeof script.debugId !== "string" ||
      typeof script.path !== "string" ||
      typeof script.source !== "string"
    ) {
      continue;
    }

    const existing = store.scripts.get(script.debugId);
    const sourceHash = hashSource(script.source);

    if (existing && existing.sourceHash === sourceHash) {
      store.scripts.set(script.debugId, {
        ...existing,
        path: script.path,
      });
      continue;
    }

    store.scripts.set(script.debugId, {
      debugId: script.debugId,
      path: script.path,
      source: script.source,
      sourceHash,
      updatedAt: Date.now(),
    });
  }

  return getScriptSourceIndex(identity);
}

export function getScriptSourceIndex(identity: ScriptSourceStoreIdentity): ScriptSourceIndex {
  const store = getOrCreateStore(identity);
  return {
    clientId: identity.clientId,
    placeId: store.placeId,
    jobId: store.jobId,
    hasFinishedMapping: store.hasFinishedMapping,
    mappedSources: store.scripts.size,
    processedSources: Math.max(store.processedSources, store.scripts.size),
    skippedSources: store.skippedSources,
    sourcesToMap: store.sourcesToMap,
    scripts: [...store.scripts.values()],
  };
}

export function clearScriptSourceIndex(clientId: string): void {
  storesByClientId.delete(clientId);
  clearSemanticIndexForClient(clientId);
}
