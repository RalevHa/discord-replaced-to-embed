# Discord Link Replacer Bot

Automatically detects supported social links in messages, suppresses their broken auto-embed, and replies with embeddable alternatives so they preview properly.

## Replacement Rules

Any leading subdomains (`www.`, `vt.`, `vm.`, `old.`, …) are matched and dropped, so a single rule per platform covers every link form.

| Platform | Input | Output |
|---|---|---|
| TikTok | `https://(sub.)tiktok.com/PATH` | `https://a.tnktok.com/PATH` |
| Bilibili | `https://(sub.)bilibili.com/PATH` | `https://www.vxbilibili.com/PATH` |
| X (Twitter) | `https://(sub.)x.com/PATH` | `https://fixupx.com/PATH` |
| Pixiv | `https://(sub.)pixiv.net/PATH` | `https://www.phixiv.net/PATH` |
| Reddit | `https://(sub.)reddit.com/PATH` | `https://rxddit.com/PATH` |
| Threads | `https://(sub.)threads.net/PATH` | `https://vxthreads.net/PATH` |
| Bluesky | `https://(sub.)bsky.app/PATH` | `https://bskx.app/PATH` |

> These embed services are community-run and occasionally rename or go down. If a platform stops embedding, just swap the new host in its rule.

## Setup

### 1. Create a Discord Bot
1. Go to https://discord.com/developers/applications
2. Click **New Application**, give it a name
3. Go to **Bot** tab → **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent**
5. Copy the **Token** — you'll need it shortly

### 2. Invite the Bot to Your Server
In the **OAuth2 → URL Generator** tab:
- Scopes: `bot`
- Bot Permissions:
  - ✅ Read Messages / View Channels
  - ✅ Send Messages
  - ✅ Manage Messages *(to delete the original)*
  - ✅ Embed Links

Copy and open the generated URL to invite the bot.

### 3. Install & Run

```bash
# Install dependencies
npm install

# Set your bot token
export DISCORD_BOT_TOKEN=your_token_here

# Start the bot
npm start
```

Or using a `.env` file (requires `dotenv`):
```bash
npm install dotenv
cp .env.example .env
# Edit .env and add your token
node -r dotenv/config index.js
```

## Configuration

| Env var | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | ✅ | Your bot token. |
| `ALLOWED_GUILD_IDS` | — | Comma-separated server (guild) IDs the bot acts in. Empty = all servers. |
| `PORT` | — | Port for the health-check HTTP server (any path returns `ok`). Defaults to `3000`; Render sets this automatically. |

To get a server ID: enable **Developer Mode** (User Settings → Advanced), then right-click the server → **Copy Server ID**.

```
ALLOWED_GUILD_IDS=123456789012345678,987654321098765432
```

> ⚠️ Never commit `.env` — it holds your token. It's already in `.gitignore`. If a token is ever exposed, regenerate it in the Developer Portal.

## Deploy (Render free tier + UptimeRobot)

The bot runs a tiny HTTP server so Render's free **Web Service** has a port to bind, and so UptimeRobot can keep it awake (free instances sleep after ~15 min idle).

1. On [Render](https://render.com): **New → Web Service**, connect this repo.
   - Build command: `npm install`
   - Start command: `node index.js`
   - Add env var `DISCORD_BOT_TOKEN` (Render provides `PORT` itself).
2. On [UptimeRobot](https://uptimerobot.com): add an **HTTP(s)** monitor pointing at your Render URL (e.g. `https://your-app.onrender.com/`), interval 5 min. Any path returns `ok`.

## How It Works

1. Bot listens for every message in allowed servers
2. Checks if the message contains a supported link
3. If found, it:
   - **Suppresses** the original message's auto-embed (the broken preview)
   - **Replies** with the converted links — which Discord auto-embeds — without pinging the author

## Adding More Rules

Add a one-liner to the `RULES` array in `index.js` — `[label, domain, newHost]`. The match pattern and early-exit trigger build themselves:

```js
const RULES = [
  // ...
  ['Instagram', 'instagram.com', 'kkinstagram.com'],
];
```

Just list the bare domain — subdomains (`www.`, `vt.`, `m.`, …) are handled automatically, so there's no ordering requirement.

## Testing

The link-rewriting logic is unit-tested with Node's built-in test runner (no extra dependencies). The bot's Discord/HTTP startup only runs when `index.js` is executed directly, so the rules can be imported and tested in isolation.

```bash
npm test
```

Add a case by appending a `[description, input, expectedOutput, expectedLabels]` row to the `cases` array in `index.test.js`.
