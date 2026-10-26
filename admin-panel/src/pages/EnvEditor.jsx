import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorNote, Icon, PageHeader, Spinner, useUI } from '../ui';

export default function EnvEditor() {
  const { ask, toast } = useUI();
  const [pairs, setPairs] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    const ok = await ask({
      title: 'Save and restart?',
      message: 'The bot will briefly go offline while it restarts with the new values.',
      confirmLabel: 'Save & restart',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.saveEnv(pairs.filter((p) => p.key));
      toast('Saved — bot is restarting');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (error && !pairs) return <ErrorNote>{error}</ErrorNote>;
  if (!pairs) return <Spinner />;

  return (
    <div className="page">
      <PageHeader title="Environment" subtitle="Values are masked by default. Saving restarts the bot." />
      <section className="card">
        <div className="env-row env-head">
          <span>Key</span>
          <span>Value</span>
          <span />
        </div>
        {pairs.map((p, i) => (
          <div className="env-row" key={i}>
            <input
              className="mono"
              value={p.key}
              onChange={(e) => update(i, 'key', e.target.value)}
              placeholder="KEY"
              aria-label="Key"
            />
            <div className="env-value">
              <input
                className="mono"
                type={revealed[i] ? 'text' : 'password'}
                value={p.value}
                onChange={(e) => update(i, 'value', e.target.value)}
                placeholder="value"
                aria-label="Value"
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                aria-label={revealed[i] ? 'Hide value' : 'Show value'}
                onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}
              >
                <Icon name={revealed[i] ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
            <button className="btn btn-icon btn-ghost" aria-label="Delete variable" onClick={() => remove(i)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <div className="action-bar">
          <button className="btn" onClick={addRow}>
            <Icon name="plus" size={15} />
            Add variable
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save & restart'}
          </button>
        </div>
      </section>
    </div>
  );
}
