import { useEffect, useState, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../api';

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function Pm2Panel() {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.pm2Status().then(setStatus).catch((e) => setError(e.message));
    api.pm2Logs().then(setLogs).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function run(action, confirmMessage, call) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(action);
    setError('');
    try {
      await call();
    } catch (e) {
      setError(e.message);
    } finally {
      setTimeout(() => {
        setBusy('');
        load();
      }, 2000);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!status) return <p className="loading">Loading…</p>;

  if (!status.managed) {
    return (
      <div className="card">
        <h3>Process (pm2)</h3>
        <p className="dim">Not running under pm2 — no process controls available.</p>
      </div>
    );
  }

  const online = status.status === 'online';

  return (
    <div className="card">
      <h3>Process (pm2)</h3>
      <p>
        <span className={`dot ${online ? 'up' : 'down'}`} />
        {status.name} — <b>{status.status}</b>
        {online && ` · up ${formatDuration(status.uptimeMs)}`} · restarts: {status.restarts}
        {online && ` · ${(status.memoryBytes / 1024 / 1024).toFixed(0)}MB · ${status.cpuPercent}% CPU`}
      </p>
      <button onClick={() => run('restart', 'Restart the bot now?', api.pm2Restart)} disabled={!!busy}>
        {busy === 'restart' ? 'Restarting…' : 'Restart'}
      </button>{' '}
      <button
        onClick={() =>
          run('stop', 'Stop the bot? It stays offline until you press Start again.', api.pm2Stop)
        }
        disabled={!!busy || !online}
      >
        {busy === 'stop' ? 'Stopping…' : 'Stop'}
      </button>{' '}
      <button onClick={() => run('start', null, api.pm2Start)} disabled={!!busy || online}>
        {busy === 'start' ? 'Starting…' : 'Start'}
      </button>
      {logs && (logs.out.length > 0 || logs.error.length > 0) && (
        <>
          <p className="dim" style={{ marginTop: '0.75rem' }}>
            Recent output
          </p>
          <pre>{logs.out.join('\n') || '(empty)'}</pre>
          {logs.error.length > 0 && (
            <>
              <p className="dim">Recent errors</p>
              <pre>{logs.error.join('\n')}</pre>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PasskeyPanel() {
  const [passkeys, setPasskeys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.passkeys().then(setPasskeys).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addPasskey() {
    const name = window.prompt('Name this passkey (e.g. "Bitwarden", "This laptop"):');
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const optionsJSON = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON });
      await api.passkeyRegisterVerify(name, response);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id) {
    if (!window.confirm('Remove this passkey?')) return;
    setBusy(true);
    setError('');
    try {
      await api.removePasskey(id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!passkeys) return null;

  return (
    <div className="card">
      <h3>Passkeys</h3>
      <p className="dim">
        {passkeys.length
          ? 'Registered — logging in now needs the password AND one of these.'
          : 'None yet — logging in only needs the password. Add one below to require both.'}
      </p>
      {passkeys.length > 0 && (
        <ul>
          {passkeys.map((p) => (
            <li key={p.id}>
              {p.name} <span className="dim">— added {new Date(p.createdAt).toLocaleDateString()}</span>{' '}
              <button onClick={() => removePasskey(p.id)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={addPasskey} disabled={busy}>
        {busy ? 'Waiting for passkey…' : 'Add a passkey'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.status().then(setStatus).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function deploy() {
    setDeploying(true);
    try {
      await api.deploy();
    } finally {
      setTimeout(() => {
        setDeploying(false);
        load();
      }, 2000);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!status) return <p className="loading">Loading…</p>;

  const breakdown = Object.entries(status.stats.byLabel).sort((a, b) => b[1] - a[1]);

  return (
    <div className="stack">
      <div className="card">
        <h2>
          <span className={`dot ${status.online ? 'up' : 'down'}`} />
          {status.tag}
        </h2>
        <p>
          Uptime: {status.uptime} · WS ping: {status.wsPing}ms · Servers: {status.guildCount}
        </p>
        <p>Storage: {status.persistent ? 'Redis (persistent)' : 'in-memory (resets on restart)'}</p>
      </div>

      <div className="card">
        <h3>Link conversions</h3>
        <p>
          Total: <b>{status.stats.total}</b> · Spam floods blocked: <b>{status.stats.spamCaught}</b>
        </p>
        <ul>
          {breakdown.map(([label, n]) => (
            <li key={label}>
              {label}: <b>{n}</b>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Deploy</h3>
        {status.git && (
          <p>
            {status.git.commit} on <b>{status.git.branch}</b> — {status.git.subject}
          </p>
        )}
        <button onClick={deploy} disabled={deploying}>
          {deploying ? 'Deploying…' : 'Deploy now'}
        </button>
        <pre>{status.deployLog.join('\n') || '(no deploy log yet)'}</pre>
      </div>

      {status.passkeysAvailable && <PasskeyPanel />}

      <Pm2Panel />
    </div>
  );
}
