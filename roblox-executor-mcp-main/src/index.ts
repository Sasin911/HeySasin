#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { boot } from "./bridge/boot.js";
import { registerAllTools } from "./tools/index.js";
import { installServerLogCapture } from "./http/server-logs.js";

// Install log capture early so all console.error calls are buffered.
installServerLogCapture();

// Import config for CLI arg parsing and startup logging.
import { SERVER_NAME } from "./config.js";

const server = new McpServer({
  name: SERVER_NAME,
  version: "2.0.0",
  description:
    "Expose MCP tools for inspecting, executing Luau in, and interacting with connected Roblox game clients. Dashboard: http://localhost:16384/.",
});

registerAllTools(server);

const transport = new StdioServerTransport();
server.connect(transport);
console.error("MCP Server started and connected via stdio.");

void boot();
