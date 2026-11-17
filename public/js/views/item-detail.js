import { api } from '../api.js';
import { state, can } from '../state.js';
import { esc, fmtH, fmtDate, fmtDateTime, options, statusBadge, attempt, confirmDialog, formData, openModal, dueInfo, emptyState, icon } from '../ui.js';
import { itemForm } from './items.js';
import { go } from '../app.js';

const ACTIVITY = 'activity';
let activeTab = {}; // remembers the open tab per item (a category id, or 'activity')
// Inactive sub-statuses are hidden from pickers, except the one already set.
const pickable = (current) => state.meta.subStatuses.filter((s) => !s.is_inactive || s.code === current);
const statusName = (code) => (state.meta.statuses.find((s) => s.code === code) || {}).label || code;
const subName = (code) => (state.meta.subStatuses.find((s) => s.code === code) || {}).label || code;

// One readable sentence per audit row for the Activity tab.
function describe(a) {
  const v = (x) => `<b>${esc(x ?? '—')}</b>`;
  switch (a.entity_type) {
    case 'work_item':
      if (a.action === 'create') return 'created this item';
      if (a.field === 'status_code') return `moved status ${v(statusName(a.old_value))} → ${v(statusName(a.new_value))}`;
      if (a.field === 'sub_status_code') return `set the overall sub-status to ${v(subName(a.new_value))}`;
      if (a.field === 'categories') return a.new_value && a.new_value.startsWith('-') ? 'removed a category' : 'added a category';
      return `changed ${esc(a.field.replace(/_id$/, '').replace(/_/g, ' '))} ${a.old_value ? `from ${v(a.old_value)} ` : ''}to ${v(a.new_value)}`;
    case 'group_state': return `set a category sub-status to ${v(subName(a.new_value))}`;
    case 'time_entry':
      if (a.action === 'delete') return `cleared ${v(`${a.old_value}h`)} on ${esc(a.entity_id.split('/').pop())}`;
      return `logged ${v(`${a.new_value}h`)} on ${esc(a.entity_id.split('/').pop())}${a.old_value ? ` (was ${esc(a.old_value)}h)` : ''}`;
    case 'comment': return 'commented';
    case 'link': return a.action === 'delete' ? 'removed a link' : 'added a link';
    default: return `${esc(a.action)} ${esc(a.entity_type)}`;
  }
}

