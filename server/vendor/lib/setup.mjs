// Read-only scan behind the per-agent setup report. Reads skill folders, the Claude Code
// plugin registry and settings, and usage counts. It never writes and never calls the network.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { metadata } from "../core/doctor.mjs";
import { buildSetup } from "../core/setup.mjs";

const PROJECT_DIRS = [
  [".claude/skills", ["Claude Code", "Cursor"]],
  [".agents/skills", ["Codex", "Cursor", "Gemini"]],
  [".gemini/skills", ["Gemini"]],
  [".cursor/skills", ["Cursor"]],
  [".codex/skills", ["Cursor"]],
];
const json = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const text = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const dirs = (dir) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules");
  } catch {
    return [];
  }
};

function readSkill(dir, realDir, link, extra) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  // Only the frontmatter is parsed; bodies can be large.
  const end = raw.indexOf("\n---", 3);
  const m = metadata(end < 0 ? "" : raw.slice(0, end + 4)).values;
  const name = m.name || path.basename(dir);
  return {
    name,
    key: (extra.prefix || "") + name,
    dirName: (extra.prefix || "") + path.basename(dir),
    description: m.description || "",
    whenToUse: m.when_to_use || "",
    hidden: m["disable-model-invocation"] === "true",
    bytes: Buffer.byteLength(raw),
    hash: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    path: dir,
    real: path.join(realDir, "SKILL.md"),
    link,
    source: extra.source,
    agents: extra.agents,
    label: extra.label,
  };
}

// Skill folders under a root. Symlinks are followed; ones that point nowhere are returned
// as broken. A folder with a SKILL.md is one skill and is not searched further.
function walk(root, extra, { depth = 4, skip = [] } = {}) {
  const skills = [],
    broken = [],
    seen = new Set();
  const visit = (dir, realDir, level) => {
    for (const e of dirs(dir)) {
      if (level === 0 && skip.includes(e.name)) continue;
      const p = path.join(dir, e.name);
      const link = e.isSymbolicLink();
      let real = path.join(realDir, e.name);
      if (link)
        try {
          real = fs.realpathSync(p);
          if (!fs.statSync(real).isDirectory()) continue;
        } catch {
          broken.push({
            name: e.name,
            path: p,
            target: fs.readlinkSync(p),
            resolved: path.resolve(dir, fs.readlinkSync(p)),
            agents: extra.agents,
          });
          continue;
        }
      else if (!e.isDirectory()) continue;
      if (seen.has(real)) continue;
      seen.add(real);
      const skill = readSkill(p, real, link, extra);
      if (skill) skills.push(skill);
      else if (level + 1 < depth) visit(p, real, level + 1);
    }
  };
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return { skills, broken };
  }
  visit(root, realRoot, 0);
  return { skills, broken };
}

// A linked worktree's .git is a file that points into the main repository.
function mainRepo(start, home) {
  for (let dir = start; dir !== path.dirname(dir) && dir !== home; ) {
    const git = path.join(dir, ".git");
    if (fs.existsSync(git)) {
      const m = text(git).match(/^gitdir:\s*(.+?)\/\.git\/worktrees\//);
      return { root: dir, main: m ? m[1] : dir };
    }
    dir = path.dirname(dir);
  }
  return null;
}
function worktrees(main) {
  return dirs(path.join(main, ".git/worktrees"))
    .map((e) =>
      path.dirname(
        text(path.join(main, ".git/worktrees", e.name, "gitdir")).trim(),
      ),
    )
    .filter((dir) => dir !== "." && fs.existsSync(dir));
}

// Surviving copies of a skill whose symlink target is gone, one per distinct content:
// user-level folders first, then each known repository, main checkout before worktrees.
function survivors(name, copies, mains) {
  const found = [];
  const add = (dir, where) => {
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return;
    }
    const raw = text(path.join(real, "SKILL.md"));
    if (!raw) return;
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    if (!found.some((f) => f.hash === hash)) found.push({ path: real, where, hash });
  };
  for (const s of copies)
    if (s.dirName === name) add(path.dirname(s.real), s.label);
  for (const main of mains)
    for (const checkout of [main, ...worktrees(main)])
      for (const rel of [...PROJECT_DIRS.map(([rel]) => rel), "skills"])
        add(
          path.join(checkout, rel, name),
          `${path.basename(main)} (${checkout === main ? "main checkout" : "worktree"})`,
        );
  return found;
}

