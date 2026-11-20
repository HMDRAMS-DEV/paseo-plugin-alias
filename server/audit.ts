import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publicProfile } from "./vendor/core/setup.mjs";
import { scanSetup } from "./vendor/lib/setup.mjs";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { auditRpc, linkXRpc, shareRpc } from "../shared/alias";

export interface Setup {
  headline: { agent: string };
  agents: Record<string, { installed: number }>;
  usage: { used: { name: string; count: number }[]; neverUsed: string[] };
  conflicts: {
    items: { kind: string; name: string; paths: string[]; used?: number; fixes?: { command: string; why: string }[] }[];
  };
}

// The same file the alias-skills CLI uses, so both publish to one profile.
const CONFIG = path.join(os.homedir(), ".alias", "config.json");
const HOST = process.env.ALIAS_API || "https://alias.computer";

type X = { handle: string; name: string; avatar: string; verified: boolean };
type Config = { id?: string; token?: string; visibility?: string; x?: X | null };

function loadConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: Config) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const scan = () => scanSetup({ home: os.homedir(), cwd: os.homedir(), env: process.env });
const sharedUrl = (cfg: Config) => (cfg.id && cfg.visibility === "public" ? `${HOST}/s/${cfg.id}` : null);

export async function audit(): Promise<RpcOutput<typeof auditRpc>> {
  const setup = scan();
  return {
    profile: publicProfile(setup),
    broken: setup.conflicts.items
      .filter((c) => c.kind === "broken")
      .map((c) => ({ name: c.name, path: c.paths[0] ?? "", used: c.used ?? 0, fixes: c.fixes ?? [] })),
    sharedUrl: sharedUrl(loadConfig()),
    x: loadConfig().x ?? null,
    home: os.homedir(),
  };
}

async function call(method: string, route: string, body: unknown, token?: string) {
  const res = await fetch(HOST + route, {
    method,
    headers: {
      "content-type": "application/json",
      "x-alias-client": "paseo-plugin/0.1.0",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; token?: string; error?: string; x?: X | null };
  if (!res.ok) throw Object.assign(new Error(data.error || `alias.computer answered ${res.status}`), { status: res.status });
  return data;
}

export async function share({ public: makePublic }: RpcInput<typeof shareRpc>): Promise<RpcOutput<typeof shareRpc>> {
  let cfg = loadConfig();
  if (!makePublic) {
    if (cfg.id) await call("PATCH", `/api/setups/${cfg.id}`, { visibility: "private" }, cfg.token);
    saveConfig({ ...cfg, visibility: "private" });
    return { sharedUrl: null };
  }
  const body = { visibility: "public", profile: publicProfile(scan()) };
  let res;
  try {
    res = await call("POST", cfg.id ? `/api/setups/${cfg.id}` : "/api/setups", body, cfg.token);
  } catch (e) {
    // The saved profile was deleted on alias: start a new one.
    if (!cfg.id || (e as { status?: number }).status !== 404) throw e;
    cfg = {};
    res = await call("POST", "/api/setups", body);
  }
  cfg = { ...cfg, id: res.id, token: res.token ?? cfg.token, visibility: "public" };
  saveConfig(cfg);
  return { sharedUrl: sharedUrl(cfg) };
}

// alias.computer looks the account up and checks whether its bio links to the profile.
export async function linkX({ handle }: RpcInput<typeof linkXRpc>): Promise<RpcOutput<typeof linkXRpc>> {
  const cfg = loadConfig();
  if (!cfg.id) throw new Error("Share your profile first.");
  const { x = null } = await call("PATCH", `/api/setups/${cfg.id}`, { x: handle }, cfg.token);
  saveConfig({ ...cfg, x });
  return { x };
}
