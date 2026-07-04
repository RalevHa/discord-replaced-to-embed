# Discord Link Replacer Bot

Automatically detects supported social-media links in messages, suppresses their broken
auto-embed, and replies with embeddable alternatives so they preview properly in Discord.

- 🔗 **Auto-converts** links from 5 platforms (see [Supported Platforms](#supported-platforms))
- 📘 **Native Facebook embeds** — scrapes Open Graph data, no self-hosted proxy required
- 🛡️ **Spam protection** against hijacked accounts blasting the same message across channels
- 💬 **Slash commands** for manual conversion, stats, and per-server control
- 💾 **Optional persistence** via Upstash Redis (survives restarts/redeploys)
- ☁️ **Deploy-ready** for Render's free tier with a built-in health check

## Features

### How It Works

1. The bot listens to messages in allowed servers (skipping servers disabled via `/toggle`).
2. It checks whether the message contains a supported link (rewritable, Facebook, or both).
3. If so, it:
   - **Suppresses** the original message's auto-embed (the broken preview), and
   - **Replies** with the converted links (which Discord auto-embeds) and/or native
     Facebook embeds, without pinging the author.

### Supported Platforms

Any leading subdomains (`www.`, `vt.`, `vm.`, `old.`, …) are matched and dropped, so a
single rule per platform covers every link form.

| Platform | Input | Output |
|---|---|---|
| TikTok | `https://(sub.)tiktok.com/PATH` | `https://a.tnktok.com/PATH` |
| Bilibili | `https://(sub.)bilibili.com/PATH` | `https://www.vxbilibili.com/PATH` |
| X (Twitter) | `https://(sub.)x.com/PATH` | `https://fixupx.com/PATH` |
| Pixiv | `https://(sub.)pixiv.net/PATH` | `https://www.phixiv.net/PATH` |
| Bluesky | `https://(sub.)bsky.app/PATH` | `https://bskx.app/PATH` |

> These embed services are community-run and occasionally rename or go down. If a platform
> stops embedding, just swap the new host in its rule — see [Adding a platform](#adding-a-platform).

### Facebook (native embed, no proxy needed)

Facebook doesn't have a reliable public "fixup" host to redirect to, so it's handled
differently from the platforms above: instead of rewriting the link, the bot fetches the post
itself — spoofing Facebook's own link-preview crawler user-agent — extracts its Open Graph
tags, and either posts a native Discord embed (title, description, image) or, for Reels and
videos, the direct video URL as plain text so Discord's own unfurler plays it inline (a
bot-built embed can't carry playable video). No self-hosted proxy, no credentials, no
headless browser.

- Works out of the box; no configuration required.
- If the post is behind a login wall (deleted post, private group, or Facebook rate-limiting
  your server's IP) the bot just leaves the message alone, same as an unsupported link.
- Results are cached in-memory for 15 minutes so re-shares of the same post don't refetch.
- Set `FACEBOOK_EMBED_ENABLED=false` to disable this feature entirely.

This only extracts what's in the page's OG tags — title/description/image/video. It doesn't
fetch engagement stats (likes/comments). Video links come straight from Facebook's CDN and
are often signed/time-limited, so an old re-share may no longer play even though the original
post still does — see [Facebook video proxy](#facebook-video-proxy-optional) below for a more
durable option.

#### Facebook video proxy (optional)

If `FACEBOOK_PROXY_BASE_URL` is set, Reel/video links are posted as
`{FACEBOOK_PROXY_BASE_URL}/fb/<encoded-url>` instead of the raw CDN URL. That route (served by
the bot's own HTTP server, `src/facebookProxy.js`) detects link-preview crawlers (Discord,
Slack, …) and serves a synthetic page with [Twitter Player
Card](https://developer.x.com/en/docs/twitter-for-websites/cards/guides/getting-started) meta
tags pointing at the video, which Discord's unfurler renders as a native playable video —
real visitors following the link are redirected straight to the original Facebook post.

This requires the bot's HTTP server (the same one used for the Render/UptimeRobot health
check) to be reachable from the public internet at that URL — see
[Run it yourself with Cloudflare Tunnel](#option-b-run-it-yourself-with-cloudflare-tunnel).
Leave `FACEBOOK_PROXY_BASE_URL` unset to keep posting the raw CDN URL instead.

### Spam protection

Hijacked accounts typically blast the **same message across many channels within seconds**.
The bot watches for exactly that pattern: when one member posts the same text (normalized —
case and whitespace insensitive) in `SPAM_CHANNEL_THRESHOLD`+ distinct channels within
`SPAM_WINDOW_SECONDS`, it:

1. **Times the member out** for `SPAM_TIMEOUT_MINUTES` (reversible — the account belongs to a
   real, compromised member).
2. **Deletes** the offending messages across the affected channels.
3. **Alerts moderators** with an embed in `MOD_LOG_CHANNEL_ID` (if set).

Tracking is per `(server, member)` and in-memory — flooding happens in seconds, so it needs
no persistence and works without Redis. The count of handled incidents is shown in `/stats`.

**Never actioned:** bots, the server owner, anyone with Administrator / Manage Server /
Moderate Members, members holding a `SPAM_TRUSTED_ROLE_IDS` role, and messages in
`SPAM_IGNORED_CHANNEL_IDS`. Matching on identical text keeps false positives near zero.

> The bot needs the **Moderate Members** and **Manage Messages** permissions, and its role
> must sit **above** the members it should be able to time out. If a timeout fails, the
> mod-log embed says so. Set `SPAM_DETECTION_ENABLED=false` to turn the feature off.

### Slash Commands

Registered automatically on startup (per-guild when `ALLOWED_GUILD_IDS` is set — instant —
otherwise globally, which can take up to ~1h to appear).

| Command | Who | Description |
|---|---|---|
| `/convert <url>` | everyone | Manually convert link(s) in the given text. |
| `/sources` | everyone | List the supported platforms. |
| `/stats` | everyone | Conversions counted (all-time with Upstash, else since last restart). |
| `/ping` | everyone | Bot round-trip + WebSocket latency. |
| `/toggle` | Manage Server | Enable/disable automatic conversion in the current server. |
| `/help` | everyone | What the bot does and the command list. |

## Setup

### 1. Create a Discord bot

1. Go to <https://discord.com/developers/applications>
2. Click **New Application** and give it a name.
3. Open the **Bot** tab → **Add Bot**.
4. Under **Privileged Gateway Intents**, enable ✅ **Message Content Intent**.
5. Copy the **Token** — you'll need it below.

### 2. Invite the bot

In the **OAuth2 → URL Generator** tab:

- **Scopes:** `bot`, `applications.commands` *(the second is required for slash commands)*
- **Bot Permissions:** Read Messages / View Channels, Send Messages,
  Manage Messages *(to suppress embeds and delete spam)*, Embed Links,
  Moderate Members *(to time out spammers — see [Spam protection](#spam-protection))*

Open the generated URL to invite the bot to your server.

### 3. Install and run

```bash
npm install

# Provide your token (see Configuration below for all options)
export DISCORD_BOT_TOKEN=your_token_here

npm start
```

Or load variables from a `.env` file — `npm start` already runs with `--env-file=.env`:

```bash
cp .env.example .env   # then edit .env and add your token
npm start
```

## Configuration

| Env var | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | ✅ | Your bot token. |
| `ALLOWED_GUILD_IDS` | — | Comma-separated server (guild) IDs the bot acts in. Empty = all servers. |
| `PORT` | — | Port for the health-check HTTP server (any path returns `ok`). Defaults to `3000`; Render sets this automatically. |
| `FACEBOOK_EMBED_ENABLED` | — | Set to `false` to disable native Facebook embeds. Defaults to enabled. |
| `FACEBOOK_PROXY_BASE_URL` | — | Public URL the bot's HTTP server is reachable at, for playable Facebook video embeds. See [Facebook video proxy](#facebook-video-proxy-optional). Empty = post the raw CDN URL instead. |
| `UPSTASH_REDIS_REST_URL` | — | Upstash Redis REST URL. Enables persistence (see below). |
| `UPSTASH_REDIS_REST_TOKEN` | — | Upstash Redis REST token (pairs with the URL above). |
| `SPAM_DETECTION_ENABLED` | — | Set to `false` to disable spam detection. Defaults to enabled. |
| `SPAM_CHANNEL_THRESHOLD` | — | Distinct channels the same text must hit to trip detection. Default `3`. |
| `SPAM_WINDOW_SECONDS` | — | Sliding time window for the channel count. Default `15`. |
| `SPAM_TIMEOUT_MINUTES` | — | How long to time the spammer out. Default `10`. |
| `MOD_LOG_CHANNEL_ID` | — | Channel ID for moderation alerts. Empty = console only. |
| `SPAM_TRUSTED_ROLE_IDS` | — | Comma-separated role IDs exempt from spam detection. |
| `SPAM_IGNORED_CHANNEL_IDS` | — | Comma-separated channel IDs to skip. |

To get a server ID, enable **Developer Mode** (User Settings → Advanced), then right-click
the server → **Copy Server ID**:

```
ALLOWED_GUILD_IDS=123456789012345678,987654321098765432
```

> ⚠️ Never commit `.env` — it holds your token. It's already in `.gitignore`. If a token is
> ever exposed, regenerate it in the Developer Portal.

### Persistence (optional)

Without the two `UPSTASH_*` variables the bot runs fine, but `/toggle` state and `/stats`
are kept in memory and reset on every restart. Render's free filesystem is ephemeral, so to
survive restarts/redeploys, store them in [Upstash Redis](https://upstash.com) (free
serverless tier, HTTP-based):

1. Create a free database at [console.upstash.com](https://console.upstash.com) → **Create Database** (Redis).
2. Copy the **REST API** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Add both as env vars (locally in `.env`, or in the Render dashboard).

## Deployment

### Option A: Render free tier + UptimeRobot

The bot runs a tiny HTTP server so Render's free **Web Service** has a port to bind, and so
UptimeRobot can keep it awake (free instances sleep after ~15 min idle). It also serves
bilingual (English/Thai) `/tos` and `/privacy` pages — handy for Discord's application
Terms of Service / Privacy Policy URL fields.

1. On [Render](https://render.com): **New → Web Service**, connect this repo.
   - **Build command:** `npm install`
   - **Start command:** `node index.js`
   - Add env var `DISCORD_BOT_TOKEN` (Render provides `PORT` itself).
   - *(Optional)* Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so `/toggle`
     and `/stats` survive redeploys.
2. On [UptimeRobot](https://uptimerobot.com): add an **HTTP(s)** monitor pointing at your
   Render URL (e.g. `https://your-app.onrender.com/`), interval 5 min. Any path returns `ok`.

Render's free tier caps out at 750 instance-hours/month, 100 GB bandwidth, and an ephemeral
filesystem (hence Upstash for persistence) — fine for a small bot, but worth knowing about.

### Option B: Run it yourself with Cloudflare Tunnel

Running on your own machine (a always-on PC, home server, etc.) avoids Render's limits
entirely, and — if you already manage a domain on Cloudflare — [Cloudflare
Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(`cloudflared`) gives it a public HTTPS URL with no router/port-forwarding changes. This is
also what makes [`FACEBOOK_PROXY_BASE_URL`](#facebook-video-proxy-optional) usable, since that
needs the bot's HTTP server to be reachable from the internet.

1. Install `cloudflared` ([download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
2. Authenticate it against the Cloudflare account that manages your domain:
   ```bash
   cloudflared tunnel login
   ```
3. Create a tunnel and route a hostname to it (pick any subdomain, e.g. `fb.yourdomain.com`):
   ```bash
   cloudflared tunnel create discord-bot
   cloudflared tunnel route dns discord-bot fb.yourdomain.com
   ```
4. Point the tunnel at the port the bot listens on (`PORT` in `.env`, default `3000`) — create
   `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: discord-bot
   credentials-file: /path/to/<tunnel-id>.json   # printed by `tunnel create`
   ingress:
     - hostname: fb.yourdomain.com
       service: http://localhost:3000
     - service: http_status:404
   ```
5. Run the tunnel (in its own terminal/process, alongside the bot):
   ```bash
   cloudflared tunnel run discord-bot
   ```
6. Add `FACEBOOK_PROXY_BASE_URL=https://fb.yourdomain.com` to `.env`, then start the bot as
   usual (`npm start`).

A few things Render handled for you that you're now responsible for:
- **Uptime**: no free UptimeRobot-style wake-up needed (nothing sleeps), but if the machine
  reboots or the process crashes, nothing restarts it automatically — run it under a process
  manager (e.g. `pm2 start index.js` or a systemd/Windows service) if you want that.
- **Staying online**: on a laptop, disable sleep-on-lid-close / automatic sleep while plugged
  in, or the bot (and tunnel) will go offline whenever the lid shuts.
- **Persistence**: the filesystem is no longer ephemeral, but `UPSTASH_REDIS_REST_URL`/`TOKEN`
  are still worth keeping if you might reinstall/move machines later.

## Project Structure

```
index.js                  Entry point — starts the bot, re-exports rules for tests
src/
  config.js               All environment-variable parsing (one object)
  rules.js                Pure link logic: RULES, TRIGGER, applyReplacements (no deps)
  facebook.js             Facebook native embed: URL detection, OG-tag scraping, embed builder
  facebookProxy.js        HTTP proxy for playable Facebook video embeds (Twitter Player Card)
  spam.js                 Pure cross-channel flood detection: createFloodTracker (no deps)
  moderation.js           Discord-side spam response: isExempt, handleFlood (timeout/delete/alert)
  storage.js              Persistence behind one interface (Upstash Redis ⇄ in-memory)
  bot.js                  Wires up the client, events, command registration, health server
  events/
    messageCreate.js      Auto-conversion + Facebook embeds + spam-detection handler
    interactionCreate.js  Slash-command dispatcher
  commands/
    index.js              Command registry (the list every command is pulled from)
    ping.js  convert.js  sources.js  toggle.js  stats.js  help.js
  spam.test.js            Unit tests for the flood-detection logic
  facebook.test.js        Unit tests for Facebook URL detection + OG-tag extraction (mocked fetch)
  facebookProxy.test.js   Unit tests for the video-proxy crawler detection and HTML/routing
index.test.js             Unit tests for the link logic
```

Each event/command handler receives a shared context `{ client, config, storage, commands,
rules, spam }`, so nothing reaches into `process.env` or globals directly.

## Development

### Adding a platform

Add a one-liner to the `RULES` array in `src/rules.js` — `[label, domain, newHost]`. The
match pattern and early-exit trigger build themselves:

```js
const RULES = [
  // ...
  ['Instagram', 'instagram.com', 'kkinstagram.com'],
];
```

Just list the bare domain — subdomains (`www.`, `vt.`, `m.`, …) are handled automatically,
so there's no ordering requirement.

### Adding a slash command

1. Create `src/commands/<name>.js` exporting `{ data, execute }`:

   ```js
   const { SlashCommandBuilder } = require('discord.js');

   module.exports = {
     data: new SlashCommandBuilder().setName('hello').setDescription('Say hi'),
     // ctx = { client, config, storage, commands, rules }
     async execute(interaction, ctx) {
       await interaction.reply({ content: 'Hi!', ephemeral: true });
     },
   };
   ```

2. Add it to the `list` in `src/commands/index.js`.

That's it — registration, dispatch, and the `/help` listing all read from the registry
automatically.

### Running tests

The link-rewriting logic lives in `src/rules.js` with zero dependencies, so it imports and
runs under Node's built-in test runner without booting Discord:

```bash
npm test
```

Add a case by appending a `[description, input, expectedOutput, expectedLabels]` row to the
`cases` array in `index.test.js`.
