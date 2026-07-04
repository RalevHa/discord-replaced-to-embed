// Wires everything together: the Discord client, event handlers, slash-command
// registration, and the health-check HTTP server.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const config = require('./config');
const rules = require('./rules');
const { createStorage } = require('./storage');
const { createFloodTracker } = require('./spam');
const commands = require('./commands');
const interactionCreate = require('./events/interactionCreate');
const messageCreate = require('./events/messageCreate');
const messageUpdate = require('./events/messageUpdate');
const messageDelete = require('./events/messageDelete');
const facebookProxy = require('./facebookProxy');
const deployWebhook = require('./deployWebhook');

const FB_PROXY_PATH = /^\/fb\/([^/?]+)/;

// Bilingual (EN/TH) static pages, read once at startup.
const STATIC_PAGES = {
  '/tos': fs.readFileSync(path.join(__dirname, '..', 'public', 'tos.html')),
  '/privacy': fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.html')),
};

// Register slash commands. Per-guild registration is instant; global can take
// ~1h to propagate, so prefer the allowlist guilds when one is set.
async function registerCommands(client, allowedGuilds) {
  const data = commands.list.map((c) => c.data.toJSON());
  if (allowedGuilds.length) {
    await Promise.all(allowedGuilds.map((id) => client.application.commands.set(data, id)));
    console.log(`Registered ${data.length} command(s) to ${allowedGuilds.length} guild(s)`);
  } else {
    await client.application.commands.set(data);
    console.log(`Registered ${data.length} global command(s)`);
  }
}

// HTTP server so Render/UptimeRobot has a port to ping, and (at /fb/<encoded>)
// so Discord's own link-unfurler can fetch a playable-video card for Facebook
// Reels — see facebookProxy.js for why a bot-sent embed can't do that itself.
function startHealthServer(port) {
  http
    .createServer((req, res) => {
      const match = FB_PROXY_PATH.exec(req.url || '');
      if (match) {
        facebookProxy.handleProxyRequest(res, match[1], req.headers['user-agent']).catch((err) => {
          console.error('Facebook proxy error:', err);
          if (!res.headersSent) res.writeHead(500).end('error');
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/deploy-webhook') {
        deployWebhook.handleDeployWebhook(req, res, config);
        return;
      }

      const page = STATIC_PAGES[(req.url || '').split('?')[0]];
      if (page) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
        return;
      }

      res.end('ok');
    })
    .listen(port, () => console.log(`Health server on :${port}`));
}

function start() {
  if (!config.token) {
    console.error('❌  DISCORD_BOT_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const storage = createStorage(config);
  const spam = createFloodTracker({
    windowMs: config.spamWindowMs,
    channelThreshold: config.spamChannelThreshold,
  });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Shared context handed to every event/command handler.
  const ctx = { client, config, storage, commands, rules, spam };

  client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await storage.init();
    try {
      await registerCommands(client, config.allowedGuilds);
    } catch (err) {
      console.error('Failed to register slash commands:', err);
    }
  });

  client.on('interactionCreate', (interaction) => interactionCreate(interaction, ctx));
  client.on('messageCreate', (message) => messageCreate(message, ctx));
  client.on('messageUpdate', (oldMessage, newMessage) => messageUpdate(oldMessage, newMessage, ctx));
  client.on('messageDelete', (message) => messageDelete(message, ctx));

  client.login(config.token);
  startHealthServer(config.port);
}

module.exports = { start };
