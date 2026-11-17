import { api, qs } from '../api.js';
import { state, can, activeUsers } from '../state.js';
import { esc, fmtDate, fmtDateTime, options, statusBadge, attempt, openModal, formData, emptyState } from '../ui.js';
import { go } from '../app.js';

const filters = { state: 'open', status: '', q: '' };

export async function render(el, { id }) {
  const member = can('member');
  const list = await api(`/api/support${qs(filters)}`);
  const statusList = Object.entries(list.statuses).map(([code, label]) => ({ code, label }));
  const selected = id ? Number(id) : null;

  el.innerHTML = `
    <div class="page-head"><h1>Support Tasks</h1>${member ? '<button class="primary" data-new>New support task</button>' : ''}</div>
    <div class="split">
      <div class="panel" style="padding:0">
        <div class="toolbar" style="padding:12px 12px 0" data-filters>
          <input name="q" value="${esc(filters.q)}" placeholder="Search…" aria-label="Search" style="flex:1;min-width:120px">
          <select name="state" aria-label="Open or closed">${options([{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }], filters.state)}</select>
          <select name="status" aria-label="Status">${options(statusList, filters.status, { value: 'code', blank: 'Any status' })}</select>
        </div>
        <div>${list.rows.length ? list.rows.map((t) => {
          const late = t.is_active && t.target_date && t.target_date < state.meta.today;
          return `<div class="list-item ${t.id === selected ? 'active' : ''}" data-id="${t.id}" data-href="#/support/${t.id}" tabindex="0" role="link" aria-current="${t.id === selected}">
            <div class="row"><b>${esc(t.reference)}</b>${statusBadge(t.status, list.statuses[t.status])}</div>
            <div>${esc(t.description)}</div>
            <div class="row muted small"><span>${esc(t.owner_name || 'Unassigned')}</span>
              <span>${t.is_active ? (t.target_date ? `<span class="${late ? 'badge bad' : ''}">Target ${fmtDate(t.target_date)}</span>` : '') : '<span class="badge">closed</span>'}</span></div></div>`;
        }).join('') : emptyState('inbox', 'No support tasks here', 'Try another filter, or create one with New support task.')}</div>
      </div>
      <div data-detail>${selected ? '<div class="panel empty">Loading…</div>' : `<div class="panel">${emptyState('chat', 'Select a support task', 'Its details and activity feed open here.')}</div>`}</div>
    </div>`;

  let t;
  el.querySelector('[data-filters]').addEventListener('input', (e) => {
    Object.assign(filters, formData(el.querySelector('[data-filters]')));
    clearTimeout(t);
    t = setTimeout(() => render(el, { id }), e.target.name === 'q' ? 250 : 0);
  });
  el.querySelectorAll('.list-item').forEach((li) => { li.onclick = () => go(`#/support/${li.dataset.id}`); });
  const nb = el.querySelector('[data-new]');
  if (nb) nb.onclick = () => newTask();
  if (selected) await renderDetail(el.querySelector('[data-detail]'), selected, list, () => render(el, { id }));
}

async function renderDetail(box, id, list, refresh) {
  const member = can('member');
  let t;
  try { t = await api(`/api/support/${id}`); } catch (e) { box.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const statusList = Object.entries(list.statuses).map(([code, label]) => ({ code, label }));
  const terminal = list.terminal.includes(t.status);
  const editable = member && t.is_active;

  box.innerHTML = `<div class="panel">
    <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">${esc(t.reference)}</h2>
      <div class="toolbar" style="margin:0">${member ? (t.is_active
        ? `<button data-close-task ${terminal ? '' : 'disabled'} title="${terminal ? 'Close this task' : 'Move to Done or Cancelled first'}">Close task</button>`
        : '<button data-reopen>Reopen</button>') : ''}</div></div>
    ${member && t.is_active && !terminal ? '<div class="muted small" style="margin-bottom:8px">Closing unlocks once the status is Done or Cancelled.</div>' : ''}
    <div class="form-grid" data-form>
      <label class="field full">Description<textarea name="description" ${editable ? '' : 'disabled'}>${esc(t.description)}</textarea></label>
      <label class="field">Status<select data-status ${editable ? '' : 'disabled'}>${options(statusList, t.status, { value: 'code' })}</select></label>
      <label class="field">Assignee<select name="owner_id" ${editable ? '' : 'disabled'}>${options(activeUsers(), t.owner_id, { label: 'display_name', blank: 'Unassigned' })}</select></label>
      <label class="field">Target date<input type="date" name="target_date" value="${esc(t.target_date || '')}" ${editable ? '' : 'disabled'}></label>
      ${editable ? '<div style="align-self:end"><button data-save>Save details</button></div>' : ''}
    </div>
    <h3 style="margin-top:18px">Activity</h3>
    <div class="thread">${t.activity.map((a) => `<div class="msg ${a.kind === 'comment' ? '' : 'state'}"><div class="head"><b>${esc(a.author || 'Unknown')}</b>
      <span>${fmtDateTime(a.created_at)}</span>${a.kind === 'comment' ? '' : `<span class="badge ${a.kind === 'state' ? 'accent' : ''}">${a.kind === 'state' ? 'event' : 'status'}</span>`}</div>
      <div class="body">${esc(a.body)}</div></div>`).join('')}</div>
    ${member ? '<div class="composer"><textarea data-comment placeholder="Add a comment…"></textarea><div class="row"><span></span><button class="primary" data-post>Comment</button></div></div>' : ''}
  </div>`;

  const q = (s) => box.querySelector(s);
  if (q('[data-status]')) q('[data-status]').onchange = async (e) => { await attempt(() => api(`/api/support/${id}/status`, { method: 'POST', body: { status: e.target.value } }), 'Status updated'); refresh(); };
  if (q('[data-save]')) q('[data-save]').onclick = async () => { if (await attempt(() => api(`/api/support/${id}`, { method: 'PATCH', body: formData(q('[data-form]')) }), 'Saved')) refresh(); };
  if (q('[data-post]')) q('[data-post]').onclick = async () => { if (await attempt(() => api(`/api/support/${id}/comments`, { method: 'POST', body: { body: q('[data-comment]').value } }), 'Comment added')) refresh(); };
  if (q('[data-close-task]')) q('[data-close-task]').onclick = async () => { await attempt(() => api(`/api/support/${id}/close`, { method: 'POST' }), 'Task closed'); refresh(); };
  if (q('[data-reopen]')) q('[data-reopen]').onclick = async () => { await attempt(() => api(`/api/support/${id}/reopen`, { method: 'POST' }), 'Task reopened'); refresh(); };
}

function newTask() {
  const m = openModal({
    title: 'New support task',
    body: `<div class="form-grid">
      <label class="field">Reference<input name="reference" placeholder="Leave blank to auto-number"></label>
      <label class="field">Target date<input type="date" name="target_date"></label>
      <label class="field full">Description<textarea name="description"></textarea></label>
      <label class="field">Assignee<select name="owner_id">${options(activeUsers(), state.meta.me.id, { label: 'display_name', blank: 'Unassigned' })}</select></label></div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-ok>Create</button>',
  });
  m.el.querySelector('[data-ok]').onclick = async () => {
    const t = await attempt(() => api('/api/support', { method: 'POST', body: formData(m.el.querySelector('.content')) }), 'Support task created');
    if (t) { m.close(); go(`#/support/${t.id}`); }
  };
}
