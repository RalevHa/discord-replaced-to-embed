import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorNote, Icon, PageHeader, Spinner, Switch, useUI } from '../ui';

// Shared shape for any "pick a channel to add/remove from a per-guild list"
// panel — used for both the /roll-channel allowlist and the /ignore-channel
// list so the two don't duplicate the same add/remove UI.
function ChannelList({ guildId, list, add, remove, emptyText }) {
  const { toast } = useUI();
  const [channels, setChannels] = useState([]);
  const [available, setAvailable] = useState([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');

  function reload() {
    list(guildId).then(setChannels).catch((e) => setError(e.message));
  }

  useEffect(() => {
    reload();
    api.channels(guildId).then(setAvailable).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  async function change(fn) {
    try {
      await fn();
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function handleAdd() {
    if (!picked) return;
    await change(() => add(guildId, picked));
    setPicked('');
  }

  return (
    <div className="panel">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="chips">
        {channels.map((c) => (
          <span className="chip chip-removable" key={c.id}>
            <Icon name="hash" size={12} />
            {c.name}
            <button aria-label={`Remove #${c.name}`} onClick={() => change(() => remove(guildId, c.id))}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {channels.length === 0 && <span className="dim">{emptyText}</span>}
      </div>
      <div className="add-row">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Add a channel…</option>
          {available
            .filter((c) => !channels.some((rc) => rc.id === c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
        </select>
        <button className="btn btn-primary" onClick={handleAdd} disabled={!picked}>
          <Icon name="plus" size={15} />
          Add
        </button>
      </div>
    </div>
  );
}

function RollChannels({ guildId }) {
  return (
    <ChannelList
      guildId={guildId}
      list={api.rollChannels}
      add={api.addRollChannel}
      remove={api.removeRollChannel}
      emptyText="No roll channels — /roll is disabled here."
    />
  );
}

function IgnoredChannels({ guildId }) {
  return (
    <ChannelList
      guildId={guildId}
      list={api.ignoredChannels}
      add={api.addIgnoredChannel}
      remove={api.removeIgnoredChannel}
      emptyText="No ignored channels — automatic conversion runs everywhere."
    />
  );
}

function FixerPanel({ guildId }) {
  const { toast } = useUI();
  const [fixers, setFixers] = useState(null);
  const [error, setError] = useState('');

  function reload() {
    api.guildFixers(guildId).then(setFixers).catch((e) => setError(e.message));
  }

  useEffect(reload, [guildId]);

  async function change(fn) {
    try {
      await fn();
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!fixers) return <Spinner />;

  return (
    <div className="fixer-grid">
      {fixers.map((f) => (
        <div className="fixer-card" key={f.label}>
          <div className="fixer-card-head">
            <span className="fixer-label">{f.label}</span>
            {f.host !== f.default && (
              <button className="link-button" onClick={() => change(() => api.resetGuildFixer(guildId, f.label))}>
                Reset
              </button>
            )}
          </div>
          <div className="fixer-options">
            {f.options.map((host) => (
              <button
                key={host}
                className={`pill${host === f.host ? ' pill-active' : ''}`}
                onClick={() => change(() => api.setGuildFixer(guildId, f.label, host))}
              >
                {host}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { key: 'roll', label: 'Roll channels', count: (g) => g.rollChannelCount, Panel: RollChannels },
  { key: 'ignored', label: 'Ignored channels', count: (g) => g.ignoredChannelCount, Panel: IgnoredChannels },
  { key: 'fixers', label: 'Fixers', Panel: FixerPanel },
];

function GuildCard({ guild: g, onChange }) {
  const [tab, setTab] = useState(null);
  const active = TABS.find((t) => t.key === tab);

  return (
    <article className={`guild card${g.disabled ? ' guild-off' : ''}`}>
      <div className="guild-main">
        <span className="guild-avatar">{g.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <div className="grow">
          <h3 className="guild-name">{g.name}</h3>
          <span className="dim mono">{g.id}</span>
        </div>
        <div className="toggles">
          <label>
            <span>Link conversion</span>
            <Switch
              checked={!g.disabled}
              label={`Link conversion for ${g.name}`}
              onChange={() => onChange(() => api.setGuildDisabled(g.id, !g.disabled))}
            />
          </label>
          <label>
            <span>Webhook repost</span>
            <Switch
              checked={!!g.webhookRepostEnabled}
              label={`Webhook repost for ${g.name}`}
              onChange={() => onChange(() => api.setGuildWebhookRepost(g.id, !g.webhookRepostEnabled))}
            />
          </label>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(tab === t.key ? null : t.key)}
          >
            {t.label}
            {t.count && <span className="count">{t.count(g)}</span>}
          </button>
        ))}
      </div>
      {active && <active.Panel guildId={g.id} />}
    </article>
  );
}

export default function Guilds() {
  const { toast } = useUI();
  const [guilds, setGuilds] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  function reload() {
    api.guilds().then(setGuilds).catch((e) => setError(e.message));
  }

  useEffect(reload, []);

  async function change(fn) {
    try {
      await fn();
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!guilds) return <Spinner />;

  const shown = guilds.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="page">
      <PageHeader title="Guilds" subtitle={`${guilds.length} server${guilds.length === 1 ? '' : 's'} using the bot`}>
        <div className="input-icon search">
          <Icon name="search" size={16} />
          <input
            placeholder="Search servers…"
            aria-label="Search servers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </PageHeader>
      {shown.map((g) => (
        <GuildCard key={g.id} guild={g} onChange={change} />
      ))}
      {shown.length === 0 && <p className="dim center">No servers match “{query}”.</p>}
    </div>
  );
}
