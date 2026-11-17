import { api, qs } from '../api.js';
import { state, can, activeUsers } from '../state.js';
import { esc, fmtH, fmtDate, options, toast } from '../ui.js';
import { go } from '../app.js';

const filters = { owner: '', category: '', showInactive: false };

export async function render(el) {
  const draggable = can('member');
  el.innerHTML = `
    <div class="page-head"><h1>Board</h1>
      <div class="toolbar" style="margin:0">
        <select data-f="owner" aria-label="Owner">${options(activeUsers(), filters.owner, { label: 'display_name', blank: 'Everyone' })}</select>
        <select data-f="category" aria-label="Category">${options(state.meta.categories, filters.category, { blank: 'All categories' })}</select>
        <label class="check"><input type="checkbox" data-f="showInactive" ${filters.showInactive ? 'checked' : ''}> Show cancelled/withdrawn</label>
      </div></div>
    ${draggable ? '' : '<div class="notice">You have read-only access, so cards can’t be moved.</div>'}
    <div class="board" data-board></div>`;

  const load = async () => {
    const rows = await api(`/api/work-items${qs({ owner: filters.owner, category: filters.category, active: filters.showInactive ? 'all' : 'active' })}`);
    const cols = state.meta.statuses.filter((s) => filters.showInactive || !s.is_inactive);
    el.querySelector('[data-board]').innerHTML = cols.map((s) => {
      const cards = rows.filter((r) => r.status_code === s.code);
      return `<section class="column" data-status="${esc(s.code)}" aria-label="${esc(s.label)}">
        <h3>${esc(s.label)} <span class="badge">${cards.length}</span></h3>
        ${cards.map((r) => {
          const late = r.target_date && r.target_date < state.meta.today && !r.is_terminal;
          const over = r.approved_hours && r.actual_hours > r.approved_hours;
          return `<article class="card" data-id="${r.id}" data-href="#/items/${r.id}" tabindex="0" draggable="${draggable}" aria-label="${esc(`${r.reference} ${r.title}, ${s.label}`)}">
            <div class="ref">${esc(r.reference)}</div><div class="title">${esc(r.title)}</div>
            <div class="meta"><span>${esc(r.owner_name || 'Unassigned')}</span>
              <span class="${over ? 'badge bad' : ''}">${fmtH(r.actual_hours)}${r.approved_hours != null ? ` / ${fmtH(r.approved_hours)}` : ''}</span></div>
            <div class="meta" style="margin-top:4px"><span class="${late ? 'badge bad' : ''}">${r.target_date ? `Due ${fmtDate(r.target_date)}` : ''}</span>
              <span>${r.comment_count ? `💬 ${r.comment_count}` : ''}</span></div></article>`;
        }).join('') || '<div class="column-empty">No items</div>'}</section>`;
    }).join('');
  };

  el.querySelectorAll('[data-f]').forEach((c) => {
    c.onchange = () => { filters[c.dataset.f] = c.type === 'checkbox' ? c.checked : c.value; load(); };
  });

  const board = el.querySelector('[data-board]');
  board.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) go(`#/items/${card.dataset.id}`);
  });
  if (draggable) {
    let dragId = null;
    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    board.addEventListener('dragend', (e) => { e.target.classList && e.target.classList.remove('dragging'); });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('.column');
      if (!col) return;
      e.preventDefault();
      board.querySelectorAll('.column.drop').forEach((c) => c !== col && c.classList.remove('drop'));
      col.classList.add('drop');
    });
    board.addEventListener('dragleave', (e) => {
      const col = e.target.closest('.column');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
    });
    board.addEventListener('drop', async (e) => {
      const col = e.target.closest('.column');
      if (!col || !dragId) return;
      e.preventDefault();
      col.classList.remove('drop');
      const label = state.meta.statuses.find((s) => s.code === col.dataset.status).label;
      try {
        await api(`/api/work-items/${dragId}/status`, { method: 'POST', body: { status_code: col.dataset.status } });
        toast(`Moved to ${label}`);
      } catch (err) {
        toast(err.message, 'error');
      }
      dragId = null;
      load();
    });
  }
  await load();
}
