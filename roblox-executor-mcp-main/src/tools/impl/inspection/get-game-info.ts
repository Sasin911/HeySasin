import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "get-game-info",
    {
      title: "Get information about the current Roblox game",
      description:
        "Get current Roblox place and universe metadata such as PlaceId, GameId, and PlaceVersion.",
      inputSchema: z.object({}),
    },
    async () =>
      sendAndWait({
        type: "get-game-info",
        data: {},
        failureMessage: () => "Failed to get game info.",
      })
  );
}
