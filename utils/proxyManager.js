import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "config", "proxies.json");

let cache = null;
let index = 0;

function loadConfig() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    cache = JSON.parse(raw);
  } catch {
    cache = { enabled: false, servers: [] };
  }
  return cache;
}

/** Next Puppeteer proxy server string or undefined */
export function getNextProxyServer() {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.servers?.length) return undefined;
  const item = cfg.servers[index % cfg.servers.length];
  index += 1;
  return item?.server;
}

export function resetProxyRotation() {
  index = 0;
}
