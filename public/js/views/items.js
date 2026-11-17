import { api, qs } from '../api.js';
import { state, can, activeUsers, statusLabel } from '../state.js';
import { esc, fmtH, fmtDate, options, statusBadge, exportDialog, openModal, formData, attempt, confirmDialog, toast, dueInfo, emptyState, icon } from '../ui.js';
import { go } from '../app.js';

const filters = { q: '', category: '', status: '', active: 'active', due: '', watching: false };
const DUE = [{ id: 'overdue', label: 'Overdue' }, { id: 'week', label: 'Due in 7 days' }];

const COLUMNS = [
  { key: 'reference', label: 'Reference' },
  { key: 'title', label: 'Title' },
  { key: 'status_label', label: 'Status' },
  { key: 'sub_status_label', label: 'Sub-status', default: false },
  { key: 'owner_name', label: 'Owner' },
  { label: 'Categories', get: (r) => r.categories.map((c) => c.label) },
  { key: 'primary_category_label', label: 'Primary category', default: false },
  { key: 'estimated_hours', label: 'Estimated hours', default: false },
  { key: 'approved_hours', label: 'Approved hours' },
  { key: 'actual_hours', label: 'Actual hours' },
  { key: 'target_date', label: 'Target date' },
  { label: 'Active', get: (r) => (r.is_active && !r.is_inactive ? 'Yes' : 'No') },
  { key: 'description', label: 'Description', default: false },
];

const filterControls = (f) => `
  <label class="field">Search<input name="q" value="${esc(f.q)}" placeholder="Title, reference…"></label>
  <label class="field">Category<select name="category">${options(state.meta.categories, f.category, { blank: 'All categories' })}</select></label>
  <label class="field">Status<select name="status">${options(state.meta.statuses, f.status, { value: 'code', blank: 'All statuses' })}</select></label>
  <label class="field">Due<select name="due">${options(DUE, f.due, { blank: 'Any date' })}</select></label>
  <label class="field">Show<select name="active">${options([{ id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }, { id: 'all', label: 'All' }], f.active)}</select></label>`;

const query = (f) => qs({ ...f, watching: f.watching ? '1' : '' });

export async function render(el, params = {}) {
  if (params.due) filters.due = params.due; // e.g. from the sidebar reminder badge
  const lead = can('lead');
  const selected = new Set();
  el.innerHTML = `
    <div class="page-head"><h1>Work Items</h1>
      <div class="toolbar toolbar-flush"><button data-export>Export CSV</button>${lead ? '<button class="primary" data-new>New work item</button>' : ''}</div></div>
    <div class="panel">
      <div class="form-grid" data-filters>${filterControls(filters)}</div>
      <div class="toolbar toolbar-between filter-foot">
        <label class="check small"><input type="checkbox" data-watching ${filters.watching ? 'checked' : ''}> ${icon('eye')} Only items I'm watching</label>
        <span class="muted small" data-count></span></div>
      ${lead ? `<div class="bulkbar" data-bulk hidden>
        <b data-selcount></b>
        <select data-bulk-status aria-label="Set status">${options(state.meta.statuses, '', { value: 'code', blank: 'Status…' })}</select>
        <select data-bulk-owner aria-label="Set owner">${options(activeUsers(), '', { label: 'display_name', blank: 'Owner…' })}</select>
        <input type="date" data-bulk-date aria-label="Set target date">
        <button class="primary" data-bulk-apply>Apply</button><button data-bulk-clear>Clear</button></div>` : ''}
      <div class="table-wrap" data-table></div></div>`;

  const $ = (sel) => el.querySelector(sel);
  const syncBulk = () => {
    if (!lead) return;
    $('[data-bulk]').hidden = !selected.size;
    $('[data-selcount]').textContent = `${selected.size} selected`;
    const all = $('[data-selall]');
    if (all) all.checked = selected.size > 0 && [...el.querySelectorAll('[data-sel]')].every((c) => c.checked);
  };

  const load = async () => {
    const rows = await api(`/api/work-items${query(filters)}`);
    $('[data-count]').textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
    for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);
    $('[data-table]').innerHTML = rows.length ? `<table class="data"><thead><tr>
        ${lead ? '<th class="sel"><input type="checkbox" data-selall aria-label="Select all"></th>' : ''}
        <th>Ref</th><th>Title</th><th>Status</th><th>Owner</th><th>Categories</th><th class="num">Actual / approved</th><th>Target</th></tr></thead><tbody>
      ${rows.map((r) => {
        const over = r.approved_hours && r.actual_hours > r.approved_hours;
        const due = dueInfo(r.target_date, state.meta.today, r.is_terminal);
        return `<tr class="clickable" data-id="${r.id}" data-href="#/items/${r.id}" tabindex="0">
          ${lead ? `<td class="sel"><input type="checkbox" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''} aria-label="Select ${esc(r.reference)}"></td>` : ''}
          <td><b>${esc(r.reference)}</b></td>
          <td>${esc(r.title)}${r.is_watching ? ` <span class="watch-mark" title="You're watching this">${icon('eye')}</span>` : ''}${!r.is_active ? ' <span class="badge">inactive</span>' : ''}</td>
          <td>${statusBadge(r.status_code, r.status_label)}</td><td>${esc(r.owner_name || '—')}</td>
          <td><div class="chips">${r.categories.map((c) => `<span class="badge">${esc(c.label)}</span>`).join('')}</div></td>
          <td class="num"><span class="${over ? 'badge bad' : ''}">${fmtH(r.actual_hours)} / ${r.approved_hours != null ? fmtH(r.approved_hours) : '—'}</span></td>
          <td class="nowrap">${fmtDate(r.target_date)}${due ? `<div><span class="badge ${due.kind}">${esc(due.text)}</span></div>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`
      : emptyState('search', 'No work items match', 'Try clearing a filter or searching for a reference.',
        '<button data-reset>Clear filters</button>');
    const reset = $('[data-reset]');
    if (reset) reset.onclick = () => { Object.assign(filters, { q: '', category: '', status: '', active: 'active', due: '', watching: false }); render(el); };
    syncBulk();
  };

  let t;
  $('[data-filters]').addEventListener('input', () => {
    Object.assign(filters, formData($('[data-filters]')));
    clearTimeout(t);
    t = setTimeout(load, 200);
  });
  $('[data-watching]').onchange = (e) => { filters.watching = e.target.checked; load(); };
  $('[data-table]').addEventListener('click', (e) => {
    const box = e.target.closest('[data-sel], [data-selall]');
    if (box) {
      if (box.hasAttribute('data-selall')) {
        el.querySelectorAll('[data-sel]').forEach((c) => { c.checked = box.checked; const id = Number(c.dataset.sel); if (box.checked) selected.add(id); else selected.delete(id); });
      } else {
        const id = Number(box.dataset.sel);
        if (box.checked) selected.add(id); else selected.delete(id);
      }
      syncBulk();
      return;
    }
    if (e.target.closest('td.sel')) return;
    const row = e.target.closest('tr[data-id]');
    if (row) go(`#/items/${row.dataset.id}`);
  });
  if (lead) {
    $('[data-bulk-clear]').onclick = () => { selected.clear(); el.querySelectorAll('[data-sel], [data-selall]').forEach((c) => { c.checked = false; }); syncBulk(); };
    $('[data-bulk-apply]').onclick = async () => {
      const body = { ids: [...selected], status_code: $('[data-bulk-status]').value, owner_id: $('[data-bulk-owner]').value, target_date: $('[data-bulk-date]').value };
      const changes = [body.status_code && `status → ${statusLabel(body.status_code)}`, body.owner_id && `owner → ${(activeUsers().find((u) => String(u.id) === body.owner_id) || {}).display_name}`, body.target_date && `target → ${fmtDate(body.target_date)}`].filter(Boolean);
      if (!changes.length) return toast('Choose a status, owner or target date to apply', 'error');
      if (!await confirmDialog({ title: `Update ${selected.size} work item${selected.size > 1 ? 's' : ''}?`, html: `<p>Set ${changes.map(esc).join(', ')}.</p><p class="muted small">Each change is recorded in the audit log.</p>`, ok: 'Apply' })) return;
      const r = await attempt(() => api('/api/work-items/bulk', { method: 'POST', body }));
      if (r) { toast(`Updated ${r.updated} item${r.updated === 1 ? '' : 's'}`); selected.clear(); render(el); }
    };
  }
  $('[data-export]').onclick = () => exportDialog({
    title: 'Export work items', columns: COLUMNS, filename: `work-items-${state.meta.today}.csv`,
    filtersHtml: filterControls(filters),
    fetchRows: (f) => api(`/api/work-items${query({ ...f, watching: filters.watching })}`),
  });
  const newBtn = $('[data-new]');
  if (newBtn) newBtn.onclick = () => itemForm();
  await load();
}

