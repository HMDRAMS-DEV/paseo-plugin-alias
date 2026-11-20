// Pure, deterministic, browser-safe analysis. Filesystem and providers live in ../lib.
export const SCHEMA = "alias.audit/v1";
export const VERSION = "0.3.0";
export const ADAPTER_VERSION = "2026-10-23.1";
export const SOURCES = {
  codex: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
  claude: "https://code.claude.com/docs/en/memory",
  cursor: "https://cursor.com/docs/rules",
  copilot:
    "https://docs.github.com/en/copilot/reference/custom-instructions-support",
};
export const bytes = (s) => new TextEncoder().encode(s).length;
export function normalize(p) {
  const parts = [];
  for (const s of p.replaceAll("\\", "/").split("/")) {
    if (s === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (s && s !== ".") parts.push(s);
  }
  return parts.join("/") || ".";
}
export const dirname = (p) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
export const basename = (p) => p.split("/").at(-1);
export const within = (p, dir) =>
  dir === "." || p === dir || p.startsWith(dir + "/");
export const join = (a, b) => normalize((a === "." ? "" : a + "/") + b);
export function contentLines(text) {
  let fenced = false;
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((text, i) => {
      if (/^\s*(```|~~~)/.test(text)) {
        fenced = !fenced;
        return { line: i + 1, text: "", raw: text };
      }
      return { line: i + 1, text: fenced ? "" : text, raw: text };
    });
}
// Deliberately small frontmatter subset. Unsupported YAML is explicit, never guessed.
export function metadata(text) {
  const m = text
    .replaceAll("\r\n", "\n")
    .match(/^---\s*\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return { values: {}, valid: !text.startsWith("---") };
  const values = {};
  let valid = true;
  let key = "";
  for (const line of m[1].split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const field = line.match(/^([\w-]+):\s*(.*?)\s*$/);
    if (field) {
      key = field[1];
      let value = field[2].replace(/\s+#.*$/, "");
      if (/^[&*!]|[{}]/.test(value) && !/^['"]/.test(value)) valid = false;
      if (
        (value.startsWith('"') && !value.endsWith('"')) ||
        (value.startsWith("'") && !value.endsWith("'"))
      )
        valid = false;
      if (/^[>|][-+]?$/.test(value)) value = "";
      values[key] = value.replace(/^["']|["']$/g, "");
    } else if (/^\s+/.test(line) && key) {
      values[key] +=
        (values[key] ? (/^\s*-\s/.test(line) ? "," : " ") : "") +
        line
          .trim()
          .replace(/^-\s*/, "")
          .replace(/^["']|["']$/g, "");
    } else valid = false;
  }
  return { values, valid };
}
function patterns(raw = "") {
  const result = [];
  let current = "",
    depth = 0;
  for (const c of raw.replace(/^\[|\]$/g, "")) {
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (c === "," && depth === 0) {
      result.push(current);
      current = "";
    } else current += c;
  }
  result.push(current);
  return result
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}
export function globMatches(pattern, value) {
  // Brace alternatives and *, **, ? only. Other syntax is left uncertain by callers.
  const brace = pattern.match(/\{([^{}]+)\}/);
  if (brace)
    return brace[1]
      .split(",")
      .some((s) => globMatches(pattern.replace(brace[0], s), value));
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$").test(value);
}
function nodeType(p) {
  if (basename(p) === "SKILL.md") return "skill";
  if (basename(p) === "package.json") return "manifest";
  if (
    /(?:AGENTS(?:\.override)?|CLAUDE(?:\.local)?|GEMINI)\.md$/.test(p) ||
    /\.cursor\/rules\/.*\.mdc$/.test(p) ||
    /\.claude\/rules\/.*\.md$/.test(p) ||
    /\.github\/(?:instructions\/.*\.instructions|copilot-instructions)\.md$/.test(
      p,
    ) ||
    basename(p) === ".cursorrules"
  )
    return "instruction";
  return "reference";
}
export function isInstruction(p) {
  return ["instruction", "skill"].includes(nodeType(p));
}
function condition(patternsRaw, profile) {
  const ps = patterns(patternsRaw);
  if (!ps.length) return ["unknown", "Missing or unsupported path patterns."];
  if (ps.some((p) => /[\[\]!]/.test(p)))
    return ["unknown", "Unsupported glob syntax; check the client."];
  if (!profile.files?.length)
    return ["conditional", "Loads when matching files enter context."];
  return profile.files.some((f) => ps.some((p) => globMatches(p, f)))
    ? ["eager", "A selected context file matches the rule."]
    : ["ignored", "No selected context file matches the rule."];
}
export function analyze(input) {
  const profile = {
    agent: "codex",
    cwd: ".",
    task: "general",
    ...Object.fromEntries(
      Object.entries(input.profile || {}).filter(([, v]) => v !== undefined),
    ),
  };
  if (!SOURCES[profile.agent])
    throw new Error("Choose codex, claude, cursor, or copilot.");
  if (normalize(profile.cwd) !== profile.cwd)
    throw new Error("cwd must be a normalized path inside the repository.");
  const nodes = input.files
    .map((f) => ({
      path: f.path,
      hash: f.hash || "",
      text: f.text,
      bytes: bytes(f.text),
      lines: f.text.split("\n").length,
      type: nodeType(f.path),
      ownership:
        f.ownership ||
        (/(?:^|\/)(?:plugins\/cache|node_modules)\//.test(f.path)
          ? "plugin"
          : /generated|DO NOT EDIT|BEGIN:nextjs-agent-rules/i.test(f.text)
            ? "generated"
            : "user"),
      scope: f.path.startsWith("@global/")
        ? "global"
        : f.path.startsWith("@skills")
          ? "skill-library"
          : "repository",
      activation: "ignored",
      reason: "Not a documented instruction for this profile.",
      ...{ metadata: metadata(f.text).values },
    }))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const edges = [],
    findings = [],
    limitations = [...(input.limitations || [])];
  const add = (
    rule,
    severity,
    message,
    evidence,
    detail = "",
    confidence = "deterministic",
  ) => {
    if (findings.length >= 2048) {
      if (!limitations.includes("Finding limit reached; report is incomplete."))
        limitations.push("Finding limit reached; report is incomplete.");
      return;
    }
    findings.push({
      id: `${rule}:${findings.length + 1}`,
      rule,
      severity,
      message,
      detail,
      confidence,
      evidence,
    });
  };
  const span = (n, line = 1, text = n.text.split("\n")[line - 1] || "") => ({
    path: n.path,
    line,
    endLine: line,
    text: text.replace(/\r$/, ""),
  });
  const set = (n, activation, reason) => {
    n.activation = activation;
    n.reason = reason;
  };
  for (const n of nodes)
    if (n.type === "skill")
      set(
        n,
        "conditional",
        "Skill metadata supports discovery; full text loads only when selected.",
      );
  const dirs = [
    ".",
    ...profile.cwd
      .split("/")
      .filter((x) => x && x !== ".")
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ];
  const inChain = (n) => dirs.includes(dirname(n.path));
  if (profile.agent === "codex") {
    for (const dir of ["@global", ...dirs]) {
      const candidates = (
        dir === "@global"
          ? ["AGENTS.override.md", "AGENTS.md"]
          : [
              "AGENTS.override.md",
              "AGENTS.md",
              ...(profile.fallbackNames || []),
            ]
      )
        .map((name) => byPath.get(join(dir, name)))
        .filter(Boolean);
      const selected = candidates.find((n) => n.text.trim());
      for (const n of candidates)
        set(
          n,
          n === selected ? "eager" : "shadowed",
          n === selected
            ? "First nonempty guidance file at this directory."
            : "An override or earlier filename takes precedence.",
        );
    }
    for (const n of nodes)
      if (
        n.activation === "ignored" &&
        n.type === "instruction" &&
        /^AGENTS(?:\.override)?\.md$/.test(basename(n.path))
      )
        set(n, "conditional", "Applies in a different working directory.");
  } else if (profile.agent === "claude") {
    const ancestorClaude = nodes.some(
      (n) =>
        ["CLAUDE.md", "CLAUDE.local.md"].includes(basename(n.path)) &&
        (inChain(n) ||
          dirs.some((d) => dirname(n.path) === join(d, ".claude"))),
    );
    const mode = profile.claudeMode;
    limitations.push(
      "Claude exclusions, managed policy, and setting sources are unobserved unless explicitly supplied.",
    );
    for (const n of nodes) {
      const name = basename(n.path);
      const parent = dirname(n.path);
      const active =
        inChain(n) ||
        dirs.some((d) => parent === join(d, ".claude")) ||
        n.scope === "global";
      if (["CLAUDE.md", "CLAUDE.local.md"].includes(name))
        set(
          n,
          active ? "eager" : "conditional",
          active
            ? "Ancestor/user Claude instructions."
            : "Loaded on access to this subtree.",
        );
      if (name === "AGENTS.md") {
        if (!profile.clientVersion || !mode)
          set(
            n,
            "unknown",
            "AGENTS support depends on Claude version and instruction-mode settings.",
          );
        else if (compareVersion(profile.clientVersion, "2.1.277") < 0)
          set(
            n,
            "ignored",
            "This Claude version predates documented AGENTS support.",
          );
        else if (
          mode === "claude-md-and-agents-md" ||
          (mode === "claude-md-or-agents-md" && !ancestorClaude)
        )
          set(
            n,
            active ? "eager" : "conditional",
            "AGENTS fallback selected by instruction mode.",
          );
        else
          set(
            n,
            "shadowed",
            "CLAUDE files or instruction-mode settings disable AGENTS fallback.",
          );
      }
      if (
        /(?:^|\/)\.claude\/rules\/.*\.md$/.test(n.path) ||
        (n.scope === "global" && n.path.startsWith("@global/rules/"))
      ) {
        const meta = metadata(n.text);
        if (!meta.valid) {
          set(
            n,
            "unknown",
            "Invalid or unsupported frontmatter; client may load as unscoped.",
          );
          add("invalid-metadata", "warning", "Rule metadata needs review", [
            span(n),
          ]);
        } else if (meta.values.paths)
          set(n, ...condition(meta.values.paths, profile));
        else set(n, "eager", "Unscoped Claude rule.");
        const prefix =
          n.path.split(".claude/rules/")[0].replace(/\/$/, "") || ".";
        if (
          n.scope !== "global" &&
          !within(profile.cwd, prefix) &&
          n.activation === "eager"
        )
          set(
            n,
            "conditional",
            "Nested rules load when this subtree is accessed.",
          );
      }
      if (n.bytes > 4 * 1024 * 1024 && n.activation === "eager")
        set(
          n,
          "ignored",
          "Exceeds the documented 4 MiB Claude instruction-file limit.",
        );
    }
    if (mode === "managed-only")
      for (const n of nodes)
        if (n.type === "instruction")
          set(
            n,
            "ignored",
            "Managed-only mode excludes selected local guidance.",
          );
    if (!profile.clientVersion || !mode)
      limitations.push(
        "Claude version or instruction-mode settings are unverified. AGENTS activation remains unknown.",
      );
  } else if (profile.agent === "cursor") {
    if (profile.client && profile.client !== "agent")
      limitations.push(
        "Cursor rules are modeled for Agent Chat only; this client is unsupported.",
      );
    for (const n of nodes) {
      if (["AGENTS.md", "CLAUDE.md"].includes(basename(n.path)))
        set(
          n,
          inChain(n) ? "eager" : "conditional",
          "Repository instructions; nested scope applies on subtree access.",
        );
      if (n.path.endsWith(".mdc") && n.path.includes(".cursor/rules/")) {
        const m = metadata(n.text);
        if (!m.valid) set(n, "unknown", "Unsupported frontmatter.");
        else if (m.values.alwaysApply === "true")
          set(n, "eager", "alwaysApply is true.");
        else if (m.values.globs) set(n, ...condition(m.values.globs, profile));
        else
          set(
            n,
            "conditional",
            m.values.description
              ? "Agent decides whether this rule is relevant."
              : "Manual @ invocation only.",
          );
      }
      if (basename(n.path) === ".cursorrules")
        set(n, "unknown", "Legacy rule format; verify client settings.");
      if (
        profile.client &&
        profile.client !== "agent" &&
        n.type === "instruction"
      )
        set(n, "unknown", "Unsupported Cursor surface.");
    }
  } else {
    const support = {
      "vscode-chat": ["wide", "path", "agents"],
      "vscode-review": ["wide"],
      "github-chat": ["wide"],
      "github-review": ["wide", "path"],
      "cloud-agent": ["wide", "path", "agents"],
      cli: ["wide", "path", "agents"],
    };
    const supported = support[profile.client];
    if (!supported)
      limitations.push(
        "Select a supported Copilot client: vscode-chat, vscode-review, github-chat, github-review, cloud-agent, or cli.",
      );
    for (const n of nodes) {
      const kind =
        n.path === ".github/copilot-instructions.md" ||
        (profile.client === "cli" &&
          n.path === "@global/copilot-instructions.md")
          ? "wide"
          : /\.github\/instructions\/.*\.instructions\.md$/.test(n.path) ||
              (profile.client === "cli" &&
                /^@global\/instructions\/.*\.instructions\.md$/.test(n.path))
            ? "path"
            : ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].includes(basename(n.path))
              ? "agents"
              : null;
      if (!kind) continue;
      if (!supported)
        set(n, "unknown", "Client/feature support is unspecified.");
      else if (!supported.includes(kind))
        set(
          n,
          "ignored",
          "This instruction type is unsupported on the selected client.",
        );
      else if (kind === "path") {
        const m = metadata(n.text);
        if (!m.valid) set(n, "unknown", "Unsupported frontmatter.");
        else if (
          m.values.excludeAgent ===
          (profile.client === "github-review"
            ? "code-review"
            : profile.client === "cloud-agent"
              ? "cloud-agent"
              : null)
        )
          set(n, "ignored", "excludeAgent excludes the selected client.");
        else set(n, ...condition(m.values.applyTo, profile));
      } else
        set(
          n,
          kind === "wide" || inChain(n) ? "eager" : "conditional",
          "Supported instruction source; precedence is client-dependent.",
        );
    }
    limitations.push(
      "Copilot settings, personal/organization instructions, and runtime file selection can change the effective context.",
    );
  }
  let capTotal = 0;
  if (profile.agent === "codex") {
    let remaining = profile.maxBytes ?? 32768;
    for (const dir of dirs) {
      for (const n of nodes.filter(
        (n) => dirname(n.path) === dir && n.activation === "eager",
      )) {
        capTotal += n.bytes;
        n.includedBytes = Math.min(remaining, n.bytes);
        if (remaining === 0)
          set(
            n,
            "ignored",
            "Project guidance cap was reached before this file.",
          );
        else if (n.bytes > remaining) {
          set(
            n,
            "truncated",
            "Only the remaining project-byte budget can load; client/version may affect decoding.",
          );
          n.effectiveText = new TextDecoder().decode(
            new TextEncoder().encode(n.text).slice(0, remaining),
          );
        }
        remaining = Math.max(0, remaining - n.bytes);
      }
    }
    if (capTotal > (profile.maxBytes ?? 32768))
      add(
        "context-cap",
        "warning",
        "Project instructions exceed the configured discovery cap",
        nodes.filter((n) => n.includedBytes !== undefined).map((n) => span(n)),
        `${capTotal} source bytes; cap ${profile.maxBytes ?? 32768}. Later guidance is truncated or skipped. Global instructions are outside this cap.`,
      );
  }
  // Only root-scope docs are eager initially; reference closure is expanded without IO.
  const processed = new Set();
  function references(n, stack = [], depth = 0) {
    const key = n.path + ":" + n.activation;
    if (processed.has(key)) return;
    processed.add(key);
    for (const l of contentLines(n.effectiveText ?? n.text)) {
      const refs = [];
      for (const m of l.text.matchAll(/\[[^\]]*\]\((<?[^)]+>?)\)/g))
        refs.push({
          target: m[1].replace(/^<|>$/g, "").split(/\s+"/)[0],
          kind: "pointer",
        });
      const inline = l.text
        .replace(/`+[^`]*`+/g, "")
        .replace(/"[^"\n]*"|'[^'\n]*'/g, "");
      if (profile.agent === "claude" || profile.agent === "cursor")
        for (const m of inline.matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/g))
          refs.push({
            target: m[1].replaceAll("\\ ", " "),
            kind: profile.agent === "claude" ? "import" : "pointer",
          });
      for (const ref of refs) {
        const raw = ref.target.split("#")[0];
        if (!raw || /^(?:[a-z]+:|\/\/)/i.test(raw) || /[<>{}$*]/.test(raw))
          continue;
        const target =
          raw.startsWith("/") || raw.startsWith("~")
            ? null
            : join(
                profile.agent === "cursor" && ref.kind === "pointer"
                  ? "."
                  : dirname(n.path),
                raw,
              );
        const dest = target && byPath.get(target);
        const optional = /\b(if present|when available|optional)\b/i.test(
          l.text,
        );
        const edge = {
          from: n.path,
          to: target || raw,
          kind: ref.kind,
          line: l.line,
          status: dest ? "resolved" : optional ? "optional" : "unresolved",
          activation: ref.kind === "import" ? n.activation : "conditional",
        };
        edges.push(edge);
        if (!dest) {
          if (!/\.(?:md|mdc|txt|rst)$/i.test(raw)) {
            edge.status = "unverified";
            continue;
          }
          if (!optional)
            add(
              "missing-reference",
              input.completeness === "selection-only" ? "info" : "warning",
              target
                ? "Referenced file is absent from this inventory"
                : "Reference is outside selected roots",
              [span(n, l.line, l.text)],
              input.completeness === "selection-only"
                ? "Select the referenced file to check it."
                : "Select the owning root or repair the literal path.",
            );
          continue;
        }
        if (ref.kind === "import" && n.activation === "eager") {
          if (stack.includes(dest.path) || dest.path === n.path) {
            add("import-cycle", "warning", "Import cycle stops expansion", [
              span(n, l.line, l.text),
            ]);
            continue;
          }
          if (depth >= 4) {
            edge.status = "depth-limit";
            limitations.push(
              "Claude import expansion reached the documented four-hop limit.",
            );
            continue;
          }
          set(dest, "eager", "Eager Claude @ import from " + n.path);
          references(dest, [...stack, n.path], depth + 1);
        } else if (dest.activation === "ignored")
          set(dest, "conditional", "Referenced on demand by " + n.path);
      }
    }
  }
  for (const n of [...nodes])
    if (["eager", "truncated"].includes(n.activation) || n.type === "skill")
      references(n);
  const eager = nodes.filter(
    (n) =>
      ["eager", "truncated"].includes(n.activation) && n.type !== "manifest",
  );
  const blocks = new Map();
  for (const n of eager) {
    for (const l of contentLines(n.effectiveText ?? n.text)) {
      const t = l.text.trim();
      if (t.length >= 32 && !/^#+|^\|/.test(t)) {
        const prev = blocks.get(t);
        if (prev)
          add(
            "repeated-text",
            "info",
            "Exact instruction text repeats in this active chain",
            [prev, span(n, l.line, l.raw)],
            "Review precedence and exceptions before consolidating.",
          );
        else blocks.set(t, span(n, l.line, l.raw));
      }
      if (
        /^(?:\d+[.)]\s*|[-*]\s*)?(?:you (?:must |will )?)?(?:send|publish|deploy|charge|purchase|compile|build)\b/i.test(
          t,
        ) &&
        !/(?:only|if|when|explicit|authoriz|approv|draft|do not|never)/i.test(t)
      )
        add(
          "action-trigger",
          "review",
          "Possible unconditional external action",
          [span(n, l.line, l.raw)],
          "Confirm that this workflow is invoked deliberately. This pattern is a review candidate, not proof of an authorization conflict.",
          "candidate",
        );
      if (
        /\bread\b.*\b(?:every (?:run|task|time)|top to bottom|entire library)\b/i.test(
          t,
        )
      )
        add(
          "mandatory-reading",
          "review",
          "Possible unnecessary mandatory reading",
          [span(n, l.line, l.raw)],
          "Check whether the full procedure is relevant to this task; keep required safeguards active.",
          "candidate",
        );
      for (const m of l.text.matchAll(
        /\b(?:npm|pnpm|yarn) run ([a-zA-Z0-9:_-]+)/g,
      )) {
        let d = dirname(n.path),
          pkg;
        for (;;) {
          pkg = byPath.get(join(d, "package.json"));
          if (pkg || d === ".") break;
          d = dirname(d);
        }
        if (pkg) {
          try {
            if (!(m[1] in (JSON.parse(pkg.text).scripts || {})))
              add(
                "missing-script",
                "warning",
                `Manifest has no “${m[1]}” script`,
                [span(n, l.line, l.raw), span(pkg)],
                "Check the current package manifest; no command was executed.",
              );
          } catch {
            /* scanner reports malformed manifest */
          }
        }
      }
    }
  }
  const skills = nodes.filter((n) => n.type === "skill");
  const byText = new Map();
  for (const s of skills) {
    if (!s.metadata.description?.trim())
      add(
        "missing-description",
        "warning",
        "Skill has no discovery description",
        [span(s)],
      );
    if (byText.has(s.text))
      add(
        "duplicate-install",
        "info",
        "Identical skill content in separate locations",
        [span(byText.get(s.text)), span(s)],
        "This may be intentional across clients or worktrees. No deletion is recommended from equality alone.",
      );
    else byText.set(s.text, s);
    if (s.bytes > 20000)
      add(
        "large-skill",
        "info",
        "Large conditional skill body",
        [span(s)],
        "Consider linked references for task-specific detail. Size alone does not establish poor performance.",
      );
  }
  for (const n of nodes.filter(
    (n) => n.ownership !== "user" && n.type !== "manifest",
  ))
    add(
      "managed-source",
      "info",
      "Generated or plugin-owned instructions",
      [span(n)],
      "Change the owning generator or package; local plans will not edit this file.",
    );
  const routes = recommendSkills(nodes, profile.task);
  return {
    schemaVersion: SCHEMA,
    tool: { name: "alias-skills", version: VERSION },
    adapter: {
      name: profile.agent,
      version: ADAPTER_VERSION,
      source: SOURCES[profile.agent],
    },
    profile,
    completeness: limitations.some((x) => x.includes("limit reached"))
      ? "partial"
      : input.completeness || "selected-roots",
    scope: input.scope || { roots: [], excluded: [] },
    nodes,
    edges,
    findings,
    skillRecommendations: routes,
    metrics: {
      eagerBytes: eager.reduce((s, n) => s + (n.includedBytes ?? n.bytes), 0),
      estimatedEagerTokens: Math.ceil(
        eager.reduce((s, n) => s + (n.includedBytes ?? n.bytes), 0) / 4,
      ),
      conditionalBytes: nodes
        .filter((n) => n.activation === "conditional")
        .reduce((s, n) => s + n.bytes, 0),
      unresolvedEdges: edges.filter((e) => e.status === "unresolved").length,
      estimator: "utf8-bytes/4-v1 (approximate, not billed tokens)",
    },
    limitations: [
      ...new Set([
        ...limitations,
        "Modeled context, not a captured client prompt. Global/managed settings are included only when explicitly selected.",
      ]),
    ],
  };
}
function compareVersion(a, b) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(x[i])) return -1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}
function recommendSkills(nodes, task) {
  const stack = nodes
    .filter((n) => n.type === "manifest")
    .map((n) => n.text.toLowerCase())
    .join("\n");
  const detected = ["react", "next", "swift", "django", "fastapi"].filter((s) =>
    stack.includes('"' + s + '"'),
  );
  const terms = [
    ...new Set([...task.toLowerCase().split(/[\s,-]+/), ...detected]),
  ].filter((t) => t.length > 2 && t !== "general");
  return nodes
    .filter((n) => n.type === "skill")
    .map((n) => {
      const desc = (n.metadata.description || "").toLowerCase();
      const matches = terms.filter((t) => desc.includes(t));
      return {
        path: n.path,
        name: n.metadata.name || basename(dirname(n.path)),
        reason: matches.length
          ? `Installed description matches: ${matches.join(", ")}.`
          : "",
        matches,
      };
    })
    .filter((r) => r.matches.length)
    .map(({ matches, ...r }) => ({
      ...r,
      status: "review-for-task",
      confidence: "metadata-match",
    }));
}
