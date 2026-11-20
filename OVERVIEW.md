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

**Clean up with an agent** starts an agent in your home folder. First the plugin writes its audit to `~/.alias/setup.json`. The agent reads that file and makes a plan:

- duplicate copies to remove, and which copy to keep
- copies to merge into one folder, with links for each agent
- skills you never used, or have not used in 90 days
- skills with a newer version
- edits to your AGENTS.md and CLAUDE.md files that point each project at the skills that fit it

The agent stops at the plan. It changes nothing until you approve, and you can approve only some rows. It downloads and installs nothing to run the audit.

**Fix with an agent** works the same way for broken links. It starts an agent with the fix commands shown on the screen.

## Sharing

Sharing is off until you turn it on. When you share, alias sends your skill names and use counts to alias.computer and gives you a public link. The contents of your skills, their descriptions and your file paths stay on your machine. You can stop sharing from the same screen.

Shared profiles feed a public table at alias.computer/skills. For each skill it shows how many people installed it, how many used it and the total number of uses.

You can add your X handle to a shared profile. The page then shows your X name and picture. To prove the account is yours, put your profile link in your X bio. alias checks for it and marks the profile verified.

## Limits

Use counts cover Claude Code, Codex and Gemini CLI. Claude Code counts each time a skill runs. Codex and Gemini count once for each session that opened the skill. Cursor keeps no usage log, so its skills show as installed and are not counted.

## Credits

The computer in the listing images is "macintosh" (https://sketchfab.com/3d-models/macintosh-a8a98ce5b4af43ca8f680cb1b005fc5d) by Olli_one, licensed under CC BY 4.0.
