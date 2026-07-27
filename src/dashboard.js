// Self-hosted status page (GET /status) — a Render-dashboard-style view of bot
// health and the last auto-deploy, for when the bot isn't actually on Render
// (see README's Option B) and there's no hosting dashboard to check instead.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { formatElapsed } = require('./format');

const DEPLOY_LOG = path.join(__dirname, '..', 'scripts', 'deploy.log');

// Best-effort — `git` may be missing (e.g. a bare deploy of the source tree).
function getGitInfo() {
  const repoRoot = path.join(__dirname, '..');
  const git = (args) => execSync(`git ${args}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
  try {
    return {
      commit: git('rev-parse --short HEAD'),
      subject: git('log -1 --format=%s'),
      date: git('log -1 --format=%cI'),
      branch: git('rev-parse --abbrev-ref HEAD'),
    };
  } catch {
    return null;
  }
}

// Last N lines of the auto-deploy log (see scripts/auto-deploy.ps1), if present.
function tailDeployLog(maxLines = 15) {
  try {
    const lines = fs.readFileSync(DEPLOY_LOG, 'utf8').trim().split('\n');
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

async function buildStatus({ client, storage, config }) {
  const stats = await storage.getStats();
  return {
    online: client.isReady(),
    tag: client.user?.tag || 'not logged in',
    uptime: client.readyAt ? formatElapsed(Date.now() - client.readyAt.getTime()) : '—',
    wsPing: Math.round(client.ws.ping),
    guildCount: client.guilds.cache.size,
    persistent: storage.persistent,
    stats,
    git: getGitInfo(),
    deployLog: tailDeployLog(),
    facebookEmbedEnabled: config.facebookEmbedEnabled,
    spamDetectionEnabled: config.spamDetectionEnabled,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderHtml(status) {
  const breakdown = Object.entries(status.stats.byLabel)
    .map(([label, n]) => [label, Number(n)])
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `<li>${escapeHtml(label)}: <b>${n}</b></li>`)
    .join('') || '<li>—</li>';

  const git = status.git
    ? `${escapeHtml(status.git.commit)} on <b>${escapeHtml(status.git.branch)}</b> — ${escapeHtml(status.git.subject)}<br>` +
      `<span class="dim">${escapeHtml(status.git.date)}</span>`
    : '<span class="dim">git info unavailable</span>';

  const log = status.deployLog.length
    ? status.deployLog.map(escapeHtml).join('\n')
    : '(no deploy.log yet — see scripts/auto-deploy.ps1)';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<title>Bot Status</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.3rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
  .dim { color: #888; font-size: 0.85em; }
  .dot { display: inline-block; width: 0.6em; height: 0.6em; border-radius: 50%; margin-right: 0.4em; }
  .up { background: #2ecc71; }
  .down { background: #e74c3c; }
  ul { margin: 0.3em 0 0; padding-left: 1.2em; }
  pre { background: #f6f6f6; padding: 0.75em; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
  @media (prefers-color-scheme: dark) {
    body { color: #ddd; background: #1a1a1a; }
    .card { border-color: #444; }
    .dim { color: #999; }
    pre { background: #262626; color: #ddd; }
  }
</style>
</head>
<body>
<h1><span class="dot ${status.online ? 'up' : 'down'}"></span>${escapeHtml(status.tag)}</h1>

<div class="card">
  <b>Bot</b><br>
  Status: ${status.online ? 'online' : 'offline'} · Uptime: ${status.uptime} · WS ping: ${status.wsPing}ms · Servers: ${status.guildCount}<br>
  Storage: ${status.persistent ? 'Redis (persistent)' : 'in-memory (resets on restart)'}<br>
  Facebook embeds: ${status.facebookEmbedEnabled ? 'on' : 'off'} · Spam detection: ${status.spamDetectionEnabled ? 'on' : 'off'}
</div>

<div class="card">
  <b>Link conversions</b> <span class="dim">since ${new Date(status.stats.since).toLocaleString()}</span><br>
  Total: <b>${status.stats.total}</b> · Spam floods blocked: <b>${status.stats.spamCaught}</b>
  <ul>${breakdown}</ul>
</div>

<div class="card">
  <b>Last deploy</b><br>
  ${git}
</div>

<div class="card">
  <b>Deploy log</b> <span class="dim">(scripts/deploy.log, last ${status.deployLog.length} lines)</span>
  <pre>${log}</pre>
</div>

<p class="dim">Auto-refreshes every 15s.</p>
</body>
</html>`;
}

module.exports = { buildStatus, renderHtml, tailDeployLog };
