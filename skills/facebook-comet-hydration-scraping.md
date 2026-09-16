---
title: Scraping video/caption/image/engagement out of Facebook's Comet SPA JSON
category: api
updated: 2026-09-16
---

## Problem / context

`src/facebook.js` builds a native embed (and, for Reels/videos, a playable link) from a
Facebook post/Reel/video URL by fetching the page and picking data out of it — there's no
public API for this. Facebook serves two very different page shapes depending on the
request:

- **Anonymous / `facebookexternalhit` crawler UA** (no `cookie` configured): a lighter
  "link preview" response. `og:*` meta tags are often present for plain posts. Reels/videos
  expose no `og:video` at all — only a `browser_native_hd_url`/`browser_native_sd_url`
  field pointing at `lookaside.fbsbx.com/lookaside/crawler/media/` (see Gotchas).
- **Logged-in / real browser UA + `Cookie`** (`FACEBOOK_COOKIE` set): the actual Comet SPA
  shell — often *no* `og:*` tags at all (`<title>Facebook</title>` or similarly generic),
  but the page's hydration JSON has much richer, more reliable data: a genuinely playable
  `progressive_urls` video field, and a newer engagement-count shape. It also bundles a lot
  of *unrelated* JSON on the same page — other feed items, ads, a suggested/"up next" Reels
  tray, the viewer's own nav furniture — which is the source of nearly every bug below.

## Solution

**Video, in priority order** (see `extractFacebookPost` in `src/facebook.js`):
1. `og:video`/`og:video:secure_url`/`og:video:url` meta tag, if present.
2. `progressive_urls` (`extractProgressiveVideoUrl`) — only present with a cookie, a
   fully-signed, genuinely playable CDN URL. Anchored by finding the video's own id inside
   a `dash_manifest_urls[].manifest_url` value (`dash_mpd_debug.mpd?v=<id>`) — the page
   repeats this shape once per video referenced (the post's own, plus any "up next" reels),
   so the id anchor is what picks out the right one. Picks the `"quality":"HD"` entry over
   `"SD"` when both are present.
3. `browser_native_hd_url`/`browser_native_sd_url` (`extractBrowserNativeVideoUrl`),
   scoped to the post's own `"story":{...}` object — the crawler-only fallback. **HEAD-verify
   it before trusting it** (`verifyVideoUrl`): this specific `lookaside.fbsbx.com` endpoint
   only resolves for Facebook's own crawler infrastructure and reliably 500s when fetched by
   a third party (confirmed by direct `curl`), regardless of User-Agent. Trading verification
   away (`FACEBOOK_TRUST_UNVERIFIED_VIDEO`) doesn't make the dead ones play — it just posts a
   video link that won't load. Getting more videos to actually play requires a cookie
   (progressive_urls), not skipping this check.

**The video id must come from where the fetch actually landed, not the URL that was
requested.** A `/share/v/<code>/` link's own URL has no video id in it at all (an opaque
short code) — Facebook redirects it to the real `/reel/<id>/` or `/videos/<id>/` URL, and
only `response.url` (after `redirect: 'follow'`) has it. Read the id from `response.url`
first, falling back to the requested `url` only if that didn't resolve one.

**A page can have a video with *no* caption, image, or `og:*` tags at all** (seen on
`/watch/?v=` pages) — check for video presence (an `og:video*` tag, `browser_native_*_url`,
or a `dash_mpd_debug.mpd?v=` manifest url) as its own signal, independent of whether there's
also a caption/photo, or the whole extraction bails out before ever trying video extraction.

**Image**: prefer `"photo_image":{"uri":...}` over the generic `"image":{"uri":...}` key —
`photo_image` is specific to a real photo *attachment*, whereas plain `"image"` matches all
kinds of unrelated page furniture (see Gotchas). Both need to be scoped to the post's own
`"story":{...}` object (`extractJsonObject`), not searched unscoped across the whole page.

**Caption, reactions, comments, shares**: anchor on the post's own **feedback id**
(`findFeedbackId` — a `"ZmVlZGJhY2s6..."`-prefixed base64 string, read out of the post's own
`"story"` fragment) and search *near* that exact id (`findMatchNearId`/`findNumberNearId`, a
~500-char radius) rather than scoping to a single JSON object or taking "whichever occurrence
comes first in the page". A different post's identically-shaped fields sit **hundreds of
thousands of characters away** in practice, so a modest radius safely excludes them while
still finding the real one, which sits only ~100 chars from an occurrence of the id.
Engagement counts come in two different shapes depending on post/page type, both cookie-only:
- Older: `"unified_reactors":{"count":N}` + `"total_comment_count":N` +
  `"share_count_reduced":"N"`.
- Newer (seen on a plain page post): three separate `"UFI...ActionRenderer"` fragments, each
  repeating the feedback id next to its own `reaction_count`/`comment_rendering_instance...
  total_count`/`share_count` field.

