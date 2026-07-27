// One-off maintenance: find slash commands Discord still has registered (globally
// or per-guild) that no longer match anything in src/commands/index.js — leftovers
// from renamed/removed commands, or from switching between global and per-guild
// registration (bot.js's registerCommands only ever live-syncs ONE scope, so the
// other scope's old entries never get cleared on their own).
//
// Defaults to a dry run (report only). Pass --apply to actually delete.

const { REST, Routes } = require('discord.js');
const config = require('../src/config');
const commands = require('../src/commands');

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!config.token) {
    console.error('DISCORD_BOT_TOKEN is not set.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(config.token);
  const localNames = new Set(commands.list.map((c) => c.data.name));
  const guildOnlyMode = config.allowedGuilds.length > 0;

  const app = await rest.get(Routes.oauth2CurrentApplication());
  const guilds = await rest.get(Routes.userGuilds());

  const toDelete = []; // { scope: 'global' | guildId, name, id, reason }

  const globalCommands = await rest.get(Routes.applicationCommands(app.id));
  for (const cmd of globalCommands) {
    if (guildOnlyMode) {
      toDelete.push({ scope: 'global', name: cmd.name, id: cmd.id, reason: 'bot now registers per-guild, not globally' });
    } else if (!localNames.has(cmd.name)) {
      toDelete.push({ scope: 'global', name: cmd.name, id: cmd.id, reason: 'no longer defined in src/commands' });
    }
  }

  for (const guild of guilds) {
    const guildCommands = await rest.get(Routes.applicationGuildCommands(app.id, guild.id));
    if (guildCommands.length === 0) continue;

    const allowed = config.allowedGuilds.length === 0 || config.allowedGuilds.includes(guild.id);
    for (const cmd of guildCommands) {
      if (!allowed) {
        toDelete.push({
          scope: guild.id,
          guildName: guild.name,
          name: cmd.name,
          id: cmd.id,
          reason: 'guild no longer in ALLOWED_GUILD_IDS',
        });
      } else if (!localNames.has(cmd.name)) {
        toDelete.push({
          scope: guild.id,
          guildName: guild.name,
          name: cmd.name,
          id: cmd.id,
          reason: 'no longer defined in src/commands',
        });
      }
    }
  }

  if (toDelete.length === 0) {
    console.log('Nothing to clean up — Discord matches src/commands exactly.');
    return;
  }

  console.log(`Found ${toDelete.length} stale command registration(s):\n`);
  for (const c of toDelete) {
    const where = c.scope === 'global' ? 'global' : `guild "${c.guildName}" (${c.scope})`;
    console.log(`  /${c.name}  [${where}] — ${c.reason}`);
  }

  if (!APPLY) {
    console.log('\nDry run only — nothing deleted. Re-run with --apply to remove these.');
    return;
  }

  console.log('\nDeleting...');
  for (const c of toDelete) {
    if (c.scope === 'global') {
      await rest.delete(Routes.applicationCommand(app.id, c.id));
    } else {
      await rest.delete(Routes.applicationGuildCommand(app.id, c.scope, c.id));
    }
    console.log(`  deleted /${c.name} [${c.scope === 'global' ? 'global' : c.guildName}]`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
