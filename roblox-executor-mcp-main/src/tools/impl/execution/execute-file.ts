import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs";
import { z } from "zod";
import { sendFireAndForget } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "execute-file",
    {
      title: "Execute a Luau file in the Roblox Game Client",
      description:
        "Execute a local .luau or .lua file in the active Roblox client without returning output. Use get-data-by-code instead when you need returned values.",
      inputSchema: z.object({
        filePath: z
          .string()
          .describe("The absolute path to the .luau or .lua file to execute"),
        threadContext: threadContextSchema,
      }),
    },
    async ({ filePath, threadContext }) => {
      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${filePath}` }],
        };
      }

      const code = fs.readFileSync(filePath, "utf-8");
      console.error(`Executing file ${filePath} in thread ${threadContext}...`);

      return sendFireAndForget({
        type: "execute",
        data: { source: `setthreadidentity(${threadContext})\n${code}` },
        successMessage: `File executed: ${filePath} (thread context ${threadContext})`,
      });
    }
  );
}
