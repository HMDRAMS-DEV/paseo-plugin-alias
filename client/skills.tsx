import type { PluginScreenProps } from "@getpaseo/plugin/client";

type PluginTheme = PluginScreenProps["theme"];
import { openExternalUrl, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { auditRpc, COMMUNITY_URL, linkXRpc, saveSetupRpc, shareRpc } from "../shared/alias";

const KEY = ["alias", "audit"];
const SHORT = 10;
const PLAN_NEEDS_CLAUDE = "Cleanup needs Claude Code in Paseo. The plan runs in Claude Plan Mode, which cannot change files.";

function makeStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  return {
    screen: { flex: 1, backgroundColor: c.surface0 },
    body: { padding: compact ? 16 : 24, gap: 24, maxWidth: 720, width: "100%" as const, alignSelf: "center" as const },
    headline: { color: c.foreground, fontSize: compact ? 24 : 30, fontWeight: "600" as const },
    text: { color: c.foreground, fontSize: 14 },
    muted: { color: c.foregroundMuted, fontSize: 13, lineHeight: 19 },
    heading: { color: c.foreground, fontSize: 15, fontWeight: "600" as const },
    section: { gap: 8 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    name: { color: c.foreground, fontSize: 13, width: compact ? 130 : 200 },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surface2 },
    fill: { height: 6, borderRadius: 3, backgroundColor: c.accent },
    count: { color: c.foregroundMuted, fontSize: 13, width: 32, textAlign: "right" as const },
    card: { gap: 10, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 },
    code: { color: c.foreground, fontSize: 12, fontFamily: "monospace", padding: 8, borderRadius: 6, backgroundColor: c.surface2 },
    buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
    button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.surface2 },
    buttonText: { color: c.foreground, fontSize: 13 },
    primary: { backgroundColor: c.accent },
    primaryText: { color: c.accentForeground },
    link: { color: c.accent, fontSize: 13 },
    input: { color: c.foreground, fontSize: 13, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, minWidth: 180 },
    avatar: { width: 36, height: 36, borderRadius: 18 },
    danger: { color: c.statusDanger, fontSize: 13 },
  };
}

type Styles = ReturnType<typeof makeStyles>;

function Button({ s, label, onPress, primary }: { s: Styles; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[s.button, primary && s.primary]}>
      <Text style={[s.buttonText, primary && s.primaryText]}>{label}</Text>
    </Pressable>
  );
}

