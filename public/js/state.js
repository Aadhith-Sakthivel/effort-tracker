// App-wide state: server metadata (me, lookups, settings) loaded once per sign-in.
import { api } from './api.js';

export const state = { meta: null };

const RANK = { viewer: 0, member: 1, lead: 2 };
export const can = (role) => Boolean(state.meta) && RANK[state.meta.me.role] >= RANK[role];

export async function loadMeta() {
  state.meta = await api('/api/meta');
  return state.meta;
}

export const statusLabel = (code) => (state.meta.statuses.find((s) => s.code === code) || {}).label || code;
export const activeUsers = () => state.meta.users.filter((u) => u.is_active);
