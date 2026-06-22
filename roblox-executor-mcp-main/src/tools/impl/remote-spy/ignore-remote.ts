import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "ignore-remote",
    {
      title: "Ignore or unignore a remote",
      description:
        "Ignore or unignore logging for a Roblox remote by exact name and direction. Requires ensure-remote-spy first; ignored remotes still fire.",
      inputSchema: z.object({
        remoteName: z.string().describe("The exact name of the remote to ignore/unignore"),
        direction: z
          .enum(["Incoming", "Outgoing"])
          .describe("Whether the remote is Incoming or Outgoing"),
        shouldIgnore: z
          .boolean()
          .describe("true to ignore, false to unignore")
          .optional()
          .default(true),
      }),
    },
    async ({ remoteName, direction, shouldIgnore }) =>
      sendAndWait({
        type: "ignore-remote",
        data: { remoteName, direction, shouldIgnore },
        failureMessage: (response) =>
          "Failed to ignore/unignore remote. Response: " + JSON.stringify(response),
      })
  );
}
