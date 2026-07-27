// Handles POST /deploy-webhook: GitHub calls this the moment a push lands, so
// the bot redeploys instantly instead of waiting for scripts/auto-deploy.ps1's
// next scheduled poll. Verifies GitHub's HMAC signature, then re-runs that same
// script (detached, so it survives this process being restarted mid-deploy).

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

// Detached + unref'd (fire-and-forget) so this survives the webhook process
// restarting mid-deploy — but that also means nothing here ever sees a failure.
// auto-deploy.ps1 logs its own progress to scripts/deploy.log (see Write-Log
// in that script) rather than us capturing its stdio here: piping a raw file
// descriptor into a Windows child process's stdio doesn't reliably end up in
// the file, and it also means git/npm/pm2 run inside an un-redirected child
// console, which is what made those commands flash a visible window on every
// deploy.
const DEPLOY_SCRIPT = path.join(__dirname, '..', 'scripts', 'auto-deploy.ps1');
const DEPLOY_LOG = path.join(__dirname, '..', 'scripts', 'deploy.log');

function isValidSignature(secret, body, signatureHeader) {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const a = Buffer.from(signatureHeader || '');
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// A spawn error (e.g. `powershell.exe` missing from PATH) is emitted asynchronously
// on the child's 'error' event — with no listener, Node treats that as an uncaught
// exception and crashes this whole process. Log it instead.
//
// NOT `detached: true`: on this Node/Windows combo, spawning with detached:true
// silently no-ops — the child process object comes back with no error event and
// (when observable) exit code 0, but the command never actually runs (verified
// with a minimal repro: a bare `Write-Output ... | Out-File` never wrote its
// file with detached:true, every time, and always did without it). That made
// every action that goes through here — deploy, restart, stop, start — a no-op
// with no visible failure. Losing OS-level detachment means a child could in
// theory get killed alongside this process's own tree if something else tears
// it down mid-command, but an actually-running command beats a silently
// no-op'd "safe" one.
function spawnDetached(args) {
  spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true })
    .on('error', (err) => console.error('Failed to spawn powershell.exe:', err.message))
    .unref();
}

function triggerDeploy() {
  spawnDetached(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DEPLOY_SCRIPT]);
}

// Run a pm2 lifecycle command as a DETACHED subprocess, not the `pm2` JS API
// in-process — the admin panel calls this to restart/stop/start THIS very
// process, and an in-process call could get killed mid-request before the
// HTTP response flushes. A detached child survives that; see pm2Control.js
// for read-only status/log queries, which don't have this problem.
const PM2_ACTIONS = new Set(['start', 'stop', 'restart']);
const SAFE_NAME = /^[\w-]+$/;

function pm2Command(action, name) {
  if (!PM2_ACTIONS.has(action)) throw new Error(`Invalid pm2 action: ${action}`);
  if (!SAFE_NAME.test(name)) throw new Error(`Invalid pm2 process name: ${name}`);

  // Redirecting pm2's output here isn't just for the log — it's what stops
  // this command from popping a console window, same as Invoke-Logged in
  // auto-deploy.ps1: this powershell.exe has no console of its own (spawned
  // hidden below), so an un-redirected `pm2 restart` would make Windows
  // allocate a new, briefly visible one to print to.
  spawnDetached(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `pm2 ${action} ${name} *>> '${DEPLOY_LOG}'`]);
}

// Just a process restart (e.g. after an admin-panel .env edit) — skips
// auto-deploy.ps1's git fetch/pull/npm install, since no code changed.
function restartProcess(name) {
  pm2Command('restart', name);
}

function stopProcess(name) {
  pm2Command('stop', name);
}

function startProcess(name) {
  pm2Command('start', name);
}

/** Node http handler for POST /deploy-webhook. */
function handleDeployWebhook(req, res, config) {
  if (!config.deployWebhookSecret) {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    if (!isValidSignature(config.deployWebhookSecret, body, req.headers['x-hub-signature-256'])) {
      res.writeHead(401).end('bad signature');
      return;
    }

    const event = req.headers['x-github-event'];
    if (event === 'ping') {
      res.writeHead(200).end('pong');
      return;
    }

    if (event === 'push') {
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
      if (payload.ref === `refs/heads/${config.deployBranch}`) {
        console.log(`Deploy webhook: push to ${config.deployBranch}, redeploying...`);
        triggerDeploy();
      }
    }

    res.writeHead(200).end('ok');
  });
}

module.exports = { handleDeployWebhook, isValidSignature, triggerDeploy, restartProcess, stopProcess, startProcess };
