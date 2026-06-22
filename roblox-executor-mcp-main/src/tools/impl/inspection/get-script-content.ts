import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";
import { isSecondaryRelay, relayToolToApi } from "../../factory.js";
import { fetchScriptSearchIndex, type ScriptSearchDocument } from "./script-sources.js";

function formatSourceRange(source: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined) return source;

  const lines = source.split(/\r?\n/);
  const totalLines = lines.length;
  const start = Math.max(1, Math.min(Math.floor(startLine), totalLines));
  const end =
    endLine === undefined
      ? totalLines
      : Math.max(start, Math.min(Math.floor(endLine), totalLines));

  return `-- Lines ${start}-${end} of ${totalLines}\n` + lines.slice(start - 1, end).join("\n");
}

function findStoredScript(
  scripts: ScriptSearchDocument[],
  scriptPath?: string,
  debugId?: string
): ScriptSearchDocument | undefined {
  if (debugId !== undefined) {
    return scripts.find((script) => script.debugId === debugId);
  }

  return scripts.find((script) => script.path === scriptPath);
}

export default function register(server: McpServer): void {
  server.registerTool(
    "get-script-content",
    {
      title: "Get the content of a script in the Roblox Game Client",
      description:
        "Get decompiled source for a Roblox script by path, script proxy, or getter code. Use startLine/endLine for a focused range when the full script is large.",
      inputSchema: z.object({
        scriptGetterSource: z
          .string()
          .describe(
            "The code that fetches the script object from the game (should return a script object, and MUST be client-side only, will not work on Scripts with RunContext set to Server)"
          )
          .optional(),
        scriptPath: z
          .string()
          .describe(
            "The path to the script to get the content of. If passing a GC'd script proxy (e.g. <ScriptProxy: 1_316566>), use the literal angle brackets < > — do NOT HTML-encode them as &lt; or &gt;."
          )
          .optional(),
        startLine: z
          .number()
          .describe(
            "Optional start line number (1-based) to return only a range of lines from the decompiled script. If omitted, returns the full script."
          )
          .optional(),
        endLine: z
          .number()
          .describe(
            "Optional end line number (1-based, inclusive) to return only a range of lines. Defaults to end of script if startLine is set but endLine is omitted."
          )
          .optional(),
      }),
    },
    async ({ scriptGetterSource, scriptPath, startLine, endLine }) => {
      // Secondary mode: relay to primary which has the script source index.
      if (isSecondaryRelay()) {
        return relayToolToApi("get-script-content", {
          ...(scriptGetterSource !== undefined ? { scriptGetterSource } : {}),
          ...(scriptPath !== undefined ? { scriptPath } : {}),
          ...(startLine !== undefined ? { startLine } : {}),
          ...(endLine !== undefined ? { endLine } : {}),
        });
      }

      if (scriptGetterSource === undefined && scriptPath === undefined) {
        return {
          content: [
            { type: "text" as const, text: "Must provide either scriptGetterSource or scriptPath." },
          ],
        };
      } else if (scriptGetterSource !== undefined && scriptPath !== undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Must provide either scriptGetterSource or scriptPath, not both.",
            },
          ],
        };
      }

      const scriptProxyMatch = (scriptPath ?? scriptGetterSource ?? "").match(/^<ScriptProxy: (.+)>$/);

      if (scriptPath !== undefined) {
        const indexResult = fetchScriptSearchIndex({ allowIncomplete: true });
        if (indexResult.ok) {
          const storedScript = findStoredScript(
            indexResult.index.scripts,
            scriptPath,
            scriptProxyMatch?.[1]
          );

          if (storedScript) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: formatSourceRange(storedScript.source, startLine, endLine),
                },
              ],
            };
          }
        } else if (scriptProxyMatch) {
          return indexResult.response;
        }
      }

      const data = scriptProxyMatch
        ? { debugId: scriptProxyMatch[1], startLine, endLine }
        : {
            source:
              scriptGetterSource === undefined ? `return ${scriptPath}` : scriptGetterSource,
            startLine,
            endLine,
          };

      return sendAndWait({
        type: "get-script-content",
        data,
        failureMessage: () => "Failed to get script content.",
      });
    }
  );
}
