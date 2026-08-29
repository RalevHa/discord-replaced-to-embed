---
title: Per-guild config knob backed by storage.js
category: how-to
updated: 2026-08-29
---

## Problem / context

The bot needs a new piece of per-Discord-guild configuration (like the disabled-guilds toggle,
the roll-channel allowlist, or the fixer-host override) that must: survive a restart when
Upstash Redis is configured, still work with no Redis configured (in-memory fallback), be
settable via a slash command, and be settable via the admin panel too.

## Solution

Follow the existing `rollChannels`/`fixerOverrides` shape in `src/storage.js` end to end —
don't invent a new persistence pattern:

1. **`src/storage.js`**: add a `KEYS.yourThing` hash key, an in-memory `Map<guildId, value>`
   cache, and hydrate it in `init()` via `redis.hgetall(KEYS.yourThing)` — guard every loaded
   entry's shape (`typeof x === 'object'` / `Array.isArray(x)`) and `console.error` + skip a
   malformed one instead of throwing, so old/corrupted data can't crash boot.
2. Expose a **sync getter** (cache-only read, safe to call on every message) and **async
   setter(s)** that update the cache first, then `redis.hset`/`hdel` only if `redis` is
   configured (`if (!redis) return;` after the cache write).
3. **Validate at the write boundary, not just in storage.** Anything a Discord user or admin-
   panel request supplies (a platform label, a host, a channel ID) should be checked against a
   known-good set (e.g. `Object.hasOwn(WHITELIST, key) && WHITELIST[key].includes(value)`)
   *before* it's ever passed to the storage setter — both from the slash command AND from the
   admin API route, since they're two independent entry points into the same storage call.
4. **Slash command**: mirror `src/commands/roll-channel.js`/`fixer.js` — subcommands,
   `PermissionFlagsBits.ManageGuild` on the whole command (including any `list` subcommand),
   guild-only guard (`if (!interaction.guild) ...`).
5. **Admin API** (`src/adminApi.js`): add routes inside the existing `authed` router (after
   `authed.use(auth.requireAuth)`), following the `roll-channels` routes right above them.
6. **Admin panel UI** (`admin-panel/src/pages/Guilds.jsx`): add a new expandable section per
   guild row with its own `expandedX` state (parallel to `expanded`, not reusing it) and a
   sibling component to `RollChannels`/`FixerPanel`, calling matching `admin-panel/src/api.js`
   methods.

## Gotchas

- `label`/`key` used as an object-property lookup (`WHITELIST[label]`) must be guarded with
  `Object.hasOwn(WHITELIST, label)` before indexing — a value like `"__proto__"` or
  `"constructor"` resolves to an inherited `Object.prototype` member instead of `undefined`,
  and calling `.includes()` on that throws instead of failing closed. This bit the fixer-host
  override feature (`isValidFixerHost` in `src/rules.js`) — caught by a security review before
  commit, not by the original implementation.
- A route param containing spaces/parens (e.g. a label like `"X (Twitter)"`) needs
  `encodeURIComponent` on the frontend when building the URL — Express decodes it back
  automatically on `req.params`.
- Don't reuse an existing `expanded` state for a second expandable panel on the same row —
  give each panel its own state so both can be open independently.

## Related

- `src/storage.js`, `src/commands/fixer.js`, `src/adminApi.js`,
  `admin-panel/src/pages/Guilds.jsx` — the reference implementation this Skill describes.
