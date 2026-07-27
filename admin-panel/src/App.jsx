import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Guilds from './pages/Guilds';
import EnvEditor from './pages/EnvEditor';

function Layout({ onLogout }) {
  return (
    <div className="app">
      <nav>
        <span className="brand">Bot Admin</span>
        <Link to="/">Dashboard</Link>
        <Link to="/guilds">Guilds</Link>
        <Link to="/env">.env</Link>
        <button onClick={onLogout}>Log out</button>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/guilds" element={<Guilds />} />
          <Route path="/env" element={<EnvEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(null);

  useEffect(() => {
    api
      .session()
      .then((s) => setAuthenticated(s.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  // Returns true when a passkey (2nd factor) is required — Login.jsx uses that
  // to switch to its 2nd step instead of unlocking the dashboard immediately.
  async function login(password) {
    const result = await api.login(password);
    if (result.requiresPasskey) return true;
    setAuthenticated(true);
    return false;
  }

  async function verifyPasskey() {
    const optionsJSON = await api.passkeyLoginOptions();
    const response = await startAuthentication({ optionsJSON });
    await api.passkeyLoginVerify(response);
    setAuthenticated(true);
  }

  async function logout() {
    await api.logout();
    setAuthenticated(false);
  }

  if (authenticated === null) return <p className="loading">Loading…</p>;

  return (
    <BrowserRouter basename="/admin">
      {authenticated ? (
        <Layout onLogout={logout} />
      ) : (
        <Login onLogin={login} onVerifyPasskey={verifyPasskey} onCancelPasskey={logout} />
      )}
    </BrowserRouter>
  );
}
