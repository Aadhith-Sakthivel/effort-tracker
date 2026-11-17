import { api, qs } from '../api.js';
import { esc, fmtH, fmtDate, options, icon, dueInfo } from '../ui.js';
import { state } from '../state.js';
import { doughnut, line, columns, bars } from '../charts.js';

const view = { month: '' };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthName = (m, style = 'long') => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: style, year: 'numeric', timeZone: 'UTC' });

export async function render(el) {
  const d = await api(`/api/overview${qs({ month: view.month })}`);
  view.month = d.month;
  const k = d.kpi;
  const pct = k.approved_hours ? Math.round((k.actual_hours / k.approved_hours) * 100) : 0;
  const snap = d.snapshot;

  el.innerHTML = `
    <div class="page-head"><div><h1>Overview</h1><div class="muted small">Active work items and logged effort</div></div></div>
    <div class="grid kpis">
      <div class="panel kpi"><div class="label">Work items</div><div class="value">${k.active_items}</div><div class="sub">active</div></div>
      <div class="panel kpi"><div class="label">Open</div><div class="value">${k.open_items}</div>
        <div class="sub">${k.overdue ? `<span class="badge bad">${k.overdue} overdue</span>` : 'none overdue'}</div></div>
      <div class="panel kpi"><div class="label">Actual hours</div><div class="value">${fmtH(k.actual_hours)}</div>
        <div class="meter"><div style="width:${Math.min(pct, 100)}%"></div></div><div class="sub">${pct}% of approved</div></div>
      <div class="panel kpi"><div class="label">Approved hours</div><div class="value">${fmtH(k.approved_hours)}</div>
        <div class="sub">${d.support.open} open support task${d.support.open === 1 ? '' : 's'}${d.support.overdue ? ` · <span class="badge bad">${d.support.overdue} late</span>` : ''}</div></div>
    </div>

    <div class="panel section">
      <div class="toolbar toolbar-between"><h2 class="flush">${icon('calendar')} Due soon</h2><a href="#/items?due=week" class="small">See all in Work Items ›</a></div>
      ${d.dueSoon.length ? `<ul class="due-list">${d.dueSoon.map((r) => {
        const due = dueInfo(r.target_date, d.today, false);
        const mine = r.owner_id === state.meta.me.id;
        return `<li><a href="#/items/${r.id}"><span class="muted">${esc(r.reference)}</span> ${esc(r.title)}</a>
          <span class="muted small">${esc(r.owner_name || 'Unassigned')}${mine ? ' · you' : ''}</span>
          <span class="badge ${due ? due.kind : ''}">${due ? esc(due.text) : esc(fmtDate(r.target_date))}</span></li>`;
      }).join('')}</ul>` : `<div class="hint">${icon('check')} Nothing overdue or due in the next 7 days.</div>`}
    </div>

    <div class="panel section">
      <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Monthly snapshot</h2>
        <select data-month aria-label="Month">${options(d.monthOptions.map((m) => ({ id: m, label: monthName(m) })), d.month)}</select></div>
      <div class="grid two">
        <div><h3>Items worked by category <span class="muted small">· ${snap.itemCount} item${snap.itemCount === 1 ? '' : 's'}</span></h3><div data-c="mcat"></div></div>
        <div><h3>Hours by work item <span class="muted small">· ${fmtH(snap.totalHours)}</span></h3><div data-c="mitem"></div></div>
      </div>
      <h3 style="margin-top:18px">Hours per day <span class="muted small">· shaded columns are weekends</span></h3>
      <div data-c="perday"></div>
    </div>

    <div class="grid two" style="margin-top:16px">
      <div class="panel"><h2>Effort by month</h2><div data-c="bymonth"></div></div>
      <div class="panel"><h2>Work items by status</h2><div data-c="status"></div></div>
      <div class="panel"><h2>Work items by category</h2><div data-c="itemcat"></div></div>
      <div class="panel"><h2>Logged hours by category</h2><div data-c="hourcat"></div></div>
      <div class="panel span-all"><h2>Burn: actual vs approved hours</h2>
        ${d.burn.length ? d.burn.map((r) => {
          const ratio = r.approved_hours ? r.actual_hours / r.approved_hours : 0;
          const cls = ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : '';
          return `<div class="bar-row" style="grid-template-columns: minmax(0, 280px) 1fr 110px">
            <a class="name" href="#/items/${r.id}" title="${esc(r.title)}">${esc(r.reference)} · ${esc(r.title)}</a>
            <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.min(ratio, 1) * 100}%"></div></div>
            <span class="num">${fmtH(r.actual_hours)} / ${fmtH(r.approved_hours)}</span></div>`;
        }).join('') : '<div class="viz-empty">No approved hours set yet</div>'}
        <div class="muted small" style="margin-top:6px">Amber: over 85% used · red: over budget</div>
      </div>
    </div>`;

  const c = (k2) => el.querySelector(`[data-c="${k2}"]`);
  doughnut(c('mcat'), snap.itemsByCategory.map((r) => ({ label: r.label, value: r.n })), { centerValue: String(snap.itemCount), centerLabel: 'items' });
  doughnut(c('mitem'), snap.hoursByItem.map((r) => ({ label: `${r.reference} · ${r.title}`, value: r.hours })), { centerValue: `${Math.round(snap.totalHours * 10) / 10}`, centerLabel: 'hours', unit: 'h' });
  line(c('perday'), snap.hoursPerDay.map((p) => {
    const dow = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    return { label: `${WD[dow]} ${Number(p.date.slice(8))} ${monthName(d.month, 'short')}`, short: String(Number(p.date.slice(8))), value: p.hours, shade: dow === 0 || dow === 6 };
  }), { unit: 'h', height: 190 });
  line(c('bymonth'), d.effortByMonth.map((p) => ({ label: monthName(p.month), short: monthName(p.month, 'short').split(' ')[0], value: p.hours })), { unit: 'h' });
  doughnut(c('status'), d.byStatus.map((r) => ({ label: r.label, value: r.n })), { centerLabel: 'work items', legend: 'below' });
  columns(c('itemcat'), d.itemsByCategory.map((r) => ({ label: r.label, value: r.n })), { unit: ' items', integer: true });
  bars(c('hourcat'), d.hoursByCategory.map((r) => ({ label: r.label, value: r.hours })), { unit: 'h' });

  el.querySelector('[data-month]').onchange = (e) => { view.month = e.target.value; render(el); };

  // Charts draw at real pixel width, so redraw when the window size changes.
  clearTimeout(view.resizeTimer);
  window.removeEventListener('resize', view.onResize || (() => {}));
  view.onResize = () => {
    clearTimeout(view.resizeTimer);
    view.resizeTimer = setTimeout(() => { if (el.isConnected && location.hash.startsWith('#/overview')) render(el); }, 200);
  };
  window.addEventListener('resize', view.onResize);
}
