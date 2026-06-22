import {
  getActiveClientId,
  resolveTargetClient,
} from "../../../bridge/handlers/shared/registry.js";
import {
  getScriptSourceIndex,
  type ScriptSourceIndex,
  type StoredScriptSource,
} from "../../../bridge/handlers/shared/script-source-store.js";
import type { ToolTextResponse } from "../../factory.js";
import { INVALID_CLIENT_ERROR, NO_CLIENT_ERROR } from "../../errors.js";

export type ScriptSearchDocument = StoredScriptSource;
export type ScriptSearchIndex = ScriptSourceIndex;

export type ScriptSearchIndexResult =
  | { ok: true; index: ScriptSearchIndex }
  | { ok: false; response: ToolTextResponse };

export function fetchScriptSearchIndex(
  options: { allowIncomplete?: boolean } = {}
): ScriptSearchIndexResult {
  const selectedClientId = getActiveClientId();
  const target = resolveTargetClient(selectedClientId);

  if (!target) {
    return {
      ok: false,
      response: selectedClientId ? INVALID_CLIENT_ERROR : NO_CLIENT_ERROR,
    };
  }

  const index = getScriptSourceIndex({
    clientId: target.clientId,
    placeId: target.placeId,
    jobId: target.jobId,
  });

  if (!options.allowIncomplete && !index.hasFinishedMapping) {
    return {
      ok: false,
      response: {
        content: [
          {
            type: "text",
            text:
              "The MCP server is still receiving script sources from the Roblox client " +
              `(${index.processedSources}/${index.sourcesToMap} processed, ${index.mappedSources} uploaded). Please try again later.`,
          },
        ],
      },
    };
  }

  if (index.scripts.length === 0) {
    return {
      ok: false,
      response: {
        content: [
          {
            type: "text",
            text: "No script sources have been received from the Roblox client yet.",
          },
        ],
      },
    };
  }

  return { ok: true, index };
}
