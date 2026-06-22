import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "get-descendants-tree",
    {
      title: "Get the descendants tree of a Roblox instance",
      description:
        "Get a depth-limited hierarchy of descendants under a Roblox instance. Use for broad structure exploration; use search-instances for selector-based filtering.",
      inputSchema: z.object({
        root: z
          .string()
          .describe(
            "The instance path to get the tree from (e.g., 'game.Workspace', 'game.Workspace.CurrentRooms')"
          ),
        maxDepth: z
          .number()
          .describe(
            "Maximum depth to traverse (default: 3). Higher values return more detail but larger output."
          )
          .optional()
          .default(3),
        classFilter: z
          .string()
          .describe(
            "Optional class name filter — only show instances that IsA this class (e.g., 'BasePart', 'Model'). Leave empty to show all."
          )
          .optional(),
        maxChildren: z
          .number()
          .describe(
            "Maximum number of children to show per node (default: 50). Prevents overwhelming output for large containers."
          )
          .optional()
          .default(50),
      }),
    },
    async ({ root, maxDepth, classFilter, maxChildren }) =>
      sendAndWait({
        type: "get-descendants-tree",
        data: { root, maxDepth, classFilter: classFilter || "", maxChildren },
        failureMessage: (response) =>
          "Failed to get descendants tree. Response: " + JSON.stringify(response),
      })
  );
}
