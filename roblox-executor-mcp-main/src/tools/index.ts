import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import registerSetActiveClient from "./impl/clients/set-active-client.js";
import registerListClients from "./impl/clients/list-clients.js";

import registerExecute from "./impl/execution/execute.js";
import registerExecuteFile from "./impl/execution/execute-file.js";

import registerGetScriptContent from "./impl/inspection/get-script-content.js";
import registerGetDataByCode from "./impl/inspection/get-data-by-code.js";
import registerGetConsoleOutput from "./impl/inspection/get-console-output.js";
import registerSearchInstances from "./impl/inspection/search-instances.js";
import registerScriptGrep from "./impl/inspection/script-grep.js";
import registerSemanticSearchScripts from "./impl/inspection/semantic-search-scripts.js";
import registerGetGameInfo from "./impl/inspection/get-game-info.js";
import registerGetDescendantsTree from "./impl/inspection/get-descendants-tree.js";

import registerEnsureRemoteSpy from "./impl/remote-spy/ensure-remote-spy.js";
import registerGetRemoteSpyLogs from "./impl/remote-spy/get-remote-spy-logs.js";
import registerClearRemoteSpyLogs from "./impl/remote-spy/clear-remote-spy-logs.js";
import registerBlockRemote from "./impl/remote-spy/block-remote.js";
import registerIgnoreRemote from "./impl/remote-spy/ignore-remote.js";

import registerTypeTextBox from "./impl/gui/type-text-box.js";
import registerClickButton from "./impl/gui/click-button.js";

import registerScreenshotWindow from "./impl/windows/screenshot-window.js";
import registerListRobloxWindows from "./impl/windows/list-roblox-windows.js";

export function registerAllTools(server: McpServer): void {
  registerSetActiveClient(server);

  registerListClients(server);

  registerExecute(server);
  registerExecuteFile(server);

  registerGetScriptContent(server);
  registerGetDataByCode(server);
  registerGetConsoleOutput(server);
  registerSearchInstances(server);
  registerScriptGrep(server);
  registerSemanticSearchScripts(server);
  registerGetGameInfo(server);
  registerGetDescendantsTree(server);

  registerEnsureRemoteSpy(server);
  registerGetRemoteSpyLogs(server);
  registerClearRemoteSpyLogs(server);
  registerBlockRemote(server);
  registerIgnoreRemote(server);

  registerTypeTextBox(server);
  registerClickButton(server);

  registerScreenshotWindow(server);
  registerListRobloxWindows(server);
}