export function SkillsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const s = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const toast = useToast();
  const client = useQueryClient();
  const audit = useQuery({ queryKey: KEY, queryFn: useRpc(auditRpc).bind(null, {}) });
  const [handle, setHandle] = useState("");
  const callLinkX = useRpc(linkXRpc);
  const linkX = useMutation({
    mutationFn: callLinkX,
    onSuccess: ({ x }) => {
      client.setQueryData(KEY, (old: typeof audit.data) => old && { ...old, x });
      if (x) toast.show(x.verified ? "X account verified" : "X account linked", { variant: "success" });
    },
    onError: (e) => toast.error(`Could not link X. ${e.message}`),
  });
  const callShare = useRpc(shareRpc);
  const saveSetup = useRpc(saveSetupRpc);
  const share = useMutation({
    mutationFn: callShare,
    onSuccess: ({ sharedUrl }) => {
      client.setQueryData(KEY, (old: typeof audit.data) => old && { ...old, sharedUrl });
      toast.show(sharedUrl ? "Shared" : "No longer public", { variant: "success" });
    },
    onError: (e) => toast.error(`Could not reach alias.computer. ${e.message}`),
  });
  const paseo = usePaseo();
  // Starts an agent with a prompt, then opens it.
  // With readOnly, the agent runs Claude in Plan Mode. Claude cannot edit files or run commands in
  // that mode, and it leaves Plan Mode only when the user approves the plan in Paseo.
  const runAgent = useMutation({
    mutationFn: async ({ title, prompt, readOnly }: { title: string; prompt: string; readOnly?: boolean }) => {
      // Use the first agent profile set up in Paseo, so the thread gets the user's model, mode, effort and options.
      const profile = (await paseo.config.get()).config.agentProfiles?.[0];
      let config: Parameters<typeof paseo.agents.create>[0]["config"];
      if (readOnly) {
        const { providers } = await paseo.providers.listAvailable();
        if (!providers.some((p) => p.provider === "claude" && p.available)) throw new Error(PLAN_NEEDS_CLAUDE);
        const { modes = [] } = await paseo.providers.listModes("claude");
        if (!modes.some((m) => m.id === "plan")) throw new Error(PLAN_NEEDS_CLAUDE);
        let model = profile?.provider === "claude" ? profile.model : undefined;
        if (!model) {
          const { models = [] } = await paseo.providers.listModels("claude");
          model = (models.find((m) => m.isDefault) ?? models[0])?.id;
        }
        if (!model) throw new Error("Claude has no models.");
        const thinkingOptionId = profile?.provider === "claude" ? profile.thinkingOptionId : undefined;
        config = { provider: `claude/${model}`, modeId: "plan", thinkingOptionId };
      } else if (profile?.model) {
        const { provider, model, modeId, thinkingOptionId, options } = profile;
        config = { provider: `${provider}/${model}`, modeId, thinkingOptionId, options };
      } else {
        const { providers } = await paseo.providers.listAvailable();
        const ready = providers.filter((p) => p.available);
        const provider = (ready.find((p) => p.provider === "claude") ?? ready[0])?.provider;
        if (!provider) throw new Error("No agent is set up in Paseo.");
        const { models = [] } = await paseo.providers.listModels(provider);
        const model = models.find((m) => m.isDefault) ?? models[0];
        if (!model) throw new Error(`${provider} has no models.`);
        config = { provider: `${provider}/${model.id}` };
      }
      const started = await paseo.agents.create({
        config,
        cwd: audit.data!.home,
        title,
        prompt,
      });
      navigation?.openAgent({ agentId: started.id });
    },
    onSuccess: () => toast.show("Agent started", { variant: "success" }),
    onError: (e) => toast.error(`Could not start an agent. ${e.message}`),
  });
  const fixBroken = () =>
    runAgent.mutate({
      title: "Fix broken skill links",
      prompt: `These skill links point to a folder that is gone, so the skill cannot load. Check each link, then fix it with one of the commands listed under it. Do not change anything else. When you finish, tell me what you ran.\n\n${audit
        .data!.broken.map((b) => `- ${b.name}: ${b.path}\n${b.fixes.map((f) => `  ${f.why}: ${f.command}`).join("\n")}`)
        .join("\n")}`,
    });
  const cleanUp = async () => {
    let path: string;
    try {
      ({ path } = await saveSetup({}));
    } catch (e) {
      toast.error(`Could not save the audit. ${(e as Error).message}`);
      return;
    }
    runAgent.mutate({
      title: "Clean up my skills",
      readOnly: true,
      prompt: `Clean up the skills installed on this machine. Work in five steps and stop after the plan.

1. Read the audit. The alias plugin just wrote it to ${path}. It lists every installed skill, how many times each was used, duplicates and broken links. Do not download or install anything to redo it.
2. Check for updates. For each skill, find where it came from (a git remote, a plugin marketplace, or a skills lock file) and check whether a newer version exists. Say so when you cannot tell.
3. Consolidate. Claude Code reads ~/.claude/skills. Codex, Gemini CLI and Cursor read ~/.agents/skills (Gemini also ~/.gemini/skills, Codex also ~/.codex/skills). For each skill that exists as separate copies in these folders, or that one agent has and another agent that should have it lacks, propose one real copy in ~/.agents/skills with symlinks from the other agent folders. When copies differ, say which is newer and keep that one. Leave plugin, bundled and project skills where they are.
4. Check agent instructions. Read the global instruction files (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md) and the AGENTS.md or CLAUDE.md in each project the usage log shows. For each one, work out what the project is about and which installed skills fit it. Draft a short edit that names those skills and when to use them. Skip a file when it already covers this.
5. Plan. Show me one table: duplicates to remove and which copy to keep, copies to consolidate into one with links, skills that were never used or not used in 90 days, and skills with an update. Give the exact command for each row. Then show each instruction file edit as a diff.

You are in Plan Mode, so you cannot change anything yet. When the plan is ready, submit it for my approval. I may approve only some rows or some edits. After I approve, make only those changes. Then give me a short summary: how many skills were removed, how many were updated, which instruction files changed, and anything that failed or that you skipped, with the reason.`,
    });
  };
  const [confirm, setConfirm] = useState(false);
  const [allUsed, setAllUsed] = useState(false);
  const [allUnused, setAllUnused] = useState(false);

  async function copy(text: string) {
    try {
      await copyText(text);
      toast.show("Copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  }

  if (audit.isPending) {
    return (
      <View style={[s.screen, s.body]}>
        <Text style={s.muted}>Reading your skills…</Text>
      </View>
    );
  }
  if (audit.isError) {
    return (
      <View style={[s.screen, s.body]}>
        <Text style={s.danger}>Could not read your skills. {audit.error.message}</Text>
        <View style={s.buttons}>
          <Button s={s} label="Try again" onPress={() => audit.refetch()} />
        </View>
      </View>
    );
  }

  const { profile, broken, sharedUrl, x } = audit.data;
  const { used, neverUsed, agent, agents } = profile;
  const installed = used.length + neverUsed.length;
  const top = used[0]?.count ?? 1;
  const cursor = agents.Cursor ?? 0;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}>
      <View style={s.section}>
        <Text style={s.headline}>
          You use {used.length} of your {installed} skills
        </Text>
        <Text style={s.muted}>
          Counted from the logs these agents keep on this machine: {agent}.
          {cursor ? ` Cursor (${cursor} installed) keeps no usage log, so it is not counted.` : ""}
        </Text>
        <View style={s.buttons}>
          <Button s={s} label={audit.isFetching ? "Checking…" : "Check again"} onPress={() => audit.refetch()} />
        </View>
      </View>

      {used.length > 0 && (
        <View style={s.section}>
          <Text style={s.heading}>Most used</Text>
          {(allUsed ? used : used.slice(0, SHORT)).map((u) => (
            <View key={u.name} style={s.row}>
              <Text style={s.name} numberOfLines={1}>
                {u.name}
              </Text>
              <View style={s.track}>
                <View style={[s.fill, { width: `${(u.count / top) * 100}%` }]} />
              </View>
              <Text style={s.count}>{u.count}</Text>
            </View>
          ))}
          {used.length > SHORT && !allUsed && (
            <Text style={s.link} accessibilityRole="button" onPress={() => setAllUsed(true)}>
              Show all {used.length}
            </Text>
          )}
        </View>
      )}

      {neverUsed.length > 0 && (
        <View style={s.section}>
          <Text style={s.heading}>Never used ({neverUsed.length})</Text>
          <Text style={s.muted} selectable>
            {(allUnused ? neverUsed : neverUsed.slice(0, 3 * SHORT)).join(", ")}
          </Text>
          {neverUsed.length > 3 * SHORT && !allUnused && (
            <Text style={s.link} accessibilityRole="button" onPress={() => setAllUnused(true)}>
              Show all {neverUsed.length}
            </Text>
          )}
        </View>
      )}

      {broken.length > 0 && (
        <View style={s.section}>
          <Text style={s.heading}>Broken ({broken.length})</Text>
          <Text style={s.muted}>
            These links point to a folder that is gone, so your agent cannot load the skill.
          </Text>
          <View style={s.buttons}>
            <Button s={s} label={runAgent.isPending ? "Starting…" : "Fix with an agent"} onPress={fixBroken} primary />
          </View>
          <Text style={s.muted}>Or copy a command and run it yourself.</Text>
          {broken.map((b) => (
            <View key={b.path} style={s.card}>
              <Text style={s.text}>
                {b.name}
                <Text style={s.muted}>{b.used ? `  used ${b.used} times` : "  never used"}</Text>
              </Text>
              <Text style={s.muted} selectable>
                {b.path}
              </Text>
              {b.fixes.map((f) => (
                <View key={f.command} style={s.section}>
                  <Text style={s.muted}>{f.why[0].toUpperCase() + f.why.slice(1)}.</Text>
                  <Text style={s.code} selectable>
                    {f.command}
                  </Text>
                  <View style={s.buttons}>
                    <Button s={s} label="Copy" onPress={() => copy(f.command)} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.heading}>Clean up</Text>
        <Text style={s.muted}>
          Starts an agent with this audit. It looks for duplicate, unused and outdated skills, and drafts AGENTS.md edits that point each project at the skills it needs. It plans in Claude Plan Mode, which cannot change files. Nothing changes until you approve the plan in Paseo.
        </Text>
        <View style={s.buttons}>
          <Button s={s} label={runAgent.isPending ? "Starting…" : "Audit your skills"} onPress={cleanUp} primary />
        </View>
      </View>

      <View style={s.card}>
        {sharedUrl ? (
          <>
            <Text style={s.heading}>Your profile is public</Text>
            <Text style={s.muted} selectable>
              {sharedUrl}
            </Text>
            <View style={s.buttons}>
              <Button s={s} label="Copy link" onPress={() => copy(sharedUrl)} primary />
              <Button s={s} label="Open" onPress={() => openExternalUrl(sharedUrl)} />
              <Button s={s} label={share.isPending ? "Updating…" : "Update"} onPress={() => share.mutate({ public: true })} />
              <Button s={s} label="Stop sharing" onPress={() => share.mutate({ public: false })} />
            </View>
            {x ? (
              <View style={s.section}>
                <View style={s.row}>
                  {x.avatar ? <Image source={{ uri: x.avatar }} style={s.avatar} accessibilityIgnoresInvertColors /> : null}
                  <Text style={s.text}>
                    {x.name}
                    <Text style={s.muted}>{`  @${x.handle} · ${x.verified ? "verified" : "not verified"}`}</Text>
                  </Text>
                </View>
                {x.verified ? null : (
                  <Text style={s.muted}>To prove this account is yours, add the link above to your X bio or website, then check again.</Text>
                )}
                <View style={s.buttons}>
                  <Button s={s} label={linkX.isPending ? "Checking…" : "Check again"} onPress={() => linkX.mutate({ handle: x.handle })} />
                  <Button s={s} label="Remove" onPress={() => linkX.mutate({ handle: null })} />
                </View>
              </View>
            ) : (
              <View style={s.section}>
                <Text style={s.muted}>Add your X account so people can see whose profile this is. It shows your name and picture.</Text>
                <View style={s.buttons}>
                  <TextInput
                    style={s.input}
                    value={handle}
                    onChangeText={setHandle}
                    placeholder="@handle"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Your X handle"
                  />
                  <Button s={s} label={linkX.isPending ? "Linking…" : "Link X"} onPress={() => handle.trim() && linkX.mutate({ handle: handle.trim() })} />
                </View>
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={s.heading}>Share your profile</Text>
            <Text style={s.muted}>
              Put the skill names and use counts above on a public page, so other people can see what you use.
            </Text>
            <View style={s.buttons}>
              <Button s={s} label={share.isPending ? "Sharing…" : "Share"} onPress={() => setConfirm(true)} primary />
            </View>
          </>
        )}
        <Text style={s.link} accessibilityRole="link" onPress={() => openExternalUrl(COMMUNITY_URL)}>
          See what other people use
        </Text>
      </View>

      <Modal title="Share your profile?" open={confirm} onOpenChange={setConfirm}>
        <Modal.Content>
          <View style={s.section}>
            <Text style={s.text}>
              This publishes {installed} skill names and how many times you used each one to a public page on alias.computer.
            </Text>
            <Text style={s.muted}>
              The contents of your skills, their descriptions and your file paths stay on this machine. You can stop sharing at any time.
            </Text>
            <View style={s.buttons}>
              <Button
                s={s}
                label="Share"
                primary
                onPress={() => {
                  setConfirm(false);
                  share.mutate({ public: true });
                }}
              />
              <Button s={s} label="Cancel" onPress={() => setConfirm(false)} />
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </ScrollView>
  );
}
