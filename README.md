# Discord Link Replacer Bot

Automatically detects Facebook and TikTok links in messages, replaces them with embeddable alternatives, and reposts them as a clean embed showing the original author.

## Replacement Rules

| Platform          | Input Pattern                       | Output                        |
| ----------------- | ----------------------------------- | ----------------------------- |
| Facebook          | `https://(www.)facebook.com/PATH` | `https://facebed.com/PATH`  |
| TikTok            | `https://(www.)tiktok.com/PATH`   | `https://a.tnktok.com/PATH` |
| TikTok (vt short) | `https://vt.tiktok.com/PATH`      | `https://a.tnktok.com/PATH` |

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

## How It Works

1. Bot listens for every message in the server
2. Checks if the message contains a Facebook or TikTok link
3. If found, it:
   - **Deletes** the original message
   - **Reposts** an embed with the author's name/avatar, the converted links, and a summary of what was changed

## Adding More Rules

Edit the `URL_RULES` array in `index.js`:

```js
{
  label: 'Instagram',
  pattern: /https?:\/\/(www\.)?instagram\.com\/([^\s]+)/gi,
  replace: (match, www, path) => `https://ddinstagram.com/${path}`,
},
```
