---
title: Listening for message reactions in discord.js
category: framework
updated: 2026-08-29
---

## Problem / context

Adding a feature that reacts to a user adding a reaction (e.g. the 🗑️ react-to-delete on the
bot's conversion reply, `src/events/messageReactionAdd.js`) needs more than just an event
listener — reaction events are easy to under-configure and then silently miss events for
anything not already in the client's cache (which for this bot is almost everything, since it
doesn't warm a message cache).

## Solution

1. **Gateway intent**: add `GatewayIntentBits.GuildMessageReactions` in `src/bot.js`'s `Client`
   constructor. This one is *not* privileged (unlike `MessageContent`), so no Developer Portal
   toggle is needed.
2. **Partials**: also add `partials: [Partials.Message, Partials.Channel, Partials.Reaction]`.
   Without these, a reaction on a message the bot hasn't cached (any message from before this
   process started, or evicted from cache) arrives with `reaction.partial === true` and most of
   its data missing — the event still fires, but acting on it without fetching first silently
   does the wrong thing (e.g. `reaction.emoji.name` can be present while `reaction.message`
   content is not, depending on what's partial).
3. **Fetch before using**: `if (reaction.partial) await reaction.fetch();` at the top of the
   handler, in a try/catch (the message can have been deleted between the reaction firing and
   the fetch resolving).
4. **Permission checks need a `GuildMember`, not the bare `User`** the event hands you —
   `reaction.message.guild.members.fetch(user.id)` before calling `.permissions.has(...)`.

## Gotchas

- None of this requires a new bot *permission* (OAuth scope) — only the intent above. Don't
  confuse gateway intents (what events you receive) with permissions (what actions you're
  allowed to take).
- A benign race exists between "is this still a tracked reply" and "delete it" if two people
  react in quick succession across the `await`s in between (message fetch, member fetch) — the
  second delete attempt just throws and gets caught/logged. Not worth a lock for a cosmetic
  double-react case.
- **`replyTracker.js` is a plain in-memory `Map`, empty after every restart** — a 🗑️ reaction on a
  reply from before the last restart used to silently do nothing. For a normal bot reply (sent via
  `message.reply(...)`), the fix doesn't need Redis: the reply is a real Discord reply, so
  `replyMessage.reference.messageId` already *is* the original id, persisted by Discord itself —
  fall back to it when `replyTracker` has nothing. **Gate that fallback to the bot's own
  messages** (`replyMessage.author.id === client.user.id`) — any reply-to-a-reply from a regular
  user also has a `.reference`, and without the gate it gets misidentified as one of the bot's
  tracked messages. A webhook repost has no such reference to fall back on at all (see
  `skills/webhook-identity-repost.md`), so its tracking must go through `storage.js` instead.

## Related

- `src/events/messageReactionAdd.js`, `src/replyTracker.js` (extended to a bidirectional
  original-id ⇄ reply-id map so a reaction on the *reply* can find the *original* message),
  `src/storage.js` (webhook-repost's restart-surviving tracking), `skills/webhook-identity-repost.md`.
