// Shared UI helpers: escaping, formatting, toasts, modals, confirm dialogs, CSV export.
import { state } from './state.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtH = (n) => `${Math.round((Number(n) || 0) * 100) / 100}h`;

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: state.meta.timezone });
}

export const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

// Run an async action; show its error as a toast. Returns the result or undefined.
export async function attempt(fn, success) {
  try {
    const out = await fn();
    if (success) toast(success);
    return out;
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  }
}

export function openModal({ title, body, footer = '', wide = false, onClose }) {
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2 style="margin:0">${esc(title)}</h2><button class="link" data-close aria-label="Close">✕</button></header>
    <div class="content">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const first = back.querySelector('.content input, .content select, .content textarea');
  (first || back.querySelector('button')).focus();
  return { el: back.querySelector('.modal'), close };
}

export function confirmDialog({ title, html, ok = 'Confirm', danger = false, wide = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title, body: html, wide,
      footer: `<button data-close>Cancel</button><button class="${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; m.close(); resolve(true); });
  });
}

// Read named inputs inside a container into an object (checkboxes → boolean).
export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}

export function downloadCsv(filename, columns, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(c.get ? c.get(r) : r[c.key])).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Export dialog: column picker + its own filter set (seeded from the page, independently adjustable).
export function exportDialog({ title, columns, filtersHtml, fetchRows, filename }) {
  const m = openModal({
    title, wide: true,
    body: `<h3>Filters</h3><div class="form-grid" data-filters>${filtersHtml}</div>
      <h3 style="margin-top:16px">Columns <button class="link small" data-all>select all</button> · <button class="link small" data-none>none</button></h3>
      <div class="colpick">${columns.map((c, i) => `<label class="check"><input type="checkbox" data-col="${i}" ${c.default === false ? '' : 'checked'}> ${esc(c.label)}</label>`).join('')}</div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-go>Download CSV</button>',
  });
  const setAll = (v) => m.el.querySelectorAll('[data-col]').forEach((b) => { b.checked = v; });
  m.el.querySelector('[data-all]').onclick = () => setAll(true);
  m.el.querySelector('[data-none]').onclick = () => setAll(false);
  m.el.querySelector('[data-go]').onclick = async () => {
    const cols = [...m.el.querySelectorAll('[data-col]:checked')].map((b) => columns[Number(b.dataset.col)]);
    if (!cols.length) return toast('Pick at least one column', 'error');
    const rows = await attempt(() => fetchRows(formData(m.el.querySelector('[data-filters]'))));
    if (!rows) return;
    downloadCsv(filename, cols, rows);
    toast(`Exported ${rows.length} rows`);
    m.close();
  };
}

export const options = (list, selected, { value = 'id', label = 'label', blank } = {}) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((o) => `<option value="${esc(o[value])}" ${String(o[value]) === String(selected ?? '') ? 'selected' : ''}>${esc(o[label])}</option>`).join('');

export function statusBadge(code, label) {
  const kind = { done: 'ok', completed: 'ok', in_review: 'accent', in_progress: 'accent', blocked: 'bad', hold: 'warn', cancelled: 'bad', withdrawn: 'bad', queued: '', new: '' }[code] || '';
  return `<span class="badge ${kind}">${esc(label || code)}</span>`;
}

// Small line icons (stroke uses currentColor so they follow text colour).
const ICONS = {
  eye: '<path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.5"/>',
  'eye-off': '<path d="M3 3l14 14M8.5 4.2A8 8 0 0 1 10 4c5.5 0 8.5 6 8.5 6a14 14 0 0 1-2.3 3.1M6 6.1C3 7.8 1.5 10 1.5 10s3 6 8.5 6a8 8 0 0 0 3.6-.8"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>',
  tag: '<path d="M3 3h6l8 8-6 6-8-8z"/><circle cx="6.5" cy="6.5" r="1"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V13H6.5"/>',
  inbox: '<path d="M3 11l2-7h10l2 7v5H3z"/><path d="M3 11h4l1 2h4l1-2h4"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  calendar: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/>',
};
export const icon = (name) => `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// Friendly empty state: icon, title, one line of guidance, optional action HTML.
export const emptyState = (name, title, body = '', action = '') => `<div class="empty-state">
  <div class="empty-icon">${icon(name)}</div><div class="empty-title">${esc(title)}</div>
  ${body ? `<div class="muted small">${esc(body)}</div>` : ''}${action}</div>`;

// Due-date reminder label for open items: overdue / due today / due in N days (within a week).
export function dueInfo(target, today, terminal) {
  if (!target || terminal) return null;
  const days = Math.round((new Date(`${target}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return { kind: 'bad', text: `Overdue ${-days}d`, days };
  if (days === 0) return { kind: 'warn', text: 'Due today', days };
  if (days <= 7) return { kind: 'warn', text: `Due in ${days}d`, days };
  return null;
}
