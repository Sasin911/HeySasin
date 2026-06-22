import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BASE_URL, WS_PORT } from "../../../config.js";
import { getInstanceRole } from "../../../bridge/handlers/shared/communication.js";
import {
  isSupported,
  performScreenshot,
  type ScreenshotResult,
} from "../../../platform/windows-screenshot.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "screenshot-window",
    {
      title: "Take a screenshot of a Roblox window",
      description:
        "Capture an actual OS screenshot of a Roblox window via Windows APIs. Provide pid when multiple windows are open; secondary servers relay capture to the primary host.",
      inputSchema: z.object({
        pid: z
          .number()
          .describe(
            "The PID (process ID) of the Roblox window to capture. If omitted and only one Roblox window exists, it is captured automatically. If multiple windows exist and no pid is provided, the tool returns a list of windows for disambiguation."
          )
          .optional(),
      }),
    },
    async ({ pid }) => {
      // Secondary mode: relay to primary via HTTP — works even if this machine isn't Windows.
      if (getInstanceRole() === "secondary") {
        try {
          const primaryBase = BASE_URL ? BASE_URL.replace(/\/$/, "") : `http://localhost:${WS_PORT}`;
          const targetUrl = primaryBase + "/api/screenshot";
          const resp = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid }),
          });
          const result = (await resp.json()) as ScreenshotResult;
          return renderScreenshotResult(result);
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to relay screenshot to primary: ${(err as Error).message || err}`,
              },
            ],
            isError: true,
          };
        }
      }

      if (!isSupported()) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Error: The screenshot-window tool is only available on Windows. The current platform is: " +
                process.platform,
            },
          ],
          isError: true,
        };
      }

      try {
        return renderScreenshotResult(performScreenshot(pid));
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Screenshot failed: ${(err as Error).message || err}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

function renderScreenshotResult(result: ScreenshotResult) {
  if (result.error) {
    return {
      content: [{ type: "text" as const, text: result.error }],
      isError: true,
    };
  }

  if (result.needsDisambiguation && result.windows) {
    const listing = result.windows.map((w) => `  • PID ${w.pid} — "${w.title}"`).join("\n");
    return {
      content: [
        {
          type: "text" as const,
          text:
            "Multiple Roblox windows were found. Please re-call this tool with the `pid` parameter set to the correct process:\n\n" +
            listing,
        },
      ],
    };
  }

  if (result.imageBase64) {
    return {
      content: [
        {
          type: "image" as const,
          data: result.imageBase64,
          mimeType: "image/png",
        },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: "Screenshot failed: unexpected result." }],
    isError: true,
  };
}
