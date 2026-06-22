#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLoaderSnippet, SERVER_PORT } from "../src/shared/connector-snippet.mjs";
import { getAutoexecStatus } from "../src/shared/autoexec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const useDist = args.includes("--dist");
const host = readArg("--host") || process.env.HOST || "127.0.0.1";
const port = Number(readArg("--port") || readArg("-p") || process.env.PORT || 18765);
const assetsDir = path.join(repoRoot, useDist ? "dist/http/assets/dashboard" : "src/http/assets/dashboard");
const startedAt = Date.now();

const lanIp = getLocalLanIp() || "10.0.0.4";
const tailscaleIp = process.env.MOCK_TAILSCALE_IP || "100.106.204.90";

const mockSources = new Map([
  [
    "workspace-controller",
    `local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local Controller = {}

function Controller.spawnPart(name)
    local part = Instance.new("Part")
    part.Name = name or "MockPart"
    part.Parent = Workspace
    return part
end

return Controller
`,
  ],
  [
    "workspace-controller-child",
    `local Controller = require(script.Parent)

return function()
    return Controller.spawnPart("ChildPart")
end
`,
  ],
  [
    "ui-bootstrap",
    `local Players = game:GetService("Players")
local player = Players.LocalPlayer

print("Bootstrapping UI for", player and player.Name)
`,
  ],
  [
    "remote-events",
    `local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Remotes = ReplicatedStorage:WaitForChild("Remotes")

Remotes.UseItem.OnClientEvent:Connect(function(itemName)
    print("Using package item", itemName)
end)
`,
  ],
]);

let mockScripts = [
  makeScript("workspace-controller", "Workspace.Controllers.PlayerController", true),
  makeScript("workspace-controller-child", "Workspace.Controllers.PlayerController.Child", false),
  makeScript("ui-bootstrap", "StarterPlayer.StarterPlayerScripts.UIBootstrap", true),
  makeScript("remote-events", "ReplicatedStorage.Packages.Inventory.Remotes", false),
];

const mockClients = [
  {
    clientId: "mock-client-1",
    username: "MockPlayer",
    userId: 0,
    placeName: "Dashboard Dev Place",
    placeId: "123456789",
    jobId: "mock-job-001",
    transport: "ws",
    scriptSync: {
      mappedSources: mockScripts.length,
      processedSources: mockScripts.length,
      skippedSources: 0,
      sourcesToMap: mockScripts.length,
      hasFinishedMapping: true,
    },
    semanticIndex: {
      embeddedChunks: 6,
      chunkCount: 8,
    },
  },
  {
    clientId: "mock-client-2",
    username: "HttpTester",
    userId: 0,
    placeName: "Polling Test Place",
    placeId: "987654321",
    jobId: "mock-job-002",
    transport: "http",
    scriptSync: {
      mappedSources: 1,
      processedSources: 1,
      skippedSources: 0,
      sourcesToMap: 3,
      hasFinishedMapping: false,
    },
    semanticIndex: {
      embeddedChunks: 0,
      chunkCount: 0,
    },
  },
];

let mockSettings = {
  provider: "openai",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "text-embedding-3-small",
  openaiApiKeySet: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "nomic-embed-text",
  saveEmbeddingsToDisk: true,
};

const mockLogs = [
  { timestamp: new Date(startedAt - 40_000).toISOString(), level: "info", message: "Mock dashboard server started." },
  { timestamp: new Date(startedAt - 20_000).toISOString(), level: "info", message: "Registered mock Roblox client mock-client-1." },
  { timestamp: new Date(startedAt - 5_000).toISOString(), level: "warn", message: "This is mock data. No Roblox process is connected." },
];

function readArg(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function getLocalLanIp() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        return entry.address;
      }
    }
  }
  return null;
}

function connector(bridgeUrl) {
  return {
    bridgeUrl,
    loaderSnippet: buildLoaderSnippet(bridgeUrl),
  };
}

function makeScript(debugId, scriptPath, hasEmbeddings) {
  const source = mockSources.get(debugId) || "";
  const lines = source.split("\n").length;
  const bytes = Buffer.byteLength(source, "utf8");
  return {
    debugId,
    path: scriptPath,
    lines,
    bytes,
    hasEmbeddings,
    updatedAt: new Date(startedAt).toISOString(),
  };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function scriptByDebugId(debugId) {
  return mockScripts.find((script) => script.debugId === debugId) || null;
}

function scriptSource(debugId) {
  return mockSources.get(debugId) || "";
}

function searchScripts(query) {
  const q = String(query || "").toLowerCase();
  if (!q) return { files: [], code: [], totalCodeMatches: 0, limited: false };

  const files = [];
  const code = [];
  let totalCodeMatches = 0;

  for (const script of mockScripts) {
    if (script.path.toLowerCase().includes(q) || script.debugId.toLowerCase().includes(q)) {
      files.push(script);
    }

    const matches = [];
    const lines = scriptSource(script.debugId).split("\n");
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      const column = lower.indexOf(q);
      if (column !== -1) {
        matches.push({
          lineNumber: index + 1,
          line,
          ranges: [[column, column + q.length]],
        });
      }
    });

    if (matches.length > 0) {
      totalCodeMatches += matches.length;
      code.push({
        debugId: script.debugId,
        path: script.path,
        matchCount: matches.length,
        matches,
      });
    }
  }

  return { files, code, totalCodeMatches, limited: false };
}

