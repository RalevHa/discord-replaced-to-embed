import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';

function RollChannels({ guildId }) {
  const [channels, setChannels] = useState([]);
  const [available, setAvailable] = useState([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');

  function reload() {
    api.rollChannels(guildId).then(setChannels).catch((e) => setError(e.message));
  }

  useEffect(() => {
    reload();
    api.channels(guildId).then(setAvailable).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  async function add() {
    if (!picked) return;
    await api.addRollChannel(guildId, picked);
    setPicked('');
    reload();
  }

  async function remove(channelId) {
    await api.removeRollChannel(guildId, channelId);
    reload();
  }

  return (
    <div className="roll-channels">
      {error && <p className="error">{error}</p>}
      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            #{c.name} <button onClick={() => remove(c.id)}>Remove</button>
          </li>
        ))}
        {channels.length === 0 && <li className="dim">No roll channels — /roll is disabled here.</li>}
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
      <button onClick={add} disabled={!picked}>
        Add
      </button>
    </div>
  );
}

export default function Guilds() {
  const [guilds, setGuilds] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState('');

  function reload() {
    api.guilds().then(setGuilds).catch((e) => setError(e.message));
  }

  useEffect(reload, []);

  async function toggle(guild) {
    await api.setGuildDisabled(guild.id, !guild.disabled);
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
            <th>Roll channels</th>
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
                <td>{g.rollChannelCount}</td>
                <td>
                  <button onClick={() => setExpanded(expanded === g.id ? null : g.id)}>
                    {expanded === g.id ? 'Hide' : 'Manage roll channels'}
                  </button>
                </td>
              </tr>
              {expanded === g.id && (
                <tr>
                  <td colSpan={4}>
                    <RollChannels guildId={g.id} />
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
