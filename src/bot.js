// Wires everything together: the Discord client, event handlers, slash-command
// registration, and the health-check HTTP server.

const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');

const config = require('./config');
const rules = require('./rules');
const { createStorage } = require('./storage');
const commands = require('./commands');
const interactionCreate = require('./events/interactionCreate');
const messageCreate = require('./events/messageCreate');

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

// Minimal HTTP server so Render binds a port and UptimeRobot can ping it awake.
function startHealthServer(port) {
  http
    .createServer((req, res) => res.end('ok'))
    .listen(port, () => console.log(`Health server on :${port}`));
}

function start() {
  if (!config.token) {
    console.error('❌  DISCORD_BOT_TOKEN environment variable is not set.');
    process.exit(1);
  }

  const storage = createStorage(config);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Shared context handed to every event/command handler.
  const ctx = { client, config, storage, commands, rules };

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

  client.login(config.token);
  startHealthServer(config.port);
}

module.exports = { start };
