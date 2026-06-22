export const DEFAULT_BRIDGE_URL = "localhost:16384";
export const SERVER_PORT = 16384;

export function normalizeBridgeUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BRIDGE_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.port) url.port = String(SERVER_PORT);
    return `${url.hostname}:${url.port}`;
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

export function buildLoaderSnippet(bridgeUrl = DEFAULT_BRIDGE_URL) {
  const normalized = normalizeBridgeUrl(bridgeUrl);
  if (normalized === DEFAULT_BRIDGE_URL) {
    return `local bridgeUrl = getgenv().BridgeURL or "${DEFAULT_BRIDGE_URL}"\nloadstring(game:HttpGet("http://" .. bridgeUrl .. "/script.luau"))()`;
  }
  return `getgenv().BridgeURL = "${normalized}"\nlocal bridgeUrl = getgenv().BridgeURL or "${DEFAULT_BRIDGE_URL}"\nloadstring(game:HttpGet("http://" .. bridgeUrl .. "/script.luau"))()`;
}
