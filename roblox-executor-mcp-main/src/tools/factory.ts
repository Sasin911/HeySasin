import {
  GetResponseOfIdFromClient,
  SendArbitraryDataToClient,
  getInstanceRole,
} from "../bridge/handlers/shared/communication.js";
import { getActiveClientId } from "../bridge/handlers/shared/registry.js";
import { RobloxResponse } from "../bridge/types.js";
import { BASE_URL, WS_PORT } from "../config.js";
import { INVALID_CLIENT_ERROR, NO_CLIENT_ERROR } from "./errors.js";

/**
 * Check if the current instance is a secondary relay.
 * Secondaries can be created either via --baseurl or automatically when
 * the port is already in use (EADDRINUSE fallback).
 */
export function isSecondaryRelay(): boolean {
  return getInstanceRole() === "secondary";
}

/**
 * Get the base URL of the primary server.
 * If --baseurl was specified, use that. Otherwise fall back to localhost.
 */
function getPrimaryBaseUrl(): string {
  if (BASE_URL) return BASE_URL.replace(/\/$/, "");
  return `http://localhost:${WS_PORT}`;
}

/**
 * Relay a tool call to the primary's /api/tool HTTP endpoint.
 * Handles both immediate results and progress-job-based async responses
 * (polls /api/tool-progress until done).
 */
export async function relayToolToApi(
  type: string,
  params: Record<string, unknown>,
  timeoutMs: number = 60000
): Promise<ToolTextResponse> {
  const primaryBase = getPrimaryBaseUrl();
  const toolUrl = primaryBase + "/api/tool";
  const activeClientId = getActiveClientId();

  try {
    const resp = await fetch(toolUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        ...(activeClientId ? { clientId: activeClientId } : {}),
        ...params,
      }),
    });

    const data = (await resp.json()) as Record<string, unknown>;

    if (data.error) {
      return { content: [{ type: "text", text: data.error as string }], isError: true };
    }

    // Immediate result
    if (data.result !== undefined) {
      return { content: [{ type: "text", text: data.result as string }] };
    }

    // Progress-job based (semantic search/index)
    if (data.jobId && data.progressUrl) {
      const progressUrl = primaryBase + (data.progressUrl as string);
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));

        const progressResp = await fetch(progressUrl);
        const job = (await progressResp.json()) as Record<string, unknown>;

        if (job.status === "done") {
          return { content: [{ type: "text", text: (job.result as string) ?? "Done." }] };
        }
        if (job.status === "failed") {
          return {
            content: [{ type: "text", text: `Failed: ${(job.error as string) ?? "Unknown error"}` }],
            isError: true,
          };
        }
      }

      return { content: [{ type: "text", text: "Timed out waiting for primary to complete." }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Failed to relay to primary: ${(err as Error).message || err}` }],
      isError: true,
    };
  }
}

export interface ToolTextResponse {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface SendAndWaitOptions {
  type: string;
  data: Record<string, unknown>;
  timeoutMs?: number;
  failureField?: "output" | "error";
  failureMessage?: (response: RobloxResponse | undefined) => string;
  successMessage?: (response: RobloxResponse) => string;
}

/**
 * Dispatch a request to the Roblox client and wait for the response.
 * Handles the no-client / invalid-client / timeout boilerplate that every
 * tool used to repeat.
 */
export async function sendAndWait(options: SendAndWaitOptions): Promise<ToolTextResponse> {
  const callId = SendArbitraryDataToClient(
    options.type,
    options.data,
    undefined,
    getActiveClientId()
  );

  if (callId === null) return NO_CLIENT_ERROR;
  if (callId === "INVALID_CLIENT") return INVALID_CLIENT_ERROR;

  const response = await GetResponseOfIdFromClient(callId, options.timeoutMs);

  const failureField = options.failureField ?? "output";

  const isFailure =
    response === undefined ||
    (failureField === "error"
      ? response.error !== undefined
      : response.output === undefined);

  if (isFailure) {
    const text =
      options.failureMessage?.(response) ??
      `Failed to ${options.type}. Response: ${JSON.stringify(response)}`;
    return { content: [{ type: "text", text }] };
  }

  const text =
    options.successMessage?.(response) ?? (response.output as string);
  return { content: [{ type: "text", text }] };
}

export interface FireAndForgetOptions {
  type: string;
  data: Record<string, unknown>;
  successMessage: string;
}

/**
 * Dispatch a request without waiting for a response.
 * Returns a success message once the request has been queued/sent.
 */
export function sendFireAndForget(options: FireAndForgetOptions): ToolTextResponse {
  const callId = SendArbitraryDataToClient(
    options.type,
    options.data,
    undefined,
    getActiveClientId()
  );

  if (callId === null) return NO_CLIENT_ERROR;
  if (callId === "INVALID_CLIENT") return INVALID_CLIENT_ERROR;

  return { content: [{ type: "text", text: options.successMessage }] };
}

