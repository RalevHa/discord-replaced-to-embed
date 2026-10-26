import { useState } from 'react';
import { ErrorNote, Icon } from '../ui';

// Two-step login: a correct password alone only satisfies step 1. If the
// admin has a passkey registered, onLogin resolves to true and this switches
// to step 2 — the dashboard only unlocks once onVerifyPasskey also succeeds.
export default function Login({ onLogin, onVerifyPasskey, onCancelPasskey }) {
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('password'); // 'password' | 'passkey'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submitPassword(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const requiresPasskey = await onLogin(password);
      if (requiresPasskey) setStep('passkey');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitPasskey() {
    setLoading(true);
    setError('');
    try {
      await onVerifyPasskey();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    await onCancelPasskey();
    setStep('password');
    setPassword('');
    setError('');
  }

  const header = (
    <div className="login-head">
      <span className="brand-mark brand-mark-lg">
        <Icon name="bot" size={26} />
      </span>
      <h1>Bot Admin</h1>
    </div>
  );

  if (step === 'passkey') {
    return (
      <div className="login-page">
        <div className="card login-card">
          {header}
          <p className="dim center">Password correct — confirm with your passkey to finish logging in.</p>
          <button className="btn btn-primary btn-lg" onClick={submitPasskey} disabled={loading} autoFocus>
            <Icon name="key" />
            {loading ? 'Waiting for passkey…' : 'Continue with passkey'}
          </button>
          {error && <ErrorNote>{error}</ErrorNote>}
          <button type="button" className="link-button" onClick={cancel} disabled={loading}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submitPassword}>
        {header}
        <div className="input-icon">
          <Icon name="lock" size={16} />
          <input
            type="password"
            placeholder="Admin password"
            aria-label="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </div>
  );
}
