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
  author's id at send time — there's no live original message left to check `.author.id` against
  later, unlike a normal reply where the original still exists. Track it through `storage.js`
  (a Redis hash when Upstash is configured, else its in-memory fallback), not a plain module-level
  `Map` — a webhook repost has no message reference either, so unlike a normal reply (which can
  recover its original id from `message.reference` after a restart, see
  `skills/discordjs-reactions.md`), a plain in-memory map here means react-to-delete permanently
  can't resolve any repost made before the last restart.
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
  that are actually just passthrough of something already in the resent text, even after
  changing WHAT that passthrough is.** A spoilered Facebook link's "conversion" was a plain
  `||url||` passthrough appended after the full original text — duplicated, since that text
  already contains the same link (wrapped per the point above). The first attempt at a fix routed
  the passthrough through a fixup host (`facebook.js`'s `spoilerFixUrl`, so a bot-built embed —
  which can't be spoiler-blurred by Discord — is replaced with a natively-unfurled one that DOES
  inherit the spoiler) and reasoned the two lines were no longer "the same content", so appending
  was safe again. **Still wrong** — the user still sees the same post twice: once as a dead
  `||<facebook.com/...>||` link (suppressed, no preview) and once as the live fixup link right
  below it. "Not byte-identical" isn't the bar; "does the user see this link twice" is. The actual
  fix is to rewrite the link **in place** inside the resent text — swap its domain to the fixup
  host *where the original URL already sits* (still inside the same `||...||` bars, so it stays
  spoilered) — instead of leaving the original wrapped-and-dead and appending a second, live copy.
  That still leaves the append-after-array split from the first fix attempt correctly in place for
  a normal reply, which never resends the original text at all and so still needs the fixup link
  as its only content line — the split was the right structure, the mistake was in what the
  in-text side of it (the resent text itself) was left containing.
- Re-sending the original's attachments works by passing the `Attachment` objects straight
  through in `files` — discord.js resolves them by URL, no manual download/re-upload needed.

## Related

- `src/webhookRepost.js`, `src/storage.js` (`trackRepostAuthor`/`getRepostAuthorId`/
  `untrackRepostAuthor`), `src/events/messageReactionAdd.js` (the "no original left to check
  authorship against" case), `src/facebook.js`'s `rewriteFacebookLinksForRepost`/`spoilerFixUrl`,
  `skills/discordjs-reactions.md`.
