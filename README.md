# Discord Link Replacer Bot

Automatically detects supported links in messages, replaces them with embeddable alternatives, and reposts them as a clean embed showing the original author.

## Replacement Rules

| Platform | Input | Output |
|---|---|---|
| Facebook | `https://(www.)facebook.com/PATH` | `https://facebed.com/PATH` |
| TikTok (vt short) | `https://vt.tiktok.com/PATH` | `https://a.tnktok.com/PATH` |
| TikTok | `https://(www.)tiktok.com/PATH` | `https://a.tnktok.com/PATH` |
| Bilibili | `https://(www.)bilibili.com/PATH` | `https://www.vxbilibili.com/PATH` |
| X (Twitter) | `https://(www.)x.com/PATH` | `https://fixupx.com/PATH` |
| Pixiv | `https://(www.)pixiv.net/PATH` | `https://www.phixiv.net/PATH` |

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

To get a server ID: enable **Developer Mode** (User Settings → Advanced), then right-click the server → **Copy Server ID**.

```
ALLOWED_GUILD_IDS=123456789012345678,987654321098765432
```

> ⚠️ Never commit `.env` — it holds your token. It's already in `.gitignore`. If a token is ever exposed, regenerate it in the Developer Portal.

## How It Works

1. Bot listens for every message in allowed servers
2. Checks if the message contains a supported link
3. If found, it:
   - **Deletes** the original message
   - **Reposts** an embed with the author's name/avatar, the converted links, and a summary of what was changed

## Adding More Rules

Add a one-liner to the `RULES` array in `index.js` — `[label, domain, newHost]`. The match pattern and early-exit trigger build themselves:

```js
const RULES = [
  // ...
  ['Instagram', 'instagram.com', 'ddinstagram.com'],
];
```

Order matters: list more specific subdomains (e.g. `vt.tiktok.com`) before their parent domain.
