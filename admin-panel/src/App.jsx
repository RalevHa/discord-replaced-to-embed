import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Guilds from './pages/Guilds';
import EnvEditor from './pages/EnvEditor';
import { Icon, Spinner, UIProvider } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/guilds', label: 'Guilds', icon: 'server' },
  { to: '/env', label: 'Environment', icon: 'terminal' },
];

function Layout({ onLogout }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="bot" size={18} />
          </span>
          <span className="brand-name">Bot Admin</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={n.label}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="nav-logout" onClick={onLogout} title="Log out">
          <Icon name="logout" />
          <span>Log out</span>
        </button>
      </aside>
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

  if (authenticated === null) return <Spinner />;

  return (
    <UIProvider>
      <BrowserRouter basename="/admin">
        {authenticated ? (
          <Layout onLogout={logout} />
        ) : (
          <Login onLogin={login} onVerifyPasskey={verifyPasskey} onCancelPasskey={logout} />
        )}
      </BrowserRouter>
    </UIProvider>
  );
}