function countSkillFiles(dir, depth = 8) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "SKILL.md") n++;
      else if (e.isDirectory() && depth > 0 && e.name !== "node_modules")
        n += countSkillFiles(path.join(dir, e.name), depth - 1);
    }
  } catch {}
  return n;
}

function claudePlugins(home, enabledPlugins, account) {
  const plugins = [],
    roots = [];
  const add = (id, name, dir, enabled, kind) => {
    const skillsDir = path.join(dir, "skills");
    plugins.push({ id, kind, enabled, skills: dirs(skillsDir).length });
    if (enabled)
      roots.push({
        dir: skillsDir,
        prefix: name + ":",
        source: "plugin",
        label: `plugin ${name}`,
        agents: ["Claude Code"],
      });
  };
  const installed = json(path.join(home, ".claude/plugins/installed_plugins.json"));
  for (const [id, installs] of Object.entries(installed?.plugins ?? {}))
    for (const i of Array.isArray(installs) ? installs : [installs]) {
      if (!i?.installPath) continue;
      const manifest =
        json(path.join(i.installPath, ".claude-plugin/plugin.json")) ?? {};
      add(
        id,
        manifest.name || id.split("@")[0],
        i.installPath,
        enabledPlugins[id] ?? manifest.defaultEnabled !== false,
        "marketplace",
      );
    }
  // Plugins synced from claude.ai are on unless "<name>@synced" is false.
  const synced = path.join(home, ".claude/plugins/synced");
  for (const bucket of dirs(synced)) {
    if (account && bucket.name !== account) continue;
    for (const e of dirs(path.join(synced, bucket.name))) {
      if (!e.isDirectory()) continue;
      const name = e.name.replace(/~g\d+$/, "");
      add(
        `${name}@synced`,
        name,
        path.join(synced, bucket.name, e.name),
        enabledPlugins[`${name}@synced`] !== false,
        "synced",
      );
    }
  }
  return { plugins, roots };
}

// Codex records disabled skills as [[skills.config]] tables with enabled = false.
function codexDisabled(home) {
  return text(path.join(home, ".codex/config.toml"))
    .split(/^\[\[skills\.config\]\]\s*$/m)
    .slice(1)
    .map((block) => block.split(/^\[/m)[0])
    .filter((block) => /^\s*enabled\s*=\s*false/m.test(block))
    .map((block) => block.match(/^\s*path\s*=\s*"(.*)"/m)?.[1])
    .filter(Boolean);
}

const files = (dir, exts) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .filter((f) => exts.some((e) => f.endsWith(e)))
        .map((f) => path.join(dir, f))
    : [];

// Calls fn with each line of a file that contains needle. Session logs run to hundreds of
// megabytes, so read in chunks and search the bytes before decoding a line.
function eachLine(file, needle, fn) {
  const fd = fs.openSync(file, "r");
  const chunk = Buffer.alloc(1 << 22);
  let rest = Buffer.alloc(0);
  const emit = (line) => line.includes(needle) && fn(line.toString("utf8"));
  try {
    for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length)) > 0; ) {
      const buf = rest.length ? Buffer.concat([rest, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      let start = 0;
      for (let end; (end = buf.indexOf(10, start)) >= 0; start = end + 1)
        emit(buf.subarray(start, end));
      rest = Buffer.from(buf.subarray(start));
    }
    if (rest.length) emit(rest);
  } finally {
    fs.closeSync(fd);
  }
}

const tally = (counts, names) => {
  for (const n of names) counts[n] = (counts[n] || 0) + 1;
};

