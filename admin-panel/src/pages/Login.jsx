import { useState } from 'react';

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

  if (step === 'passkey') {
    return (
      <div className="login-page">
        <div className="card login-card">
          <h1>🤖 Bot Admin</h1>
          <p>Password correct — confirm with your passkey to finish logging in.</p>
          <button onClick={submitPasskey} disabled={loading} autoFocus>
            {loading ? 'Waiting for passkey…' : 'Continue with passkey'}
          </button>
          {error && <p className="error">{error}</p>}
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
        <h1>🤖 Bot Admin</h1>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