async function serveAsset(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(assetsDir, relative);
  if (!target.startsWith(path.resolve(assetsDir) + path.sep) && target !== path.resolve(assetsDir, "index.html")) {
    text(res, 403, "Forbidden");
    return;
  }

  try {
    let body = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    if (ext === ".html") {
      body = Buffer.from(body.toString("utf8").replace(/\{\{WS_PORT\}\}/g, String(SERVER_PORT)));
    }
    res.writeHead(200, {
      "Content-Type": contentType(ext),
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    text(res, 404, "Not found");
  }
}

function contentType(ext) {
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === "/api/status") {
    json(res, 200, {
      connected: true,
      startedAt,
      relayClients: 3,
      clients: mockClients,
    });
    return true;
  }

  if (pathname === "/api/client-setup") {
    if (req.method === "POST") {
      const body = await readJson(req);
      if (body.action === "write-autoexec") {
        const autoexec = getAutoexecStatus();
        const targetIds = Array.isArray(body.autoexecTargetIds)
          ? new Set(body.autoexecTargetIds)
          : null;
        const targets = targetIds
          ? autoexec.detectedTargets.filter((target) => targetIds.has(target.id))
          : autoexec.detectedTargets;
        const written = targets.map((target) => ({
          name: target.name,
          scriptPath: target.scriptPath,
          previousPath: target.installedPath || null,
        }));
        json(res, written.length ? 200 : 404, {
          ok: written.length > 0,
          written,
          error: written.length ? null : "No supported autoexec folder was found on this machine.",
          autoexec,
        });
        return true;
      }
      json(res, 200, {
        ok: true,
        output: `Mock ${body.action || "setup"} completed. No real Tailscale commands were run.`,
      });
      return true;
    }

    json(res, 200, {
      serverPort: SERVER_PORT,
      lanIp,
      isLocalRequest: true,
      tailscale: {
        installed: true,
        backendState: "Running",
        ip: tailscaleIp,
      },
      connectors: {
        currentMachine: connector(`localhost:${SERVER_PORT}`),
        localNetwork: connector(`${lanIp}:${SERVER_PORT}`),
        authorizedMachines: connector(`${tailscaleIp}:${SERVER_PORT}`),
      },
      guide: {
        downloadUrl: "https://tailscale.com/download",
        cliUrl: "https://tailscale.com/docs/reference/tailscale-cli",
        linuxInstallCommand: "curl -fsSL https://tailscale.com/install.sh | sh",
        relayExample: `--baseurl http://${tailscaleIp}:${SERVER_PORT}`,
      },
      autoexec: getAutoexecStatus(),
    });
    return true;
  }

  if (pathname === "/api/server-logs") {
    if (req.method === "DELETE") {
      mockLogs.length = 0;
      json(res, 200, { ok: true });
      return true;
    }
    json(res, 200, { logs: mockLogs });
    return true;
  }

  if (pathname === "/api/scripts") {
    json(res, 200, { scripts: mockScripts });
    return true;
  }

  if (pathname === "/api/scripts/search") {
    json(res, 200, searchScripts(url.searchParams.get("q")));
    return true;
  }

  if (pathname === "/api/scripts/source") {
    if (req.method === "PUT") {
      const body = await readJson(req);
      const debugId = String(body.debugId || "");
      if (!mockSources.has(debugId)) {
        json(res, 404, { error: "Mock script not found" });
        return true;
      }
      const source = String(body.source || "");
      mockSources.set(debugId, source);
      mockScripts = mockScripts.map((script) =>
        script.debugId === debugId ? { ...script, lines: source.split("\n").length, bytes: Buffer.byteLength(source, "utf8") } : script,
      );
      json(res, 200, {
        ok: true,
        lines: source.split("\n").length,
        bytes: Buffer.byteLength(source, "utf8"),
      });
      return true;
    }

    const debugId = url.searchParams.get("debugId") || "";
    const script = scriptByDebugId(debugId);
    if (!script) {
      json(res, 404, { error: "Mock script not found" });
      return true;
    }
    json(res, 200, {
      path: script.path,
      debugId: script.debugId,
      source: scriptSource(script.debugId),
    });
    return true;
  }

  if (pathname === "/api/scripts/export") {
    const payload = Buffer.from(
      [
        "Mock script export",
        "",
        ...mockScripts.map((script) => `${script.path}.luau\n${scriptSource(script.debugId)}`),
      ].join("\n\n"),
      "utf8",
    );
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="mock-scripts-export.zip"',
      "Cache-Control": "no-store",
    });
    res.end(payload);
    return true;
  }

  if (pathname === "/api/tool") {
    const body = await readJson(req);
    json(res, 200, {
      ok: true,
      result: {
        mock: true,
        echoedPayload: body,
        message: "Mock tool response. No Roblox client was called.",
      },
    });
    return true;
  }

  if (pathname === "/api/tool-progress") {
    json(res, 200, {
      status: "completed",
      result: { mock: true, message: "Mock job completed." },
    });
    return true;
  }

  if (pathname === "/api/semantic-settings") {
    if (req.method === "PUT") {
      mockSettings = { ...mockSettings, ...(await readJson(req)), openaiApiKeySet: mockSettings.openaiApiKeySet };
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === "DELETE") {
      json(res, 200, { ok: true });
      return true;
    }
    json(res, 200, mockSettings);
    return true;
  }

  if (pathname === "/api/semantic-settings/test") {
    json(res, 200, {
      ok: true,
      dimensions: 1536,
      latencyMs: 12,
    });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (!handled) json(res, 404, { error: "Mock API route not found" });
    return;
  }

  await serveAsset(req, res, url.pathname);
});

server.listen(port, host, () => {
  const assetMode = useDist ? "dist" : "src";
  console.log(`Mock MCP dashboard running at http://${host}:${port}/`);
  console.log(`Serving ${assetMode} dashboard assets from ${assetsDir}`);
  console.log("No Roblox client, Tailscale, or MCP tool calls are performed in this mode.");
  console.log("Use --port <port>, --host <host>, or --dist if needed.");
});
