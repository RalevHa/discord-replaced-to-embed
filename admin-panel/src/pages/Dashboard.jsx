import { useEffect, useState, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../api';
import { Badge, ErrorNote, Icon, PageHeader, Spinner, useUI } from '../ui';

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      <Icon name={icon} size={15} />
      <span className="dim">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Pm2Panel() {
  const { ask, toast } = useUI();
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

  async function run(action, confirm, call) {
    if (confirm && !(await ask(confirm))) return;
    setBusy(action);
    setError('');
    try {
      await call();
      toast(`Bot ${action} requested`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setTimeout(() => {
        setBusy('');
        load();
      }, 2000);
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!status) return <Spinner />;

  if (!status.managed) {
    return (
      <section className="card">
        <h3>Process (pm2)</h3>
        <p className="dim">Not running under pm2 — no process controls available.</p>
      </section>
    );
  }

  const online = status.status === 'online';

  return (
    <section className="card">
      <div className="card-head">
        <h3>Process (pm2)</h3>
        <Badge tone={online ? 'good' : 'bad'} dot={online ? 'up' : 'down'}>
          {status.status}
        </Badge>
      </div>
      <p className="mono">{status.name}</p>
      <div className="metrics">
        {online && <Metric icon="clock" label="Up" value={formatDuration(status.uptimeMs)} />}
        <Metric icon="refresh" label="Restarts" value={status.restarts} />
        {online && <Metric icon="database" label="Memory" value={`${(status.memoryBytes / 1024 / 1024).toFixed(0)} MB`} />}
        {online && <Metric icon="activity" label="CPU" value={`${status.cpuPercent}%`} />}
      </div>
      <div className="btn-row">
        <button
          className="btn"
          onClick={() =>
            run('restart', { title: 'Restart the bot?', message: 'It will be offline for a few seconds.', confirmLabel: 'Restart' }, api.pm2Restart)
          }
          disabled={!!busy}
        >
          <Icon name="refresh" size={15} />
          {busy === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
        <button
          className="btn btn-danger-outline"
          onClick={() =>
            run(
              'stop',
              { title: 'Stop the bot?', message: 'It stays offline until you press Start again.', confirmLabel: 'Stop', danger: true },
              api.pm2Stop
            )
          }
          disabled={!!busy || !online}
        >
          <Icon name="stop" size={15} />
          {busy === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
        <button className="btn" onClick={() => run('start', null, api.pm2Start)} disabled={!!busy || online}>
          <Icon name="play" size={15} />
          {busy === 'start' ? 'Starting…' : 'Start'}
        </button>
      </div>
      {logs && logs.out.length > 0 && (
        <details>
          <summary>Recent output</summary>
          <pre>{logs.out.join('\n')}</pre>
        </details>
      )}
      {logs && logs.error.length > 0 && (
        <details>
          <summary>Recent errors</summary>
          <pre>{logs.error.join('\n')}</pre>
        </details>
      )}
    </section>
  );
}

function PasskeyPanel() {
  const { ask, toast } = useUI();
  const [passkeys, setPasskeys] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.passkeys().then(setPasskeys).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function addPasskey() {
    const name = await ask({
      title: 'Name this passkey',
      message: 'e.g. "Bitwarden" or "This laptop".',
      input: 'Passkey name',
      confirmLabel: 'Continue',
    });
    if (!name) return;
    setBusy(true);
    try {
      const optionsJSON = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON });
      await api.passkeyRegisterVerify(name, response);
      toast('Passkey added');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id) {
    if (!(await ask({ title: 'Remove this passkey?', confirmLabel: 'Remove', danger: true }))) return;
    setBusy(true);
    try {
      await api.removePasskey(id);
      toast('Passkey removed');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!passkeys) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h3>Passkeys</h3>
        <Badge tone={passkeys.length ? 'good' : 'warn'}>{passkeys.length ? '2-step on' : 'Password only'}</Badge>
      </div>
      <p className="dim">
        {passkeys.length
          ? 'Logging in needs the password AND one of these.'
          : 'Logging in only needs the password. Add a passkey to require both.'}
      </p>
      {passkeys.length > 0 && (
        <ul className="rows">
          {passkeys.map((p) => (
            <li key={p.id}>
              <span className="row-icon">
                <Icon name="key" size={16} />
              </span>
              <span className="grow">
                {p.name}
                <span className="dim block">Added {new Date(p.createdAt).toLocaleDateString()}</span>
              </span>
              <button className="btn btn-icon btn-ghost" aria-label="Remove passkey" onClick={() => removePasskey(p.id)} disabled={busy}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" onClick={addPasskey} disabled={busy}>
        <Icon name="plus" size={15} />
        {busy ? 'Waiting for passkey…' : 'Add a passkey'}
      </button>
    </section>
  );
}

function Stat({ icon, label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint && <div className="dim">{hint}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useUI();
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
      toast('Deploy started');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setTimeout(() => {
        setDeploying(false);
        load();
      }, 2000);
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!status) return <Spinner />;

  const breakdown = Object.entries(status.stats.byLabel).sort((a, b) => b[1] - a[1]);
  const max = breakdown[0]?.[1] || 1;

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle="Live status of the bot · refreshes every 15s">
        <Badge tone={status.persistent ? 'good' : 'warn'}>
          <Icon name="database" size={13} />
          {status.persistent ? 'Redis (persistent)' : 'In-memory (resets on restart)'}
        </Badge>
      </PageHeader>

      <section className="hero card">
        <span className="hero-avatar">
          <Icon name="bot" size={28} />
        </span>
        <div>
          <h2>{status.tag}</h2>
          <Badge tone={status.online ? 'good' : 'bad'} dot={status.online ? 'up' : 'down'}>
            {status.online ? 'Online' : 'Offline'}
          </Badge>
        </div>
      </section>

      <div className="stats">
        <Stat icon="clock" label="Uptime" value={status.uptime} />
        <Stat icon="activity" label="WS ping" value={`${status.wsPing} ms`} />
        <Stat icon="server" label="Servers" value={status.guildCount} />
        <Stat icon="link" label="Conversions" value={status.stats.total.toLocaleString()} />
        <Stat icon="shield" label="Spam blocked" value={status.stats.spamCaught.toLocaleString()} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Link conversions</h3>
            <span className="dim">
              {status.persistent ? 'All time' : 'Since restart'} · {formatDuration(Date.now() - status.stats.since)}
            </span>
          </div>
          {breakdown.length === 0 && <p className="dim">No links converted yet.</p>}
          <ul className="bars">
            {breakdown.map(([label, n]) => (
              <li key={label}>
                <div className="bar-head">
                  <span>{label}</span>
                  <b>{n.toLocaleString()}</b>
                </div>
                <div className="bar">
                  <span style={{ width: `${(n / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Deploy</h3>
            <button className="btn btn-primary" onClick={deploy} disabled={deploying}>
              <Icon name="upload" size={15} />
              {deploying ? 'Deploying…' : 'Deploy now'}
            </button>
          </div>
          {status.git && (
            <div className="git">
              <span className="chip">
                <Icon name="branch" size={13} />
                {status.git.branch}
              </span>
              <span className="mono dim">{status.git.commit}</span>
              <span className="git-subject">{status.git.subject}</span>
            </div>
          )}
          <pre className="terminal">{status.deployLog.join('\n') || '(no deploy log yet)'}</pre>
        </section>

        <Pm2Panel />
        {status.passkeysAvailable && <PasskeyPanel />}
      </div>
    </div>
  );
}
