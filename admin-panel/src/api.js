const BASE = '/admin/api';

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  session: () => request('/session'),
  login: (password) => request('/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/logout', { method: 'POST' }),
  status: () => request('/status'),
  guilds: () => request('/guilds'),
  setGuildDisabled: (id, disabled) =>
    request(`/guilds/${id}`, { method: 'PATCH', body: JSON.stringify({ disabled }) }),
  channels: (id) => request(`/guilds/${id}/channels`),
  rollChannels: (id) => request(`/guilds/${id}/roll-channels`),
  addRollChannel: (id, channelId) =>
    request(`/guilds/${id}/roll-channels`, { method: 'POST', body: JSON.stringify({ channelId }) }),
  removeRollChannel: (id, channelId) =>
    request(`/guilds/${id}/roll-channels/${channelId}`, { method: 'DELETE' }),
  ignoredChannels: (id) => request(`/guilds/${id}/ignored-channels`),
  addIgnoredChannel: (id, channelId) =>
    request(`/guilds/${id}/ignored-channels`, { method: 'POST', body: JSON.stringify({ channelId }) }),
  removeIgnoredChannel: (id, channelId) =>
    request(`/guilds/${id}/ignored-channels/${channelId}`, { method: 'DELETE' }),
  guildFixers: (id) => request(`/guilds/${id}/fixers`),
  setGuildFixer: (id, label, host) =>
    request(`/guilds/${id}/fixers/${encodeURIComponent(label)}`, { method: 'PUT', body: JSON.stringify({ host }) }),
  resetGuildFixer: (id, label) =>
    request(`/guilds/${id}/fixers/${encodeURIComponent(label)}`, { method: 'DELETE' }),
  env: () => request('/env'),
  saveEnv: (pairs) => request('/env', { method: 'PUT', body: JSON.stringify({ pairs }) }),
  deploy: () => request('/deploy', { method: 'POST' }),
  deployLog: () => request('/deploy-log'),
  pm2Status: () => request('/pm2/status'),
  pm2Logs: () => request('/pm2/logs'),
  pm2Restart: () => request('/pm2/restart', { method: 'POST' }),
  pm2Stop: () => request('/pm2/stop', { method: 'POST' }),
  pm2Start: () => request('/pm2/start', { method: 'POST' }),
  passkeyLoginOptions: () => request('/passkey/login-options', { method: 'POST' }),
  passkeyLoginVerify: (response) =>
    request('/passkey/login-verify', { method: 'POST', body: JSON.stringify({ response }) }),
  passkeys: () => request('/passkey'),
  passkeyRegisterOptions: () => request('/passkey/register-options', { method: 'POST' }),
  passkeyRegisterVerify: (name, response) =>
    request('/passkey/register-verify', { method: 'POST', body: JSON.stringify({ name, response }) }),
  removePasskey: (id) => request(`/passkey/${id}`, { method: 'DELETE' }),
};
