import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';

// Shared shape for any "pick a channel to add/remove from a per-guild list"
// panel — used for both the /roll-channel allowlist and the /ignore-channel
// list so the two don't duplicate the same add/remove UI.
function ChannelList({ guildId, list, add, remove, emptyText }) {
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

  async function handleAdd() {
    if (!picked) return;
    await add(guildId, picked);
    setPicked('');
    reload();
  }

  async function handleRemove(channelId) {
    await remove(guildId, channelId);
    reload();
  }

  return (
    <div className="roll-channels">
      {error && <p className="error">{error}</p>}
      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            #{c.name} <button onClick={() => handleRemove(c.id)}>Remove</button>
          </li>
        ))}
        {channels.length === 0 && <li className="dim">{emptyText}</li>}
      </ul>
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
      <button onClick={handleAdd} disabled={!picked}>
        Add
      </button>
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
  const [fixers, setFixers] = useState(null);
  const [error, setError] = useState('');

  function reload() {
    api.guildFixers(guildId).then(setFixers).catch((e) => setError(e.message));
  }

  useEffect(reload, [guildId]);

  async function pick(label, host) {
    await api.setGuildFixer(guildId, label, host);
    reload();
  }

  async function reset(label) {
    await api.resetGuildFixer(guildId, label);
    reload();
  }

  if (error) return <p className="error">{error}</p>;
  if (!fixers) return <p className="loading">Loading…</p>;

  return (
    <div className="fixer-grid">
      {fixers.map((f) => (
        <div className="fixer-card" key={f.label}>
          <div className="fixer-card-head">
            <span className="fixer-label">{f.label}</span>
            {f.host !== f.default && (
              <button className="link-button" onClick={() => reset(f.label)}>
                Reset
              </button>
            )}
          </div>
          <div className="fixer-options">
            {f.options.map((host) => (
              <button
                key={host}
                className={`pill${host === f.host ? ' pill-active' : ''}`}
                onClick={() => pick(f.label, host)}
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

export default function Guilds() {
  const [guilds, setGuilds] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [expandedFixers, setExpandedFixers] = useState(null);
  const [expandedIgnored, setExpandedIgnored] = useState(null);
  const [error, setError] = useState('');

  function reload() {
    api.guilds().then(setGuilds).catch((e) => setError(e.message));
  }

  useEffect(reload, []);

  async function toggle(guild) {
    await api.setGuildDisabled(guild.id, !guild.disabled);
    reload();
  }

  async function toggleWebhookRepost(guild) {
    await api.setGuildWebhookRepost(guild.id, !guild.webhookRepostEnabled);
    reload();
  }

  if (error) return <p className="error">{error}</p>;
  if (!guilds) return <p className="loading">Loading…</p>;

  return (
    <div className="card">
      <h2>Guilds</h2>
      <table>
        <thead>
          <tr>
            <th>Server</th>
            <th>Link conversion</th>
            <th>Webhook repost</th>
            <th>Roll channels</th>
            <th>Ignored channels</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {guilds.map((g) => (
            <Fragment key={g.id}>
              <tr>
                <td>{g.name}</td>
                <td>
                  <button onClick={() => toggle(g)}>{g.disabled ? 'Enable' : 'Disable'}</button>
                </td>
                <td>
                  <button onClick={() => toggleWebhookRepost(g)}>
                    {g.webhookRepostEnabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
                <td>{g.rollChannelCount}</td>
                <td>{g.ignoredChannelCount}</td>
                <td>
                  <button onClick={() => setExpanded(expanded === g.id ? null : g.id)}>
                    {expanded === g.id ? 'Hide' : 'Manage roll channels'}
                  </button>{' '}
                  <button onClick={() => setExpandedIgnored(expandedIgnored === g.id ? null : g.id)}>
                    {expandedIgnored === g.id ? 'Hide' : 'Manage ignored channels'}
                  </button>{' '}
                  <button onClick={() => setExpandedFixers(expandedFixers === g.id ? null : g.id)}>
                    {expandedFixers === g.id ? 'Hide' : 'Manage fixers'}
                  </button>
                </td>
              </tr>
              {expanded === g.id && (
                <tr>
                  <td colSpan={6}>
                    <RollChannels guildId={g.id} />
                  </td>
                </tr>
              )}
              {expandedIgnored === g.id && (
                <tr>
                  <td colSpan={6}>
                    <IgnoredChannels guildId={g.id} />
                  </td>
                </tr>
              )}
              {expandedFixers === g.id && (
                <tr>
                  <td colSpan={6}>
                    <FixerPanel guildId={g.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
