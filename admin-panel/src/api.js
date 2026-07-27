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
  env: () => request('/env'),
  saveEnv: (pairs) => request('/env', { method: 'PUT', body: JSON.stringify({ pairs }) }),
  deploy: () => request('/deploy', { method: 'POST' }),
  deployLog: () => request('/deploy-log'),
  pm2Status: () => request('/pm2/status'),
  pm2Logs: () => request('/pm2/logs'),
  pm2Restart: () => request('/pm2/restart', { method: 'POST' }),
  pm2Stop: () => request('/pm2/stop', { method: 'POST' }),
  pm2Start: () => request('/pm2/start', { method: 'POST' }),
};