**Author name (used as the embed's title)**: when `og:title` is missing (the Comet shell
case), the post's author/page name is *not* inside the single `"story":{...}` object either —
it's a separate top-level fragment, found the same way as the caption (anchored on the post's
own feedback id via `findMatchNearId`), but needs a much wider radius: observed sitting
several **thousand** characters from the feedback id, not the ~100 the caption sits at. Two
different shapes depending on post type, both need trying:
- Plain post/photo: `"actors":[{"__typename":"...","name":"..."}]`.
- Reel: no `actors` array at all — the creator is under a top-level
  `"owner":{"__typename":"User",...,"name":"..."}` instead.
A page also bundles *other* posts' actors/owners (feed suggestions, comments) — like the
caption case, these sit **hundreds of thousands of characters away** in practice, so a
generous (~10,000-char) radius still doesn't risk picking one up by accident.

**Cookie health**: a login wall (`looksLikeLoginWall`) with no cookie configured is normal
(Facebook just doesn't trust the plain crawler UA with everything) and should stay silent.
A login wall *with* a cookie configured means that session has died (expired, logged out
elsewhere, checkpointed) and **every subsequent fetch using it will silently degrade** back
to no-video/no-engagement behavior with nothing pointing at the cause — `console.warn` it
explicitly so it's visible in logs instead of just looking like a mystery regression.

## Gotchas

- **"First match in the page" is not a stable heuristic for anything on a Facebook Comet
  page — confirmed non-deterministic, not just theoretically risky.** The same URL fetched
  moments apart returned a *different* Reel's caption first each time (the personalized "up
  next" tray's position shifts between requests). Every extraction here must anchor on a
  verified-correct id (the requested video's own id from the URL, or the post's own feedback
  id) and search near/within that scope — never "whichever text/field shows up earliest".
- **The generic `"image":{"uri":...}` key matches page furniture, not just other posts'
  photos** — on one real page it matched the *viewer's own account's nav-bookmark avatar*
  (a `"bookmark_type":"type_self_timeline"` entry in the sidebar), which happened to sit
  before the real post's `photo_image` in raw document order. An unscoped/naive "first
  image on the page" search will confidently return the wrong picture, not fail loudly.
- **A `"story":{...}` object found via "first occurrence in the page" is not guaranteed to
  be the post's own, and even when it is, isn't guaranteed to carry every field.** Facebook
  fragments one post's data across *several* separate `"story"` occurrences — e.g. one
  fragment might carry the caption, a much larger one elsewhere the feedback id + reaction
  counts. `extractJsonObject(html, /"story":\{/)` only ever returns the first; treat a
  missing field there as "not in this fragment", not "not on the page", and fall through to
  an id-anchored search rather than giving up.
- **Discord will not auto-unfurl a video link into a native inline player on any message
  that also carries the bot's own non-empty `embeds`.** A Facebook video/Reel link can only
  play inline through Discord's own link-unfurl (a bot-attached embed can't carry playable
  video at all — Discord ignores the `video` field on bot/webhook embeds), and that
  auto-unfurl gets skipped entirely once the same message create/edit call also sets
  `embeds`. When a post has both a video link and an info embed (title/author/caption/
  reactions), they must go out as **two separate messages** — see
  `buildReplyPayloads` in `src/linkConversion.js` — not combined into one. Sent in that
  order (embed first, so it reads like a caption above the video) — which also means the
  message-tracking used for edit-sync/react-to-delete (`replyTracker`) has to explicitly
  track the *content-carrying* reply, not just "whichever one went out first", once the
  order isn't send-order-equals-tracking-order anymore. This same combined-payload trap
  applies to `webhookRepost.js`'s `webhook.send()` too, not just a normal bot reply.
- A `HEAD` request timing out or 500ing from *your own* network doesn't necessarily mean
  Discord's own unfurl (fetched from a different network) would fail the same way — but for
  `lookaside.fbsbx.com` specifically, it really is broken for anyone but Facebook's own
  crawler infra (verified with plain `curl`, multiple UAs, immediate retries — consistently
  500/errors), so don't assume every verification failure is a false negative.
- **A page's display name matching its own caption's hashtag verbatim is real, not a
  mis-extraction** — confirmed live (a page literally named the same Thai phrase used as its
  post's hashtag). Don't second-guess a correctly-anchored (feedback-id-scoped) match just
  because the string also appears elsewhere on the page for an unrelated-looking reason.

## Related

- `src/facebook.js` — `extractFacebookPost`, `extractProgressiveVideoUrl`,
  `extractVideoIdFromUrl`, `extractBrowserNativeVideoUrl`, `verifyVideoUrl`,
  `extractEmbeddedPostData`, `findFeedbackId`, `findMatchNearId`/`findNumberNearId`,
  `extractEngagementCounts`, `looksLikeLoginWall`.
- `src/linkConversion.js` (`buildReplyPayloads`), `src/events/messageCreate.js`/
  `messageUpdate.js`, `src/webhookRepost.js` (`repost`'s `hasVideo` split).
- `skills/webhook-identity-repost.md` — the related "don't resend/duplicate a link whose
  embed is built elsewhere" trap in the webhook-repost path specifically.
