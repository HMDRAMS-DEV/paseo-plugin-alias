# alias

See which of your installed skills you actually use.

alias scans the skill folders on this machine and the usage logs your agents keep. It counts how many times each skill ran. Everything runs inside the plugin. It downloads nothing and sends nothing unless you share.

## What the screen shows

- how many of your installed skills you have used
- your most used skills, with counts
- the skills you installed and never used
- skill links that point to a missing folder, with a command that fixes each one

Open it from the sidebar or from the Command Center under "Skill usage".

## Clean up

**Audit your skills** starts Claude in Plan Mode in your home folder. First the plugin writes its audit to `~/.alias/setup.json`. The agent reads that file and makes a plan:

- duplicate copies to remove, and which copy to keep
- copies to merge into one folder, with links for each agent
- skills you never used, or have not used in 90 days
- skills with a newer version
- edits to your AGENTS.md and CLAUDE.md files that point each project at the skills that fit it

Plan Mode is read-only. Claude cannot edit files or run commands until you approve the plan in Paseo, and you can approve only some rows. Cleanup needs Claude Code. If Claude is not set up in Paseo, the button shows an error and starts nothing. The agent downloads and installs nothing to run the audit.

**Fix with an agent** is for broken links. It starts your first Paseo profile with the fix commands shown on the screen, in that profile's permission mode.

## Sharing

Sharing is off until you turn it on. When you share, alias sends your skill names and use counts to alias.computer and gives you a public link. The contents of your skills, their descriptions and your file paths stay on your machine. You can stop sharing from the same screen.

Shared profiles feed a public table at alias.computer/skills. For each skill it shows how many people installed it, how many used it and the total number of uses.

You can add your X handle to a shared profile. The page then shows your X name and picture. To prove the account is yours, put your profile link in your X bio. alias checks for it and marks the profile verified.

## Limits

Use counts cover Claude Code, Codex and Gemini CLI. Claude Code counts each time a skill runs. Codex and Gemini count once for each session that opened the skill. Cursor keeps no usage log, so its skills show as installed and are not counted.

## Credits

The computer in the listing images is "macintosh" (https://sketchfab.com/3d-models/macintosh-a8a98ce5b4af43ca8f680cb1b005fc5d) by Olli_one, licensed under CC BY 4.0.
