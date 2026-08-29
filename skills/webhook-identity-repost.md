---
title: Reposting a message under another user's identity via webhook
category: framework
updated: 2026-08-29
---

## Problem / context

A feature wants a message to visually appear as if a different (real) user posted it — e.g.
`src/webhookRepost.js`'s webhook-repost mode reposts a fixed link as the original author instead
of the bot replying as itself. Discord has no "post as another account" API; a channel webhook is
the actual mechanism.

## Solution

- Webhooks belong to a **channel**, not a message. Fetch/reuse one the bot created
  (`channel.fetchWebhooks()`, filter by `w.owner?.id === client.user.id`) or create one
  (`channel.createWebhook({ name })`) — cache per channel, it's cheap and self-healing (a
  deleted-out-from-under-you webhook just fails the next send, drop the cache entry, retry).
- `webhook.send({ username, avatarURL, ... })` posts under any supplied name/avatar — not tied to
  a real account, visually indistinguishable from a normal message, no special "bot"/"app" badge.
- **Cache the in-flight creation *promise*, not just the resolved webhook** — two messages
  processed concurrently in a channel with nothing cached yet will otherwise both miss the cache
  check and both create a webhook. Store the async IIFE's promise in the map immediately, await it
  on every caller.
- A **thread**'s messages go through its *parent* channel's webhook, with `threadId` set on
  `send()` — `channel.fetchWebhooks()`/`createWebhook()` don't exist on a `ThreadChannel` itself.
- **Order matters for anything destructive**: only delete/mutate the original *after* the webhook
  send has fully succeeded, and treat the whole operation as best-effort — catch any failure
  (missing `Manage Webhooks`, a rejected username, a transient error) and fall back to whatever
  the feature did before (e.g. a normal bot reply), never leave the user's content unhandled.
  Even the follow-up delete can itself fail — fall back further still (e.g. suppress the
  original's embed) rather than silently leaving two live messages.

## Gotchas

- **A webhook message can't carry `reply`/`message_reference` context** — if the original was
  itself a reply to something, that context is lost. No workaround short of manually rendering a
  fake reply-quote block; not worth building.
- **Reactions on the original are lost** — it's a brand-new message id. If the feature also wants
  a "react to undo" affordance (see `skills/discordjs-reactions.md`), track the impersonated
  author's id in its own small map at send time — there's no live original message left to check
  `.author.id` against later, unlike a normal reply where the original still exists.
- **Reposting the whole original text verbatim can resurrect problems a *different* code path
  already solved.** Here, Facebook links get their own native embed/video-link built separately
  (`src/facebook.js`), and a normal bot reply's content is built *only* from that converted
  output — the raw original text (and any raw Facebook URL in it) never appears in it. Webhook
  mode reposts the *whole original message*, so a raw Facebook URL sitting in it would otherwise
  get a second, broken auto-embed from Discord alongside the real one. Fixed by wrapping the raw
  URL in `<...>` — Discord's own per-link embed-suppression syntax — rather than
  `message.suppressEmbeds()`, which is all-or-nothing per message and would have also killed the
  auto-embed for the *actually-fixed* platform link sitting right next to it in the same repost.
  The general lesson: when a feature changes *how much of the surrounding content* gets resent,
  re-check every other special-cased link type for text that was previously invisible to the
  user (suppressed on a message being deleted anyway) but is now live in a fresh message.
- **The fix above wasn't the whole story — a "genuinely new content" array can carry entries
  that are actually just passthrough of something already in the resent text.** A spoilered
  Facebook link's only "conversion" is a plain `||url||` passthrough line, pushed into the same
  array as real new content (video/CDN links) — fine for a normal reply (the passthrough IS the
  reply's only content), but in webhook mode that same array gets appended *after* the full
  original text, which already contains that spoilered link (now wrapped per the point above) —
  appending the passthrough again prints the same link twice. Caught by the user testing a
  message that was *only* the spoilered link (no other link to mask it). Fixed by splitting
  "genuinely new" entries from "already represented elsewhere" ones into two separate arrays at
  the source, rather than trying to filter one shared array after the fact.
- Re-sending the original's attachments works by passing the `Attachment` objects straight
  through in `files` — discord.js resolves them by URL, no manual download/re-upload needed.

## Related

- `src/webhookRepost.js`, `src/events/messageReactionAdd.js` (the "no original left to check
  authorship against" case), `src/facebook.js`'s `suppressFacebookLinksInText`,
  `skills/discordjs-reactions.md`.
