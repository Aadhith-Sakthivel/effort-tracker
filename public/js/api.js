// Fetch wrapper. Locally, the "Sign in as" picker's choice is sent as x-user;
// on Databricks Apps the platform adds the real identity headers and x-user is ignored.
const KEY = 'effort-tracker.devUser';

export function devUser() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setDevUser(login) {
  try { localStorage.setItem(KEY, login); } catch { /* storage blocked: picker resets on reload */ }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const who = devUser();
  if (who) headers['x-user'] = who;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
