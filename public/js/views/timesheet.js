import { api, qs } from '../api.js';
import { state, activeUsers } from '../state.js';
import { esc, fmtH, fmtDate, options, confirmDialog, toast, emptyState } from '../ui.js';

const view = { user: '', month: '', extra: {} }; // extra: rows added via "Add work item", per user|month
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export async function render(el, params = {}) {
  // Deep link: #/timesheet?user=4&month=2026-11 (used once, then the pickers take over).
  if (params.user) { view.user = Number(params.user); delete params.user; }
  if (/^\d{4}-\d{2}$/.test(params.month || '')) { view.month = params.month; delete params.month; }
  if (!view.user) view.user = state.meta.me.id || (activeUsers()[0] || {}).id || '';
  if (!view.month) view.month = state.meta.today.slice(0, 7);
  const extraKey = `${view.user}|${view.month}`;
  const extra = view.extra[extraKey] || (view.extra[extraKey] = new Set());
  const d = await api(`/api/timesheet${qs({ user: view.user, month: view.month, extra: [...extra].join(',') })}`);
  const dirty = new Map(); // key "item|cat|date" -> { before, after, label }

  const people = activeUsers(); // anyone can view any timesheet; the server decides who can edit
  const monthLabel = new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dl = d.nextDeadline;
  const addable = d.canEdit
    ? (await api('/api/work-items?active=active')).filter((w) => !d.rows.some((r) => r.id === w.id) && !w.is_terminal)
    : [];

  const dayTotal = (date) => d.rows.reduce((s, r) => s + r.categories.reduce((t, c) => t + (c.hours[date] || 0), 0), 0);
  const dayInfo = (day) => {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    return { dow, weekend: dow === 0 || dow === 6, frozen: d.frozen[day], today: day === d.today };
  };
  const cls = (i) => [i.weekend && 'weekend', i.frozen && 'frozen', i.today && 'today'].filter(Boolean).join(' ');
  const addRow = addable.length ? `<div class="ts-add"><select data-addsel aria-label="Add a work item to this timesheet">
      <option value="">＋ Add a work item to this timesheet…</option>
      ${addable.map((w) => `<option value="${w.id}">${esc(w.reference)} · ${esc(w.title)}</option>`).join('')}</select>
      <span class="muted small">Adds a row so you can log time on an item you don't own.</span></div>` : '';

  el.innerHTML = `
    <div class="page-head"><h1>Timesheet</h1>
      <div class="toolbar" style="margin:0">
        <select data-user aria-label="Team member">${options(people, view.user, { label: 'display_name' })}</select>
        <button data-prev aria-label="Previous month">‹</button><b style="min-width:130px;text-align:center">${esc(monthLabel)}</b><button data-next aria-label="Next month">›</button>
        <button data-today>This month</button>
      </div></div>
    ${d.canEdit ? '' : '<div class="notice">Read-only: you can view this timesheet but not change it.</div>'}
    <div class="toolbar" style="justify-content:space-between">
      <div class="legend">
        <span><span class="sw" style="background:var(--frozen)"></span>Frozen (read-only)</span>
        <span><span class="sw" style="background:var(--weekend)"></span>Weekend</span>
        <span><span class="sw" style="background:var(--warn-soft)"></span>Unsaved</span>
        <span>Cap <b>${d.cap}h/day</b> · this week freezes ${esc(WEEKDAYS[dl.weekday === 7 ? 0 : dl.weekday] || '')} ${fmtDate(dl.date)}, ${String(dl.hour).padStart(2, '0')}:00</span>
      </div>
      <div class="toolbar" style="margin:0"><span class="muted small" data-dirtycount></span>
        <button data-discard disabled>Discard</button><button class="primary" data-save disabled>Review &amp; save</button></div>
    </div>
    ${d.rows.length ? `<div class="ts-wrap"><table class="ts">
      <thead><tr><th class="item">Work item</th><th class="cat">Category</th>
        ${d.days.map((day) => {
          const i = dayInfo(day);
          return `<th class="${cls(i)}" title="${i.frozen ? 'Frozen: read-only' : i.today ? 'Today' : ''}"><span class="d">${Number(day.slice(8))}</span><span class="dow">${WEEKDAYS[i.dow]}</span></th>`;
        }).join('')}<th class="total">Total</th></tr></thead>
      <tbody>
        ${d.rows.map((r) => r.categories.map((c, n) => `<tr class="${n === r.categories.length - 1 ? 'group-end' : ''}">
          ${n === 0 ? `<td class="item" rowspan="${r.categories.length}"><a href="#/items/${r.id}"><b>${esc(r.reference)}</b></a>
            <div class="title">${esc(r.title)}</div><div class="muted small">${esc(r.status_label)}</div></td>` : ''}
          <td class="cat">${esc(c.label)}</td>
          ${d.days.map((day) => {
            const i = dayInfo(day);
            const v = c.hours[day];
            return `<td class="${cls(i)}"><input inputmode="decimal"
              data-cell="${r.id}|${c.id}|${day}" data-before="${v || 0}" data-label="${esc(`${r.reference} · ${c.label}`)}" value="${v || ''}" ${i.frozen || !d.canEdit ? 'disabled' : ''}
              aria-label="${esc(`${r.reference} ${c.label} ${day}`)}"></td>`;
          }).join('')}
          <td class="total num" data-rowtotal="${r.id}|${c.id}">${fmtH(Object.values(c.hours).reduce((s, h) => s + h, 0))}</td>
        </tr>`).join('')).join('')}
      </tbody>
      <tfoot><tr><td class="item">Daily total</td><td class="cat"></td>
        ${d.days.map((day) => { const t = dayTotal(day); return `<td data-daytotal="${day}" class="${t > d.cap ? 'over' : ''}">${t ? t : ''}</td>`; }).join('')}
        <td class="total num" data-grand>${fmtH(d.days.reduce((s, day) => s + dayTotal(day), 0))}</td></tr></tfoot>
    </table>${addRow}</div>`
    : `<div class="panel" style="padding:0">${emptyState('calendar', 'Nothing on this timesheet yet', 'Items this person owns, or has logged time on this month, appear automatically.')}${addRow}</div>`}`;

  const addSel = el.querySelector('[data-addsel]');
  if (addSel) addSel.onchange = async () => {
    if (!addSel.value) return;
    if (dirty.size && !await confirmDialog({ title: 'Discard unsaved changes?', html: `<p>You have ${dirty.size} unsaved change${dirty.size > 1 ? 's' : ''}. Adding a row reloads the grid.</p>`, ok: 'Discard and add', danger: true })) {
      addSel.value = '';
      return;
    }
    extra.add(Number(addSel.value));
    render(el);
  };

  const refresh = () => render(el);
  el.querySelector('[data-user]').onchange = (e) => { view.user = Number(e.target.value); refresh(); };
  el.querySelector('[data-prev]').onclick = () => { view.month = shiftMonth(view.month, -1); refresh(); };
  el.querySelector('[data-next]').onclick = () => { view.month = shiftMonth(view.month, 1); refresh(); };
  el.querySelector('[data-today]').onclick = () => { view.month = state.meta.today.slice(0, 7); refresh(); };

  const saveBtn = el.querySelector('[data-save]');
  const discardBtn = el.querySelector('[data-discard]');
  const value = (input) => (input.value.trim() === '' ? 0 : Number(input.value));

  // Recalculate totals live; only the edited cell changes, other categories are untouched.
  const recompute = () => {
    const inputs = [...el.querySelectorAll('[data-cell]')];
    const byDay = {};
    const byRow = {};
    let grand = 0;
    for (const inp of inputs) {
      const [item, cat, day] = inp.dataset.cell.split('|');
      const v = Number.isNaN(value(inp)) ? 0 : value(inp);
      byDay[day] = (byDay[day] || 0) + v;
      byRow[`${item}|${cat}`] = (byRow[`${item}|${cat}`] || 0) + v;
      grand += v;
    }
    el.querySelectorAll('[data-daytotal]').forEach((td) => {
      const t = byDay[td.dataset.daytotal] || 0;
      td.textContent = t ? Math.round(t * 100) / 100 : '';
      td.classList.toggle('over', t > d.cap);
    });
    el.querySelectorAll('[data-rowtotal]').forEach((td) => { td.textContent = fmtH(byRow[td.dataset.rowtotal] || 0); });
    const g = el.querySelector('[data-grand]');
    if (g) g.textContent = fmtH(grand);
    el.querySelector('[data-dirtycount]').textContent = dirty.size ? `${dirty.size} unsaved change${dirty.size > 1 ? 's' : ''}` : '';
    saveBtn.disabled = discardBtn.disabled = !dirty.size;
  };

  el.querySelectorAll('[data-cell]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const before = Number(inp.dataset.before);
      const after = value(inp);
      if (!Number.isNaN(after) && after === before) dirty.delete(inp.dataset.cell);
      else dirty.set(inp.dataset.cell, { before, after, label: inp.dataset.label });
      inp.classList.toggle('dirty', dirty.has(inp.dataset.cell));
      recompute();
    });
  });

  discardBtn.onclick = refresh;
  saveBtn.onclick = async () => {
    const changes = [...dirty.entries()].map(([key, c]) => {
      const [item, cat, day] = key.split('|');
      return { work_item_id: Number(item), category_id: Number(cat), work_date: day, ...c };
    }).sort((a, b) => a.work_date.localeCompare(b.work_date));
    const bad = changes.find((c) => Number.isNaN(c.after) || c.after < 0 || c.after > 24);
    if (bad) return toast(`${bad.label} on ${bad.work_date}: enter a number of hours between 0 and 24`, 'error');
    const html = `<p>Please confirm these changes to <b>${esc((activeUsers().find((u) => u.id === d.userId) || {}).display_name || '')}</b>’s timesheet:</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Work item · category</th><th class="num">Before</th><th class="num">After</th></tr></thead><tbody>
      ${changes.map((c) => `<tr><td>${fmtDate(c.work_date)}</td><td>${esc(c.label)}</td><td class="num">${fmtH(c.before)}</td>
        <td class="num"><b>${c.after === 0 ? 'cleared' : fmtH(c.after)}</b></td></tr>`).join('')}</tbody></table></div>`;
    if (!await confirmDialog({ title: 'Save timesheet changes?', html, ok: `Save ${changes.length} change${changes.length > 1 ? 's' : ''}`, wide: true })) return;
    try {
      await api('/api/timesheet', { method: 'PUT', body: { user_id: d.userId, changes: changes.map(({ work_item_id, category_id, work_date, after }) => ({ work_item_id, category_id, work_date, hours: after })) } });
      toast('Timesheet saved');
      refresh();
    } catch (e) {
      toast(e.message, 'error'); // nothing was saved: the batch is all-or-nothing
    }
  };
}
