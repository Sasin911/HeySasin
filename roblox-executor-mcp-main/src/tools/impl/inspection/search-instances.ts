import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "search-instances",
    {
      title: "Search for instances in the game",
      description:
        "Search Roblox instances with QueryDescendants selector syntax. Use for class, name, tag, property, and attribute queries against a chosen root.",
      inputSchema: z.object({
        selector: z
          .string()
          .describe(
            "Selector string to filter instances. Supports classes (Part), tags (.Tagged), names (#HumanoidRootPart), properties ([CanCollide = false]), attributes ([$QuestId] or [$Health = 100]), child/descendant combinators (> and >>), OR selectors (,), :not(), and :has(); chain selectors for AND logic, e.g. Part.Tagged[Anchored = false]."
          ),
        root: z
          .string()
          .describe(
            "The root instance to search from (e.g., 'game.Workspace', 'game.ReplicatedStorage'). Defaults to 'game' if not specified."
          )
          .optional()
          .default("game"),
        limit: z
          .number()
          .describe("Maximum number of results to return (default: 50, to avoid overwhelming output)")
          .optional()
          .default(50),
      }),
    },
    async ({ selector, root, limit }) =>
      sendAndWait({
        type: "search-instances",
        data: { selector, root, limit },
        failureMessage: (response) =>
          "Failed to search instances. Response: " + JSON.stringify(response),
      })
  );
}
