// Per-agent setup report: what loads, what fits the skill listing, what is used, what conflicts.
// Pure functions over scanned data. These are heuristics, not a measure of model quality.
import { words, jaccard } from "./skills.mjs";

export const AGENTS = ["Claude Code", "Codex", "Cursor", "Gemini"];
// Claude Code skill listing defaults. The budget is documented as 1% of the context window.
// Recorded listings on Claude Code 2.1.323 are 30,000 characters in 1M-token sessions, which
// is 3 characters per token; the 200K figure follows from that and is not measured.
// bundledChars approximates built-in skills and commands that share the budget.
export const LISTING = {
  window: 1_000_000,
  charsPerToken: 3,
  fraction: 0.01,
  maxDesc: 1536,
  bundledChars: 6500,
};
export const OVERLAP = 0.5;
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function listingBudget({ override, env, fraction, window } = {}) {
  if (Number(override) > 0)
    return { chars: Math.floor(Number(override)), source: "--budget" };
  if (Number(env) > 0)
    return {
      chars: Math.floor(Number(env)),
      source: "SLASH_COMMAND_TOOL_CHAR_BUDGET",
    };
  const w = Number(window) > 0 ? Number(window) : LISTING.window;
  const f = Number(fraction) > 0 ? Number(fraction) : LISTING.fraction;
  return {
    chars: Math.max(1, Math.floor(w * LISTING.charsPerToken * f)),
    source: `${f * 100}% of a ${w >= 1e6 ? w / 1e6 + "M" : Math.round(w / 1000) + "K"}-token context window${Number(fraction) > 0 ? " (skillListingBudgetFraction)" : ""}`,
  };
}

export function listingDescription(s, maxDesc = LISTING.maxDesc) {
  const d = [s.description, s.whenToUse].filter(Boolean).join(" - ");
  return d.length > maxDesc ? d.slice(0, maxDesc - 1) + "…" : d;
}

export const usageScore = (u, now) =>
  u?.usageCount > 0
    ? u.usageCount *
      Math.max(0.5 ** ((now - (u.lastUsedAt || 0)) / WEEK), 0.1)
    : 0;

const usageOf = (usage, s) => usage[s.key] ?? usage[s.dirName] ?? null;

