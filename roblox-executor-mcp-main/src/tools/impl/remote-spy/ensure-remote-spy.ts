import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "ensure-remote-spy",
    {
      title: "Ensure the Cobalt remote spy is loaded",
      description:
        "Load or verify the Cobalt remote spy in the active Roblox client. Call before reading, clearing, blocking, or ignoring remote spy logs.",
      inputSchema: z.object({}),
    },
    async () =>
      sendAndWait({
        type: "ensure-remote-spy",
        data: {},
        failureMessage: (response) =>
          "Failed to ensure remote spy. Response: " + JSON.stringify(response),
      })
  );
}
