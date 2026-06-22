import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "clear-remote-spy-logs",
    {
      title: "Clear all remote spy logs",
      description:
        "Clear all captured Cobalt remote spy logs. Requires ensure-remote-spy first.",
      inputSchema: z.object({}),
    },
    async () =>
      sendAndWait({
        type: "clear-remote-spy-logs",
        data: {},
        failureMessage: (response) =>
          "Failed to clear remote spy logs. Response: " + JSON.stringify(response),
      })
  );
}