// Mirrors the Claude Code listing: names always stay; when the listing is over budget,
// descriptions are kept greedily, most recently and frequently used first.
export function estimateListing(
  skills,
  {
    budget,
    usage = {},
    now = Date.now(),
    maxDesc = LISTING.maxDesc,
    reserved = LISTING.bundledChars,
  },
) {
  const listed = skills.filter((s) => s.mode !== "hidden");
  const nameLen = (s) => `- ${s.key}`.length + 1;
  const extra = (s) => {
    const d = s.mode === "name-only" ? "" : listingDescription(s, maxDesc);
    return d ? d.length + 2 : 0;
  };
  const names = listed.reduce((n, s) => n + nameLen(s), 0);
  const total = reserved + names + listed.reduce((n, s) => n + extra(s), 0);
  const keep = new Set();
  if (total <= budget) for (const s of listed) keep.add(s);
  else {
    let left = budget - reserved - names;
    const ranked = listed
      .map((s, i) => ({ s, i, score: usageScore(usageOf(usage, s), now) }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    for (const { s } of ranked) {
      const cost = extra(s);
      if (cost <= left) {
        left -= cost;
        keep.add(s);
      }
    }
  }
  const keys = (list) => list.map((s) => s.key);
  return {
    budget,
    total,
    overBudget: total > budget,
    readable: keys(listed.filter((s) => keep.has(s) && extra(s))),
    dropped: keys(listed.filter((s) => !keep.has(s) && extra(s))),
    nameOnly: keys(listed.filter((s) => !extra(s))),
    hidden: keys(skills.filter((s) => s.mode === "hidden")),
  };
}

const uniqueBy = (list, key) => {
  const seen = new Set();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// What one agent loads: one entry per real file. Claude Code also resolves a shared name to
// one copy (personal before project); Codex and Cursor list every copy.
export function effectiveSet(copies, agent) {
  const mine = uniqueBy(
    copies.filter((s) => s.agents.includes(agent) && !s.disabled),
    (s) => s.real,
  );
  if (agent !== "Claude Code") return { loaded: mine, shadowed: [] };
  const rank = { personal: 0, synced: 1, plugin: 2, project: 3 };
  const sorted = [...mine].sort(
    (a, b) =>
      rank[a.source] - rank[b.source] || (a.key < b.key ? -1 : a.key > b.key),
  );
  const loaded = uniqueBy(sorted, (s) => s.key.toLowerCase());
  return { loaded, shadowed: sorted.filter((s) => !loaded.includes(s)) };
}

const quote = (p) => `'${String(p).replace(/'/g, `'\\''`)}'`;
// Proposed repairs for a broken symlink, best first. Commands are printed, never run.
export function brokenFixes(b, used = 0) {
  const fixes = [];
  const copies = b.copies || [];
  if (copies.length && b.resolved)
    fixes.push({
      action: "restore",
      command: `cp -R ${quote(copies[0].path)} ${quote(b.resolved)}`,
      why:
        `puts the missing folder back from ${copies[0].where}; every link to it works again` +
        (copies.length > 1
          ? `. ${copies.length} different versions exist, so check this is the one you want`
          : ""),
    });
  fixes.push({
    action: "remove",
    command: `rm ${quote(b.path)}`,
    why: !used
      ? "never used, so the link can go"
      : `drops a skill used ${used} times` +
        (copies.length ? "" : "; no copy was found on this machine, so reinstall it if you still want it"),
  });
  return fixes;
}

export function findConflicts(
  copies,
  broken = [],
  { usage = {}, maxDesc = LISTING.maxDesc } = {},
) {
  const all = uniqueBy(copies, (s) => s.real);
  const conflicts = [];
  const byKey = new Map();
  for (const s of all) {
    const k = s.key.toLowerCase();
    byKey.set(k, [...(byKey.get(k) || []), s]);
  }
  const winners = (group) => {
    const result = {};
    for (const agent of AGENTS) {
      const mine = group.filter((s) => s.agents.includes(agent));
      if (!mine.length) continue;
      result[agent] =
        mine.length === 1
          ? mine[0].path
          : agent === "Claude Code"
            ? effectiveSet(mine, agent).loaded[0].path
            : null;
    }
    return result;
  };
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const same = new Set(group.map((s) => s.hash)).size === 1;
    conflicts.push({
      kind: same ? "duplicate" : "diverged",
      name: group[0].key,
      detail: same
        ? `${group.length} byte-identical copies`
        : `${group.length} copies with different content`,
      paths: group.map((s) => s.path),
      winners: winners(group),
    });
  }
  const firsts = [...byKey.values()].map((g) => g[0]);
  const bags = firsts.map((s) => words(s.description));
  for (let i = 0; i < firsts.length; i++)
    for (let j = i + 1; j < firsts.length; j++) {
      const score = jaccard(bags[i], bags[j]);
      if (score >= OVERLAP)
        conflicts.push({
          kind: "overlap",
          name: `${firsts[i].key} / ${firsts[j].key}`,
          detail: `descriptions share ${Math.round(score * 100)}% of their keywords`,
          paths: [firsts[i].path, firsts[j].path],
        });
    }
  for (const b of broken)
    conflicts.push({
      kind: "broken",
      name: b.name,
      detail: `symlink target is missing: ${b.target}${usage[b.name]?.usageCount ? ` (used ${usage[b.name].usageCount} times)` : ""}`,
      paths: [b.path],
      target: b.resolved,
      used: usage[b.name]?.usageCount || 0,
      fixes: brokenFixes(b, usage[b.name]?.usageCount || 0),
    });
  for (const s of firsts) {
    const length = [s.description, s.whenToUse].filter(Boolean).join(" - ")
      .length;
    if (!length)
      conflicts.push({
        kind: "missing",
        name: s.key,
        detail: "no description, so the model sees only the name",
        paths: [s.path],
      });
    else if (length > maxDesc)
      conflicts.push({
        kind: "oversized",
        name: s.key,
        detail: `description is ${length} characters; the listing cuts it at ${maxDesc}`,
        paths: [s.path],
      });
  }
  const order = [
    "broken",
    "diverged",
    "duplicate",
    "overlap",
    "oversized",
    "missing",
  ];
  return conflicts.sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );
}

export function buildSetup({
  copies = [],
  broken = [],
  usage = {},
  sessionUsage = {},
  settings = {},
  budget = {},
  plugins = [],
  repos = [],
  machine = {},
  notes = [],
  now = Date.now(),
}) {
  const maxDesc = Number(settings.maxDesc) > 0 ? settings.maxDesc : undefined;
  const overrides = settings.overrides || {};
  const agents = {};
  for (const agent of AGENTS) {
    const { loaded, shadowed } = effectiveSet(copies, agent);
    const sources = {};
    for (const s of loaded) sources[s.source] = (sources[s.source] || 0) + 1;
    agents[agent] = {
      installed: loaded.length,
      sources,
      shadowed: shadowed.map((s) => s.path),
    };
  }
  const claude = effectiveSet(copies, "Claude Code").loaded.map((s) => {
      const o = s.source === "plugin" ? undefined : overrides[s.key];
      return {
        ...s,
        mode:
          s.hidden || o === "off" || o === "user-invocable-only"
            ? "hidden"
            : o === "name-only"
              ? "name-only"
              : "on",
      };
    });
  const chosen = listingBudget({ ...budget, fraction: settings.fraction });
  const run = (chars) =>
    estimateListing(claude, { budget: chars, usage, now, maxDesc });
  const listing = run(chosen.chars);
  const scenarios = [
    ["200K-token window", 200_000],
    ["1M-token window", 1_000_000],
  ].map(([label, window]) => {
    const b = listingBudget({ window, fraction: settings.fraction });
    return { label, chars: b.chars, readable: run(b.chars).readable.length };
  });
  const used = claude.filter((s) => usageOf(usage, s)?.usageCount > 0);
  const keys = new Set(claude.flatMap((s) => [s.key, s.dirName]));
  const conflicts = findConflicts(copies, broken, { usage, maxDesc });
  const byKind = {};
  for (const f of conflicts) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  return {
    headline: {
      agent: "Claude Code",
      installed: claude.length,
      readable: listing.readable.length,
      used: used.length,
      conflicts: conflicts.length,
    },
    agents,
    // Every skill name any agent can load, for the never-used list.
    installedNames: [...new Set(AGENTS.flatMap((a) => effectiveSet(copies, a).loaded.map((s) => s.key)))],
    readable: {
      estimate: true,
      budgetChars: chosen.chars,
      budgetSource: chosen.source,
      reservedChars: LISTING.bundledChars,
      listingChars: listing.total,
      overBudget: listing.overBudget,
      scenarios,
      readable: listing.readable,
      dropped: listing.dropped,
      nameOnly: listing.nameOnly,
      hidden: listing.hidden,
      method:
        "Estimate. Claude Code lists every skill name and keeps descriptions while they fit a character budget (1% of the context window by default; a 1M-token window is assumed). When over budget, recently and often used skills keep theirs first. skillListingBudgetFraction, skillListingMaxDescChars, skillOverrides and SLASH_COMMAND_TOOL_CHAR_BUDGET change it. Built-in skills and commands share the budget and are approximated.",
    },
    usage: {
      source: "skillUsage in ~/.claude.json for Claude Code; session logs for Codex and Gemini (byAgent)",
      used: used
        .map((s) => ({
          name: s.key,
          count: usageOf(usage, s).usageCount,
          lastUsedAt: usageOf(usage, s).lastUsedAt ?? null,
        }))
        .sort((a, b) => b.count - a.count),
      neverUsed: claude
        .filter((s) => !usageOf(usage, s)?.usageCount)
        .map((s) => s.key),
      notInstalled: Object.keys(usage).filter((k) => !keys.has(k)),
      // Codex and Gemini: sessions that opened each skill, read from their session logs.
      byAgent: Object.fromEntries(
        Object.entries(sessionUsage).map(([agent, counts]) => [
          agent,
          Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
        ]),
      ),
    },
    conflicts: { byKind, items: conflicts },
    plugins,
    repos,
    machine,
    notes,
  };
}

// What a public profile carries: skill names and use counts. No descriptions, paths or file contents.
// Counts are summed across agents; a skill is never used when no agent has used it.
export function publicProfile(setup) {
  const total = new Map(setup.usage.used.map(({ name, count }) => [name, count]));
  const counted = setup.usage.used.length ? [setup.headline.agent] : [];
  for (const [agent, list] of Object.entries(setup.usage.byAgent ?? {})) {
    if (list.length) counted.push(agent);
    for (const { name, count } of list) total.set(name, (total.get(name) || 0) + count);
  }
  return {
    agent: counted.join(", ") || setup.headline.agent,
    agents: Object.fromEntries(
      Object.entries(setup.agents).map(([name, a]) => [name, a.installed]),
    ),
    used: [...total]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    neverUsed: [...new Set([...setup.usage.neverUsed, ...(setup.installedNames ?? [])])].filter(
      (name) => !total.has(name),
    ),
  };
}
