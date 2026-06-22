import type { IncomingMessage, ServerResponse } from "http";
import { getClientById } from "../../bridge/handlers/shared/registry.js";

export function GET(_req: IncomingMessage, res: ServerResponse, url: URL): void {
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    res.writeHead(400);
    res.end("Missing clientId query parameter");
    return;
  }

  const client = getClientById(clientId);
  if (!client) {
    res.writeHead(404);
    res.end("Unknown clientId");
    return;
  }

  client.lastHttpPoll = Date.now();

  if (client.pendingHttpCommand) {
    const cmd = client.pendingHttpCommand;
    client.pendingHttpCommand = null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(cmd);
  } else {
    res.writeHead(204);
    res.end();
  }
}