export async function render(el, { id }) {
  const it = await api(`/api/work-items/${id}`);
  const tab = activeTab[id] === ACTIVITY || it.groups.find((g) => g.id === activeTab[id]) ? activeTab[id] : (it.groups[0] ? it.groups[0].id : ACTIVITY);
  const member = can('member');
  const lead = can('lead');
  const over = it.approved_hours && it.actual_hours > it.approved_hours;
  const pct = it.approved_hours ? Math.min(100, Math.round((it.actual_hours / it.approved_hours) * 100)) : 0;
  const due = dueInfo(it.target_date, state.meta.today, it.is_terminal);
  const unattached = state.meta.categories.filter((c) => c.is_active && !it.groups.some((g) => g.id === c.id));
  const linked = Boolean(state.meta.me.id);

  el.innerHTML = `
    <div class="page-head">
      <div><a href="#/items" class="small">‹ Work items</a>
        <h1>${esc(it.title)}</h1>
        <div class="toolbar toolbar-flush"><span class="muted">${esc(it.reference)}</span>${statusBadge(it.status_code, it.status_label)}
          ${due ? `<span class="badge ${due.kind}">${esc(due.text)}</span>` : ''}${!it.is_active || it.is_inactive ? '<span class="badge">inactive</span>' : ''}</div></div>
      <div class="toolbar toolbar-flush">
        ${linked ? `<button data-watch aria-pressed="${it.is_watching}">${icon(it.is_watching ? 'eye-off' : 'eye')} ${it.is_watching ? 'Unwatch' : 'Watch'}</button>` : ''}
        ${lead ? '<button data-edit>Edit</button><button class="danger" data-delete>Delete</button>' : ''}</div>
    </div>

    <div class="detail">
      <div class="panel">
        ${it.description ? `<p class="desc">${esc(it.description)}</p>` : '<p class="desc muted">No description.</p>'}
        <div class="tabs" role="tablist">
          ${it.groups.map((g) => `<button role="tab" aria-selected="${g.id === tab}" data-tab="${g.id}" class="${g.id === tab ? 'active' : ''}">${esc(g.label)}
            <span class="muted small">${fmtH(g.hours)}</span>${g.id === it.primary_category_id ? ' <span title="Primary category">★</span>' : ''}</button>`).join('')}
          <button role="tab" aria-selected="${tab === ACTIVITY}" data-tab="${ACTIVITY}" class="${tab === ACTIVITY ? 'active' : ''}">Activity <span class="muted small">${it.activity.length}</span></button>
          ${lead ? '<button data-addcat title="Add a category">＋</button>' : ''}
        </div>
        <div class="hint hint-gap">★ primary category · each category tab has its own sub-status and comments</div>
        <div data-tabbody></div>
      </div>

      <aside class="inspector">
        <div class="panel">
          <h2>Details</h2>
          <dl class="props">
            <dt>Status</dt><dd>${member ? `<select data-status aria-label="Status">${options(state.meta.statuses, it.status_code, { value: 'code' })}</select>` : statusBadge(it.status_code, it.status_label)}</dd>
            <dt>Sub-status</dt><dd>${member ? `<select data-substatus aria-label="Overall sub-status">${options(pickable(it.sub_status_code), it.sub_status_code, { value: 'code', blank: '—' })}</select>` : esc(it.sub_status_label || '—')}</dd>
            <dt>Owner</dt><dd>${esc(it.owner_name || 'Unassigned')}</dd>
            <dt>Target</dt><dd>${fmtDate(it.target_date)}${due ? ` <span class="badge ${due.kind}">${esc(due.text)}</span>` : ''}</dd>
            <dt>Estimated</dt><dd>${it.estimated_hours != null ? fmtH(it.estimated_hours) : '—'}</dd>
          </dl>
          <div class="hours-meter"><div class="row"><span class="muted small">Hours used</span>
            <b class="${over ? 'text-bad' : ''}">${fmtH(it.actual_hours)} <span class="muted">/ ${it.approved_hours != null ? fmtH(it.approved_hours) : '—'}</span></b></div>
            ${it.approved_hours ? `<div class="meter"><div class="${over ? 'over' : pct > 85 ? 'near' : ''}" style="width:${pct}%"></div></div>` : ''}</div>
        </div>

        <div class="panel">
          <h2>Watchers <span class="muted small">${it.watchers.length}</span></h2>
          ${it.watchers.length ? `<div class="chips">${it.watchers.map((w) => `<span class="chip">${esc(w.display_name)}</span>`).join('')}</div>`
            : '<div class="hint">No one is watching yet. Watch an item to find it under “Watching” in Work Items.</div>'}
        </div>

        <div class="panel">
          <h2>Links <span class="muted small">${it.links.length}</span></h2>
          ${it.links.length ? `<ul class="links">${it.links.map((l) => `<li>${icon('link')}<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${esc(l.title)}</a>
            ${member && (l.added_by === state.meta.me.id || lead) ? `<button class="link small" data-unlink="${l.id}" aria-label="Remove link ${esc(l.title)}">Remove</button>` : ''}</li>`).join('')}</ul>`
            : '<div class="hint">Add specs, tickets or dashboards this item depends on.</div>'}
          ${member ? `<div class="form-grid form-tight" data-linkform>
            <input name="url" type="url" placeholder="https://…" aria-label="Link URL">
            <input name="title" placeholder="Title (optional)" aria-label="Link title">
            <button data-addlink>Add link</button></div>` : ''}
        </div>
      </aside>
    </div>`;

  const body = el.querySelector('[data-tabbody]');
  const group = it.groups.find((g) => g.id === tab);
  if (tab === ACTIVITY) {
    body.innerHTML = it.activity.length ? `<ol class="timeline">${it.activity.map((a) => `<li>
        <span class="dot ${a.action}"></span><div><b>${esc(a.actor)}</b> ${describe(a)}<div class="muted small">${fmtDateTime(a.changed_at)}</div></div></li>`).join('')}</ol>`
      : emptyState('clock', 'No activity yet', 'Changes, comments and time logs will appear here.');
  } else if (!group) {
    body.innerHTML = emptyState('tag', 'No categories yet', lead ? 'Add a category with the ＋ tab.' : 'A lead can add categories to this item.');
  } else {
    // Thread for this tab: card-level comments (all tabs) + this category's comments + its time-log notes.
    const thread = [
      ...it.comments.filter((c) => c.category_id === null || c.category_id === group.id).map((c) => ({ ...c, type: 'comment' })),
      ...it.timeNotes.filter((t) => t.category_id === group.id).map((t) => ({ ...t, type: 'time' })),
    ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    body.innerHTML = `
      <div class="toolbar toolbar-between">
        <div class="toolbar toolbar-flush"><span class="muted small">${esc(group.label)} sub-status</span>
          ${member ? `<select data-groupstate aria-label="${esc(group.label)} sub-status">${options(pickable(group.sub_status_code), group.sub_status_code, { value: 'code' })}</select>`
            : statusBadge(group.sub_status_code, group.sub_status_label)}
          <span class="muted small">· ${fmtH(group.hours)} logged</span></div>
        ${lead ? `<button class="link small" data-removecat>Remove ${esc(group.label)}</button>` : ''}
      </div>
      <div class="thread">${thread.length ? thread.map((m) => m.type === 'time'
        ? `<div class="msg timelog"><div class="head"><b>${esc(m.author)}</b><span class="badge accent">time log · ${fmtH(m.hours)} on ${fmtDate(m.work_date)}</span></div><div class="body">${esc(m.note)}</div></div>`
        : `<div class="msg"><div class="head"><b>${esc(m.author || 'Unknown')}</b><span>${fmtDateTime(m.created_at)}</span>${m.category_id === null ? '<span class="badge">all tabs</span>' : ''}</div><div class="body">${esc(m.body)}</div></div>`).join('')
        : emptyState('chat', `No comments on ${group.label} yet`, member ? 'Start the conversation below.' : '')}</div>
      ${member ? `
        <div class="grid two">
          <div class="composer"><h3>Comment</h3><textarea data-comment placeholder="Write a comment… (Ctrl+Enter to post)"></textarea>
            <div class="row"><label class="check small"><input type="checkbox" data-alltabs> Post to every tab</label>
              <button class="primary" data-post>Post</button></div></div>
          <div class="composer"><h3>Log time on ${esc(group.label)}</h3>
            ${linked ? `<div class="form-grid" data-logform>
              <label class="field">Date<input type="date" name="work_date" value="${esc(state.meta.today)}" max="${esc(state.meta.today)}"></label>
              <label class="field">Hours<input type="number" name="hours" min="0.25" max="24" step="0.25" value="1"></label>
              <label class="field full">Note (shows in this tab)<input name="note" placeholder="Optional"></label></div>
              <div class="row"><span class="hint">Adds to your timesheet cell for that day.</span><button data-log>Log time</button></div>`
              : '<div class="muted">Your sign-in is not linked to a team member, so you can’t log time.</div>'}
          </div>
        </div>` : ''}`;
  }

  const refresh = () => render(el, { id });
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { activeTab[id] = b.dataset.tab === ACTIVITY ? ACTIVITY : Number(b.dataset.tab); refresh(); };
  });

  if ($('[data-status]')) $('[data-status]').onchange = async (e) => { await attempt(() => api(`/api/work-items/${id}/status`, { method: 'POST', body: { status_code: e.target.value } }), 'Status updated'); refresh(); };
  if ($('[data-substatus]')) $('[data-substatus]').onchange = async (e) => { await attempt(() => api(`/api/work-items/${id}/sub-status`, { method: 'POST', body: { sub_status_code: e.target.value } }), 'Sub-status updated'); refresh(); };
  if ($('[data-groupstate]')) $('[data-groupstate]').onchange = async (e) => { await attempt(() => api(`/api/work-items/${id}/categories/${tab}/state`, { method: 'PUT', body: { sub_status_code: e.target.value } }), `${group.label} updated`); refresh(); };

  const postComment = async () => {
    const text = $('[data-comment]').value;
    const all = $('[data-alltabs]').checked;
    if (await attempt(() => api(`/api/work-items/${id}/comments`, { method: 'POST', body: { body: text, category_id: all ? null : tab } }), 'Comment posted')) refresh();
  };
  if ($('[data-post]')) {
    $('[data-post]').onclick = postComment;
    $('[data-comment]').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); });
  }
  if ($('[data-log]')) $('[data-log]').onclick = async () => {
    const f = formData($('[data-logform]'));
    if (await attempt(() => api(`/api/work-items/${id}/time`, { method: 'POST', body: { ...f, category_id: tab } }), `Logged ${f.hours}h`)) refresh();
  };

  if ($('[data-watch]')) $('[data-watch]').onclick = async () => {
    if (await attempt(() => api(`/api/work-items/${id}/watch`, { method: 'POST', body: { watching: !it.is_watching } }), it.is_watching ? 'Stopped watching' : 'Watching this item')) refresh();
  };
  if ($('[data-addlink]')) $('[data-addlink]').onclick = async () => {
    if (await attempt(() => api(`/api/work-items/${id}/links`, { method: 'POST', body: formData($('[data-linkform]')) }), 'Link added')) refresh();
  };
  el.querySelectorAll('[data-unlink]').forEach((b) => {
    b.onclick = async () => { if (await attempt(() => api(`/api/work-items/${id}/links/${b.dataset.unlink}`, { method: 'DELETE' }).then(() => true), 'Link removed')) refresh(); };
  });

  if ($('[data-edit]')) $('[data-edit]').onclick = () => itemForm(it, refresh);
  if ($('[data-delete]')) $('[data-delete]').onclick = async () => {
    if (!await confirmDialog({ title: 'Delete work item?', html: `<p>This permanently deletes <b>${esc(it.reference)}</b> with its comments and <b>${fmtH(it.actual_hours)}</b> of logged time. Consider marking it inactive instead.</p>`, ok: 'Delete', danger: true })) return;
    if (await attempt(() => api(`/api/work-items/${id}`, { method: 'DELETE' }).then(() => true), 'Deleted')) go('#/items');
  };
  if ($('[data-addcat]')) $('[data-addcat]').onclick = () => addCategory(id, unattached, refresh);
  if ($('[data-removecat]')) $('[data-removecat]').onclick = async () => {
    if (!await confirmDialog({ title: `Remove ${group.label}?`, html: `<p>The <b>${esc(group.label)}</b> tab and its sub-status will be removed from this item. Categories with logged time can't be removed.</p>`, ok: 'Remove', danger: true })) return;
    if (await attempt(() => api(`/api/work-items/${id}/categories/${tab}`, { method: 'DELETE' }), 'Category removed')) { delete activeTab[id]; refresh(); }
  };
}

function addCategory(id, unattached, done) {
  const m = openModal({
    title: 'Add category',
    body: `<div class="form-grid">
      <label class="field full">Shared category<select data-pick>${options(unattached, '', { blank: unattached.length ? 'Choose…' : 'All shared categories are already added' })}</select></label>
      <label class="field full">…or a custom one for this item only<input data-custom placeholder="e.g. Vendor sign-off"></label></div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-ok>Add</button>',
  });
  m.el.querySelector('[data-ok]').onclick = async () => {
    const pick = m.el.querySelector('[data-pick]').value;
    const custom = m.el.querySelector('[data-custom]').value.trim();
    const body = custom ? { label: custom } : { category_id: pick };
    if (await attempt(() => api(`/api/work-items/${id}/categories`, { method: 'POST', body }), 'Category added')) { m.close(); done(); }
  };
}
