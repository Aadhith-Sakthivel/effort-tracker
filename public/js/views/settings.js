import { api } from '../api.js';
import { state, can, loadMeta } from '../state.js';
import { esc, options, attempt, formData } from '../ui.js';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: n, label: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][n - 1] }));

// One editable table for both status lookups (statuses and sub-statuses share a shape).
const lookupPanel = (title, singular, kind, rows, note) => `
  <div class="panel"><h2>${esc(title)}</h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>Label</th><th>Order</th><th>Terminal</th><th>Inactive</th><th></th></tr></thead><tbody>
    ${rows.map((st) => `<tr data-${kind}="${esc(st.code)}"><td><input name="label" value="${esc(st.label)}" aria-label="Label"></td>
      <td><input type="number" name="sort_order" value="${st.sort_order}" class="narrow" aria-label="Order"></td>
      <td><input type="checkbox" name="is_terminal" ${st.is_terminal ? 'checked' : ''} aria-label="Terminal"></td>
      <td><input type="checkbox" name="is_inactive" ${st.is_inactive ? 'checked' : ''} aria-label="Inactive"></td>
      <td><button data-save-${kind}="${esc(st.code)}">Save</button></td></tr>`).join('')}</tbody></table></div>
    <div class="toolbar toolbar-top"><input data-new-${kind} placeholder="New ${esc(singular)} label" aria-label="New label"><button data-add-${kind}>Add</button></div>
    <div class="hint">${note}</div></div>`;

export async function render(el) {
  if (!can('lead')) {
    const me = state.meta.me;
    el.innerHTML = `<div class="panel empty"><h2>Settings are for leads</h2>
      <p>You're signed in as <b>${esc(me.display_name)}</b> (${esc(me.role)}).
      ${state.meta.devLogin ? 'Pick a lead in <b>Sign in as</b> (sidebar, bottom left) to open Settings.' : 'Ask a lead to change your role on the Team page.'}</p></div>`;
    return;
  }
  await loadMeta();
  const m = state.meta;
  const s = m.settings;

  el.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="muted small">Business timezone ${esc(m.timezone)} · ${esc(m.backend)}</div></div></div>
    <div class="grid side">
      <div class="panel"><h2>Timesheet rules</h2>
        <div class="form-grid" data-rules>
          <label class="field">Daily hour cap (per person)<input type="number" min="1" max="24" step="0.5" name="daily_hour_cap" value="${esc(s.daily_hour_cap)}"></label>
          <label class="field">Week freezes on (following week)<select name="freeze_weekday">${options(WEEKDAYS, s.freeze_weekday)}</select></label>
          <label class="field">…at hour (0–23)<input type="number" min="0" max="23" name="freeze_hour" value="${esc(s.freeze_hour)}"></label>
        </div><div class="toolbar-top"><button class="primary" data-saverules>Save rules</button></div></div>
      <div class="grid">
        ${lookupPanel('Work-item statuses', 'status', 'status', m.statuses, 'Terminal = finished. Inactive = hidden from default views and the board; no new time can be logged.')}
        ${lookupPanel('Category sub-statuses', 'sub-status', 'sub', m.subStatuses, 'Used per category tab and as the overall sub-status. Inactive ones are hidden from pickers.')}
      </div>
      <div class="panel span-all"><h2>Shared categories</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>Label</th><th>Code</th><th>Order</th><th>Active</th><th></th></tr></thead><tbody>
        ${m.categories.map((c) => `<tr data-cat="${c.id}"><td><input name="label" value="${esc(c.label)}" aria-label="Label"></td><td class="muted">${esc(c.code)}</td>
          <td><input type="number" name="sort_order" value="${c.sort_order}" class="narrow" aria-label="Order"></td>
          <td><input type="checkbox" name="is_active" ${c.is_active ? 'checked' : ''} aria-label="Active"></td>
          <td><button data-savecat="${c.id}">Save</button></td></tr>`).join('')}</tbody></table></div>
        <div class="toolbar toolbar-top"><input data-newcat placeholder="New category label" aria-label="New category label"><button data-addcat>Add category</button></div>
        <div class="hint">Custom categories created on a single work item don't appear here.</div></div>
    </div>`;

  const refresh = () => render(el);
  el.querySelector('[data-saverules]').onclick = async () => {
    if (await attempt(() => api('/api/settings', { method: 'PUT', body: formData(el.querySelector('[data-rules]')) }), 'Rules saved')) refresh();
  };
  for (const [kind, path] of [['status', 'statuses'], ['sub', 'sub-statuses']]) {
    el.querySelectorAll(`[data-save-${kind}]`).forEach((b) => {
      b.onclick = async () => {
        const code = b.getAttribute(`data-save-${kind}`);
        const row = el.querySelector(`tr[data-${kind}="${CSS.escape(code)}"]`);
        if (await attempt(() => api(`/api/${path}/${encodeURIComponent(code)}`, { method: 'PATCH', body: formData(row) }), 'Saved')) refresh();
      };
    });
    el.querySelector(`[data-add-${kind}]`).onclick = async () => {
      const label = el.querySelector(`[data-new-${kind}]`).value;
      if (await attempt(() => api(`/api/${path}`, { method: 'POST', body: { label } }), 'Added')) refresh();
    };
  }
  el.querySelectorAll('[data-savecat]').forEach((b) => {
    b.onclick = async () => {
      const row = el.querySelector(`tr[data-cat="${b.dataset.savecat}"]`);
      if (await attempt(() => api(`/api/categories/${b.dataset.savecat}`, { method: 'PATCH', body: formData(row) }), 'Category saved')) refresh();
    };
  });
  el.querySelector('[data-addcat]').onclick = async () => {
    if (await attempt(() => api('/api/categories', { method: 'POST', body: { label: el.querySelector('[data-newcat]').value } }), 'Category added')) refresh();
  };
}