// Codex has no usage counter. It opens a skill by reading its SKILL.md in a shell call, so count
// the sessions that did. Every session also lists all skills in its prompt; those are not calls.
const SKILL_PATH = /[^\s"'`\\;|&()]*?skills\/([\w.:-]+)\/SKILL\.md/g;
const CALLS = ["custom_tool_call", "function_call", "local_shell_call"];
export function codexUsage(home) {
  const counts = {};
  for (const dir of ["sessions", "archived_sessions"])
    for (const file of files(path.join(home, ".codex", dir), [".jsonl"])) {
      const seen = new Set();
      eachLine(file, "SKILL.md", (line) => {
        if (!line.includes('_call"')) return;
        let p;
        try {
          p = JSON.parse(line).payload;
        } catch {
          return;
        }
        if (!CALLS.includes(p?.type)) return;
        const text = p.input ?? p.arguments ?? JSON.stringify(p.action ?? "");
        for (const m of String(text).matchAll(SKILL_PATH))
          // A SKILL.md nested inside another skill is that skill's reference file.
          if (!m[0].slice(0, m[0].lastIndexOf("skills/")).includes("skills/"))
            seen.add(m[1]);
      });
      tally(counts, seen);
    }
  return counts;
}

// Gemini CLI opens a skill with its activate_skill tool and records the call in the session file.
const ACTIVATE = /"name"\s*:\s*"activate_skill"\s*,\s*"args"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"/g;
export function geminiUsage(home) {
  const counts = {};
  for (const file of files(path.join(home, ".gemini/tmp"), [".json", ".jsonl"])) {
    if (!file.includes(`${path.sep}chats${path.sep}`)) continue;
    const seen = new Set();
    eachLine(file, "activate_skill", (line) => {
      for (const m of line.matchAll(ACTIVATE)) seen.add(m[1]);
    });
    tally(counts, seen);
  }
  return counts;
}

export function scanSetup({ home, cwd, env = {}, budget, now = Date.now() }) {
  const claudeJson = json(path.join(home, ".claude.json")) ?? {};
  const notes = [];
  // Settings precedence: user, then project, then local.
  const settings = { enabledPlugins: {}, skillOverrides: {} };
  for (const file of [
    path.join(home, ".claude/settings.json"),
    path.join(cwd, ".claude/settings.json"),
    path.join(cwd, ".claude/settings.local.json"),
  ]) {
    const s = json(file);
    if (!s) continue;
    Object.assign(settings.enabledPlugins, s.enabledPlugins);
    Object.assign(settings.skillOverrides, s.skillOverrides);
    for (const k of ["skillListingBudgetFraction", "skillListingMaxDescChars"])
      if (s[k] !== undefined) settings[k] = s[k];
  }
  const oauth = claudeJson.oauthAccount;
  const bucket =
    oauth?.organizationUuid && oauth?.accountUuid
      ? `${oauth.organizationUuid}_${oauth.accountUuid}`
      : null;
  const account = (base) =>
    bucket && fs.existsSync(path.join(home, base, bucket)) ? bucket : null;

  const roots = [
    {
      dir: path.join(home, ".claude/skills"),
      source: "personal",
      label: "~/.claude/skills",
      agents: ["Claude Code", "Cursor"],
      depth: 1,
      skip: ["synced"],
    },
    {
      dir: path.join(home, ".agents/skills"),
      source: "personal",
      label: "~/.agents/skills",
      agents: ["Codex", "Cursor", "Gemini"],
    },
    {
      dir: path.join(home, ".gemini/skills"),
      source: "personal",
      label: "~/.gemini/skills",
      agents: ["Gemini"],
    },
    {
      dir: path.join(home, ".codex/skills"),
      source: "personal",
      label: "~/.codex/skills",
      agents: ["Codex", "Cursor"],
    },
    {
      dir: path.join(home, ".cursor/skills"),
      source: "personal",
      label: "~/.cursor/skills",
      agents: ["Cursor"],
    },
  ];
  const syncedSkills = path.join(home, ".claude/skills/synced");
  const active = account(".claude/skills/synced");
  for (const b of dirs(syncedSkills))
    if (!active || b.name === active)
      roots.push({
        dir: path.join(syncedSkills, b.name),
        prefix: "anthropic-skills:",
        source: "synced",
        label: "synced from claude.ai",
        agents: ["Claude Code"],
        depth: 1,
      });
  const { plugins, roots: pluginRoots } = claudePlugins(
    home,
    settings.enabledPlugins,
    account(".claude/plugins/synced"),
  );
  roots.push(...pluginRoots.map((r) => ({ ...r, depth: 1 })));

  // Project skills for the current directory, up to its repository root. A linked worktree
  // without its own .claude/skills falls back to the main checkout.
  const here = cwd === home ? null : mainRepo(cwd, home);
  if (cwd !== home) {
    const top = here?.root ?? cwd;
    for (let dir = cwd; ; dir = path.dirname(dir)) {
      for (const [rel, agents] of PROJECT_DIRS)
        roots.push({
          dir: path.join(dir, rel),
          source: "project",
          label: `project ${path.basename(top)}`,
          agents,
        });
      if (dir === top || dir === path.dirname(dir)) break;
    }
    if (
      here &&
      here.main !== here.root &&
      !fs.existsSync(path.join(here.root, ".claude/skills"))
    )
      roots.push({
        dir: path.join(here.main, ".claude/skills"),
        source: "project",
        label: `project ${path.basename(here.main)} (main checkout)`,
        agents: ["Claude Code"],
      });
  }

  const copies = [],
    broken = [],
    locations = [];
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    const found = walk(root.dir, root, root);
    copies.push(...found.skills);
    broken.push(...found.broken);
    locations.push({
      label: root.label,
      dir: root.dir,
      agents: root.agents,
      skills: found.skills.length,
      links: found.skills.filter((s) => s.link).length,
    });
  }
  const off = codexDisabled(home).map((p) => path.resolve(p));
  for (const s of copies)
    if (off.includes(path.join(s.path, "SKILL.md")) || off.includes(s.path))
      s.agents = s.agents.filter((a) => a !== "Codex");

  // Other repositories this machine's agents know about. Worktrees are grouped under their
  // main repository so one skill checked out many times counts once.
  const known = [
    ...Object.keys(claudeJson.projects ?? {}),
    ...[
      ...text(path.join(home, ".codex/config.toml")).matchAll(
        /^\[projects\."(.+)"\]/gm,
      ),
    ].map((m) => m[1]),
    cwd,
  ];
  const mains = new Set();
  for (const p of known) {
    if (p === home || !fs.existsSync(p)) continue;
    mains.add(mainRepo(p, home)?.main ?? p);
  }
  const personal = new Map(
    copies
      .filter((s) => s.label === "~/.claude/skills")
      .map((s) => [s.key.toLowerCase(), s.hash]),
  );
  const repos = [];
  for (const main of mains) {
    const checkouts = [main, ...worktrees(main)];
    const names = new Map();
    let count = 0,
      overridden = 0;
    for (const checkout of checkouts)
      for (const [rel, agents] of PROJECT_DIRS) {
        const found = walk(path.join(checkout, rel), { source: "project", agents });
        count += found.skills.length;
        for (const s of found.skills) {
          const k = s.key.toLowerCase();
          names.set(k, (names.get(k) ?? new Set()).add(s.hash));
          if (checkout === main && rel === ".claude/skills" && personal.has(k))
            overridden++;
        }
      }
    if (!count) continue;
    repos.push({
      repo: main,
      worktrees: checkouts.length - 1,
      files: count,
      skills: names.size,
      differing: [...names.values()].filter((h) => h.size > 1).length,
      overriddenByPersonal: overridden,
    });
  }
  repos.sort((a, b) => b.files - a.files);
  for (const b of broken) b.copies = survivors(b.name, copies, mains);
  // Raw SKILL.md counts, before symlinks, disabled plugins and worktrees are resolved.
  const pluginFiles = countSkillFiles(path.join(home, ".claude/plugins"));
  const repoFiles = repos.reduce((n, r) => n + r.files, 0);
  const userFiles = copies.filter((s) =>
    ["personal", "synced"].includes(s.source),
  ).length;

  notes.push(
    "Codex: ~/.codex/skills is a legacy folder that Codex still appears to read; this is not documented.",
    "Not counted: skills bundled with each agent (for example ~/.codex/skills/.system and ~/.cursor/skills-cursor), commands, and plugin skills at custom paths.",
    "Readable is reported for Claude Code only.",
    "Claude Code counts each time a skill runs. Codex and Gemini are counted from their session logs: one use for each session that opened the skill. Cursor keeps no usage log.",
  );
  return buildSetup({
    copies,
    broken,
    usage: claudeJson.skillUsage ?? {},
    sessionUsage: { Codex: codexUsage(home), Gemini: geminiUsage(home) },
    settings: {
      fraction: settings.skillListingBudgetFraction,
      maxDesc: settings.skillListingMaxDescChars,
      overrides: settings.skillOverrides,
    },
    budget: { override: budget, env: env.SLASH_COMMAND_TOOL_CHAR_BUDGET },
    plugins,
    repos,
    machine: {
      locations,
      files: userFiles + pluginFiles + repoFiles,
      userFiles,
      pluginFiles,
      repoFiles,
    },
    notes,
    now,
  });
}
