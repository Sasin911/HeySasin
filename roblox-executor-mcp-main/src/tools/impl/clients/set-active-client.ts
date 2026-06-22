import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setActiveClientId } from "../../../bridge/handlers/shared/registry.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "set-active-client",
    {
      title: "Set active Roblox client",
      description:
        "Route future Roblox tool calls to the specified connected client. Use list-clients first if you need available clientIds.",
      inputSchema: z.object({
        clientId: z
          .string()
          .describe(
            "The client ID to set as active. Use list-clients to get available client IDs."
          ),
      }),
    },
    async ({ clientId }) => {
      setActiveClientId(clientId);
      return {
        content: [{ type: "text" as const, text: `Active client set to ${clientId}.` }],
      };
    }
  );
}