// Create (no item) or edit (item) dialog. Leads only; the server enforces it too.
export function itemForm(item, onSaved) {
  const editing = Boolean(item);
  const i = item || {};
  const m = openModal({
    title: editing ? `Edit ${i.reference}` : 'New work item', wide: true,
    body: `<div class="form-grid">
      <label class="field">Reference<input name="reference" value="${esc(i.reference || '')}" placeholder="${editing ? '' : 'Leave blank to auto-number'}"></label>
      <label class="field full">Title<input name="title" value="${esc(i.title || '')}" required></label>
      <label class="field full">Description<textarea name="description">${esc(i.description || '')}</textarea></label>
      <label class="field">Owner<select name="owner_id">${options(activeUsers(), i.owner_id, { label: 'display_name', blank: 'Unassigned' })}</select></label>
      <label class="field">Target date<input type="date" name="target_date" value="${esc(i.target_date || '')}"></label>
      <label class="field">Estimated hours<input type="number" min="0" step="0.5" name="estimated_hours" value="${i.estimated_hours ?? ''}"></label>
      <label class="field">Approved hours<input type="number" min="0" step="0.5" name="approved_hours" value="${i.approved_hours ?? ''}"></label>
      ${editing ? `<label class="field">Primary category<select name="primary_category_id">${options(i.categories, i.primary_category_id, { blank: 'None' })}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" name="is_active" ${i.is_active ? 'checked' : ''}> Active</label>`
        : `<div class="full"><div class="field" style="margin-bottom:6px">Categories (first ticked = primary)</div>
          <div class="colpick" style="margin:0">${state.meta.categories.filter((c) => c.is_active).map((c, n) => `<label class="check"><input type="checkbox" data-cat="${c.id}" ${n < 2 ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div></div>`}
    </div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-save>Save</button>',
  });
  m.el.querySelector('[data-save]').onclick = async () => {
    const body = formData(m.el.querySelector('.content'));
    if (!editing) {
      body.category_ids = [...m.el.querySelectorAll('[data-cat]:checked')].map((b) => Number(b.dataset.cat));
      body.primary_category_id = body.category_ids[0];
    }
    const saved = await attempt(() => api(editing ? `/api/work-items/${i.id}` : '/api/work-items', { method: editing ? 'PATCH' : 'POST', body }),
      editing ? 'Saved' : 'Work item created');
    if (!saved) return;
    m.close();
    if (onSaved) onSaved(saved); else go(`#/items/${saved.id}`);
  };
}
