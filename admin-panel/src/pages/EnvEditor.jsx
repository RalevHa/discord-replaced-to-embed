import { useEffect, useState } from 'react';
import { api } from '../api';

export default function EnvEditor() {
  const [pairs, setPairs] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .env()
      .then((data) => setPairs(data.pairs))
      .catch((e) => setError(e.message));
  }, []);

  function update(i, field, value) {
    setPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  }

  function remove(i) {
    setPairs((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addRow() {
    setPairs((prev) => [...prev, { key: '', value: '' }]);
  }

  async function save() {
    if (!window.confirm('Save and restart the bot now? It will briefly go offline.')) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.saveEnv(pairs.filter((p) => p.key));
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !pairs) return <p className="error">{error}</p>;
  if (!pairs) return <p className="loading">Loading…</p>;

  return (
    <div className="card">
      <h2>.env</h2>
      <p className="dim">Values are masked by default — click Show to reveal. Saving restarts the bot.</p>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i}>
              <td>
                <input value={p.key} onChange={(e) => update(i, 'key', e.target.value)} placeholder="KEY" />
              </td>
              <td className="env-value-cell">
                <input
                  type={revealed[i] ? 'text' : 'password'}
                  value={p.value}
                  onChange={(e) => update(i, 'value', e.target.value)}
                  placeholder="value"
                />
                <button type="button" onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}>
                  {revealed[i] ? 'Hide' : 'Show'}
                </button>
              </td>
              <td>
                <button onClick={() => remove(i)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow}>Add variable</button>{' '}
      <button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save & restart'}
      </button>
      {saved && <p>Saved — bot is restarting.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
