# skills/

Reusable knowledge discovered while working: how-tos, debugging techniques, framework
tricks, SQL optimizations, API/UI patterns, deployment and performance solutions.

## Rules

- **Merge, never duplicate.** Before writing a new Skill, check for an existing one that
  covers the topic and edit it instead.
- One Skill = one focused topic. Bump `updated:` when you change it.
- Copy `_template.md` to start a new Skill.

## Index

<!-- Add one line per Skill: - [Title](file.md) — one-line hook -->
- [Per-guild config knob backed by storage.js](per-guild-redis-config.md) — how to add a new per-guild setting (storage + slash command + admin API + admin panel), and the `Object.hasOwn` gotcha for whitelist checks keyed by user-supplied strings.
- [Listening for message reactions in discord.js](discordjs-reactions.md) — the intent + partials + fetch-before-use setup a reaction-triggered feature needs, and why it's not a new bot permission.
- [Reposting a message under another user's identity via webhook](webhook-identity-repost.md) — the channel-webhook mechanism, its unavoidable limitations (no reply context, lost reactions), and the Facebook-embed-duplication trap resending full original text can spring.
