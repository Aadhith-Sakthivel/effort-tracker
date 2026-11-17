import { api, qs } from '../api.js';
import { esc, fmtDateTime, options, emptyState } from '../ui.js';

const filters = { entity: '' };
// Create/delete rows store a small JSON snapshot; show it as "key: value · key: value".
function pretty(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.startsWith('{')) {
    try { return Object.entries(JSON.parse(s)).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`).join(' · '); } catch { /* not JSON */ }
  }
  return s;
}
const short = (v) => { const s = pretty(v); return s.length > 90 ? `${s.slice(0, 90)}…` : s; };

export async function render(el) {
  const d = await api(`/api/audit${qs({ ...filters, limit: 300 })}`);
  el.innerHTML = `
    <div class="page-head"><h1>Audit Log</h1>
      <select data-entity aria-label="Entity">${options(d.entities.map((e) => ({ id: e, label: e.replace(/_/g, ' ') })), filters.entity, { blank: 'All entities' })}</select></div>
    <div class="panel table-wrap">${d.rows.length ? `<table class="data"><thead><tr>
      <th>When</th><th>Who</th><th>Entity</th><th>Action</th><th>Field</th><th>Old</th><th>New</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td class="small" style="white-space:nowrap">${fmtDateTime(r.changed_at)}</td><td>${esc(r.actor)}</td>
        <td>${esc(r.entity_type.replace(/_/g, ' '))} <span class="muted">#${esc(r.entity_id)}</span></td>
        <td><span class="badge ${r.action === 'create' ? 'ok' : r.action === 'delete' ? 'bad' : 'accent'}">${esc(r.action)}</span></td>
        <td>${esc((r.field || '').replace(/_/g, ' '))}</td><td class="muted" title="${esc(pretty(r.old_value))}">${esc(short(r.old_value))}</td>
        <td title="${esc(pretty(r.new_value))}">${esc(short(r.new_value))}</td></tr>`).join('')}</tbody></table>`
    : emptyState('clock', 'No changes recorded yet', 'Every create, update and delete will be listed here.')}
    <div class="muted small" style="margin-top:8px">Showing the latest ${d.rows.length} entries.</div></div>`;
  el.querySelector('[data-entity]').onchange = (e) => { filters.entity = e.target.value; render(el); };
}
