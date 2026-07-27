// Admin web panel backend — an Express app mounted under /admin by src/bot.js.
// Disabled entirely (404s) when config.adminPassword is unset, same opt-in
// pattern as deployWebhook.js's DEPLOY_WEBHOOK_SECRET.

const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { ChannelType } = require('discord.js');
const { createAdminAuth } = require('./adminAuth');
const dashboard = require('./dashboard');
const deployWebhook = require('./deployWebhook');
const envFile = require('./envFile');
const pm2Control = require('./pm2Control');

const ENV_PATH = path.join(__dirname, '..', '.env');
const FRONTEND_DIST = path.join(__dirname, '..', 'admin-panel', 'dist');

function isValidPair(p) {
  return (
    p &&
    typeof p.key === 'string' &&
    p.key.length > 0 &&
    !p.key.includes('\n') &&
    typeof p.value === 'string' &&
    !p.value.includes('\n')
  );
}

/** @param {{ client: import('discord.js').Client, config: object, storage: object }} ctx */
function createAdminApp(ctx) {
  const { client, config, storage } = ctx;
  const app = express();

  if (!config.adminPassword) {
    app.use((req, res) => res.status(404).end());
    return app;
  }
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET must be set when ADMIN_PASSWORD is set.');
  }

  const auth = createAdminAuth(config);

  // Only trust the loopback hop (cloudflared runs locally) — req.ip is a fallback
  // for local/non-Cloudflare use; the login lockout keys on CF-Connecting-IP instead,
  // since that header (unlike X-Forwarded-For) can't be spoofed by the client.
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(cookieParser());
  app.use(auth.sessionMiddleware);

  const api = express.Router();
  api.post('/login', auth.handleLogin);
  api.post('/logout', auth.handleLogout);
  api.get('/session', auth.handleSession);

  const authed = express.Router();
  authed.use(auth.requireAuth);

  authed.get('/status', async (req, res) => {
    res.json(await dashboard.buildStatus(ctx));
  });

  authed.get('/guilds', (req, res) => {
    const guilds = client.guilds.cache.map((g) => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      disabled: storage.isGuildDisabled(g.id),
      rollChannelCount: storage.getRollChannels(g.id).length,
    }));
    res.json(guilds);
  });

  authed.patch('/guilds/:id', async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Unknown guild.' });
    await storage.setGuildDisabled(guild.id, Boolean(req.body?.disabled));
    res.json({ ok: true });
  });

  authed.get('/guilds/:id/channels', (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Unknown guild.' });
    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({ id: c.id, name: c.name }));
    res.json(channels);
  });

  authed.get('/guilds/:id/roll-channels', (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Unknown guild.' });
    const ids = storage.getRollChannels(guild.id);
    res.json(ids.map((id) => ({ id, name: guild.channels.cache.get(id)?.name || id })));
  });

  authed.post('/guilds/:id/roll-channels', async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Unknown guild.' });
    const channelId = req.body?.channelId;
    if (!channelId) return res.status(400).json({ error: 'channelId is required.' });
    await storage.addRollChannel(guild.id, channelId);
    res.json({ ok: true });
  });

  authed.delete('/guilds/:id/roll-channels/:channelId', async (req, res) => {
    await storage.removeRollChannel(req.params.id, req.params.channelId);
    res.json({ ok: true });
  });

  authed.get('/env', (req, res) => {
    const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    res.json({ pairs: envFile.pairsOf(envFile.parse(text)) });
  });

  authed.put('/env', (req, res) => {
    const pairs = req.body?.pairs;
    if (!Array.isArray(pairs) || !pairs.every(isValidPair)) {
      return res.status(400).json({ error: 'pairs must be an array of { key, value } strings.' });
    }
    const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    fs.writeFileSync(ENV_PATH, envFile.applyPairs(text, pairs));
    deployWebhook.restartProcess(config.pm2ProcessName);
    res.json({ ok: true, restarting: true });
  });

  authed.post('/deploy', (req, res) => {
    deployWebhook.triggerDeploy();
    res.json({ ok: true, started: true });
  });

  authed.get('/deploy-log', (req, res) => {
    res.json({ lines: dashboard.tailDeployLog() });
  });

  authed.get('/pm2/status', async (req, res) => {
    try {
      const s = await pm2Control.status(config.pm2ProcessName);
      // summarize()'s output has no `managed` field of its own (it's tested as a
      // pure describe()-entry mapper) — the frontend's Pm2Panel keys its whole
      // "not running under pm2" fallback off status.managed, so a successful
      // lookup has to be tagged here or it reads as unmanaged too.
      res.json(s ? { ...s, managed: true } : { managed: false });
    } catch (err) {
      res.json({ managed: false, error: err.message });
    }
  });

  authed.get('/pm2/logs', async (req, res) => {
    try {
      res.json(await pm2Control.logs(config.pm2ProcessName));
    } catch (err) {
      res.json({ out: [], error: [err.message] });
    }
  });

  authed.post('/pm2/restart', (req, res) => {
    deployWebhook.restartProcess(config.pm2ProcessName);
    res.json({ ok: true, restarting: true });
  });

  authed.post('/pm2/stop', (req, res) => {
    deployWebhook.stopProcess(config.pm2ProcessName);
    res.json({ ok: true, stopping: true });
  });

  authed.post('/pm2/start', (req, res) => {
    deployWebhook.startProcess(config.pm2ProcessName);
    res.json({ ok: true, starting: true });
  });

  api.use(authed);
  app.use('/admin/api', api);

  if (fs.existsSync(FRONTEND_DIST)) {
    app.use('/admin', express.static(FRONTEND_DIST));
    // SPA fallback for client-side routes (e.g. /admin/guilds) not matched above.
    app.use('/admin', (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
  } else {
    app.use('/admin', (req, res) =>
      res.status(503).send('Admin panel frontend not built yet — run `npm run build` in admin-panel/.')
    );
  }

  return app;
}

module.exports = { createAdminApp };
