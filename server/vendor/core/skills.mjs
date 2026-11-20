// Shared legacy skill report. Field names retained for saved setup compatibility.
import { metadata, basename, dirname } from "./doctor.mjs";
export function parseSkill(raw, path) {
  const m = metadata(raw).values;
  return {
    name: m.name || basename(dirname(path)),
    description: m.description || "",
    path,
  };
}
const STOP = new Set(
  "a an and are as at be by for from has have how if in into is it of on or so that the this to use used uses using when with you your can do does any all not but than then them they what which who will".split(
    " ",
  ),
);
export const words = (s) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export function auditSkills(all) {
  const seen = new Set(),
    skills = all.filter((s) => {
      const k = s.real || s.path;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const findings = [],
    byHash = new Map(),
    byName = new Map();
  for (const s of skills) {
    byHash.set(s.hash, [...(byHash.get(s.hash) || []), s]);
    byName.set(s.name.toLowerCase(), [
      ...(byName.get(s.name.toLowerCase()) || []),
      s,
    ]);
  }
  for (const group of byHash.values())
    if (group.length > 1)
      findings.push({
        kind: "duplicate",
        title: `${group[0].name} is installed ${group.length} times`,
        detail:
          "Identical copies can be intentional across clients. Check activation and ownership before removing an installation.",
        paths: group.map((s) => s.path),
      });
  for (const group of byName.values())
    if (new Set(group.map((s) => s.hash)).size > 1)
      findings.push({
        kind: "drift",
        title: `${group[0].name} has different versions`,
        detail:
          "Same name, different contents. Compare the relevant client and scope before choosing a version.",
        paths: group.map((s) => s.path),
      });
  const unique = [...byHash.values()].map((g) => g[0]),
    tokens = unique.map((s) => words(s.name + " " + s.description));
  for (let i = 0; i < unique.length; i++)
    for (let j = i + 1; j < unique.length; j++)
      if (
        unique[i].name.toLowerCase() !== unique[j].name.toLowerCase() &&
        jaccard(tokens[i], tokens[j]) >= 0.34 &&
        findings.length < 1024
      )
        findings.push({
          kind: "overlap",
          title: `${unique[i].name} and ${unique[j].name} share keywords`,
          detail:
            "Metadata similarity is a review lead. It does not establish equivalent behavior or justify a merge.",
          paths: [unique[i].path, unique[j].path],
        });
  for (const s of unique) {
    if (!s.description.trim())
      findings.push({
        kind: "vague",
        title: `${s.name} has no description`,
        detail:
          "Describe what it does and the task that should select it. Short descriptions can be sufficient.",
        paths: [s.path],
      });
    if (s.bytes / 4 > 5000)
      findings.push({
        kind: "heavy",
        title: `${s.name} has a large body`,
        detail:
          "This text is conditional on skill activation. Consider references for detailed procedures; size does not measure effectiveness.",
        paths: [s.path],
      });
  }
  const order = { duplicate: 0, drift: 1, overlap: 2, heavy: 3, vague: 4 };
  findings.sort((a, b) => order[a.kind] - order[b.kind]);
  const weights = { duplicate: 3, drift: 4, overlap: 3, heavy: 1, vague: 1 };
  const penalty = findings.reduce((s, f) => s + weights[f.kind], 0);
  return {
    skills: all.length,
    unique: unique.length,
    alwaysLoadedTokens: Math.round(
      skills.reduce(
        (s, x) => s + x.name.length + x.description.length + 20,
        0,
      ) / 4,
    ),
    totalTokens: Math.round(skills.reduce((s, x) => s + x.bytes, 0) / 4),
    findings,
    score: skills.length
      ? Math.max(0, Math.round(100 - (100 * penalty) / skills.length))
      : 100,
    scoreLabel: "Legacy heuristic; not an effectiveness measure",
    metadataEstimateLabel:
      "Estimated metadata tokens; client activation varies",
  };
}
