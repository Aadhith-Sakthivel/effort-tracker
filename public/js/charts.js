// Small dependency-free SVG charts: doughnut, line/area, vertical bars, horizontal bars.
// Colors come from CSS roles (--series-1..8, --viz-*) so light/dark swap in one place.
// Every mark has a hover tooltip; doughnuts always ship a legend (identity is never color-only).
import { esc } from './ui.js';

const SERIES = 8;
const color = (i) => `var(--series-${(i % SERIES) + 1})`;
const nice = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const fmtNum = (v) => (Math.round(v * 10) / 10).toLocaleString();

// Axis ticks on a "nice" step (1, 2, 2.5, 5 × 10^n), whole numbers when the data is whole.
function axis(maxValue, integer) {
  let step = nice(Math.max(maxValue, 1) / 4);
  if (integer) step = Math.max(1, Math.round(step));
  const max = Math.ceil(Math.max(maxValue, step) / step) * step;
  const ticks = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(t);
  return { max, ticks };
}
// Draw at the container's real pixel width so text never scales with the screen.
const widthOf = (el) => Math.max(320, Math.round(el.getBoundingClientRect().width) || 640);

// One shared tooltip element.
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'status');
    document.body.append(tip);
  }
  return tip;
}
function showTip(e, html) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const pad = 12;
  const r = t.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
const hideTip = () => { if (tip) tip.style.display = 'none'; };

function bindTips(root, getHtml) {
  root.addEventListener('mousemove', (e) => {
    const m = e.target.closest('[data-tip]');
    if (m) showTip(e, getHtml(Number(m.dataset.tip))); else hideTip();
  });
  root.addEventListener('mouseleave', hideTip);
}

// Fold anything past 8 slots into "Other" (never generate a 9th hue).
function fold(items) {
  if (items.length <= SERIES) return items;
  const head = items.slice(0, SERIES - 1);
  const rest = items.slice(SERIES - 1).reduce((s, x) => s + x.value, 0);
  return [...head, { label: `Other (${items.length - SERIES + 1})`, value: rest }];
}

/**
 * Doughnut with a centre total and a legend.
 * items: [{ label, value }], opts: { centerLabel, unit, legend: 'side' | 'below', href?: (item) => url }
 */
export function doughnut(el, items, { centerValue, centerLabel = '', unit = '', legend = 'side' } = {}) {
  const data = fold(items.filter((d) => d.value > 0));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) { el.innerHTML = '<div class="viz-empty">No data for this period</div>'; return; }
  const R = 70; const r = 50; const C = 80; const gap = data.length > 1 ? 0.028 : 0; // 2px surface gap between segments
  let a0 = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const s = a0 + gap; const e = a0 + sweep - gap;
    a0 += sweep;
    if (data.length === 1) {
      return `<circle data-tip="${i}" cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${color(i)}" stroke-width="${R - r}"></circle>`;
    }
    const big = e - s > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    return `<path data-tip="${i}" d="M${p(R, s)} A${R},${R} 0 ${big} 1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${big} 0 ${p(r, s)} Z" fill="${color(i)}"></path>`;
  }).join('');
  const center = centerValue ?? fmtNum(total);
  el.innerHTML = `<div class="viz-donut ${legend === 'below' ? 'below' : ''}">
    <svg viewBox="0 0 160 160" role="img" aria-label="${esc(`${centerLabel}: ${data.map((d) => `${d.label} ${fmtNum(d.value)}${unit}`).join(', ')}`)}">
      <g class="arcs">${arcs}</g>
      <text x="${C}" y="${C - 2}" text-anchor="middle" class="viz-center">${esc(center)}</text>
      <text x="${C}" y="${C + 16}" text-anchor="middle" class="viz-center-label">${esc(centerLabel)}</text>
    </svg>
    <ul class="viz-legend">${data.map((d, i) => `<li data-tip="${i}"><span class="sw" style="background:${color(i)}"></span>
      <span class="lbl" title="${esc(d.label)}">${esc(d.label)}</span><span class="val">${fmtNum(d.value)}${unit}</span></li>`).join('')}</ul>
  </div>`;
  bindTips(el, (i) => `<b>${esc(data[i].label)}</b><br>${fmtNum(data[i].value)}${unit} · ${Math.round((data[i].value / total) * 100)}%`);
}

/**
 * Single-series line (optionally filled area). points: [{ label, short, value, shade? }]
 * shade marks background bands (e.g. weekends). One axis only.
 */
export function line(el, points, { unit = '', area = true, height = 200, refValue } = {}) {
  if (!points.length) { el.innerHTML = '<div class="viz-empty">No data</div>'; return; }
  const W = widthOf(el); const H = height; const L = 40; const Rr = 10; const T = 12; const B = 26;
  const { max, ticks } = axis(Math.max(...points.map((p) => p.value), refValue || 0), false);
  const step = points.length > 1 ? (W - L - Rr) / (points.length - 1) : 0;
  const x = (i) => L + i * step;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = Math.ceil(points.length / Math.max(4, Math.floor(W / 56)));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const bw = Math.max(step, 2);
  el.innerHTML = `<svg class="viz-line" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(points.map((p) => `${p.label} ${fmtNum(p.value)}${unit}`).join(', '))}">
    ${points.map((p, i) => (p.shade ? `<rect x="${x(i) - bw / 2}" y="${T}" width="${bw}" height="${H - T - B}" class="viz-band"></rect>` : '')).join('')}
    ${ticks.map((t) => `<line x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}" class="viz-grid"></line>
      <text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="viz-axis">${fmtNum(t)}</text>`).join('')}
    ${refValue ? `<line x1="${L}" x2="${W - Rr}" y1="${y(refValue)}" y2="${y(refValue)}" class="viz-ref"></line>` : ''}
    ${area ? `<path d="${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z" class="viz-area"></path>` : ''}
    <path d="${path}" class="viz-stroke" pathLength="1" vector-effect="non-scaling-stroke"></path>
    ${points.map((p, i) => (i % every === 0 || i === points.length - 1
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="viz-axis">${esc(p.short)}</text>` : '')).join('')}
    <line class="viz-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none" vector-effect="non-scaling-stroke"></line>
    <circle class="viz-dot" r="4" style="display:none"></circle>
    ${points.map((p, i) => `<rect data-tip="${i}" x="${x(i) - Math.max(step, 8) / 2}" y="${T}" width="${Math.max(step, 8)}" height="${H - T - B}" fill="transparent"></rect>`).join('')}
  </svg>`;
  const svg = el.querySelector('svg');
  const cross = svg.querySelector('.viz-cross');
  const dot = svg.querySelector('.viz-dot');
  svg.addEventListener('mousemove', (e) => {
    const m = e.target.closest('[data-tip]');
    if (!m) return;
    const i = Number(m.dataset.tip);
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(points[i].value)); dot.style.display = '';
    showTip(e, `<b>${esc(points[i].label)}</b><br>${fmtNum(points[i].value)}${unit}`);
  });
  svg.addEventListener('mouseleave', () => { cross.style.display = 'none'; dot.style.display = 'none'; hideTip(); });
}

/** Vertical bars, one series. items: [{ label, value }] */
export function columns(el, items, { unit = '', height = 220, integer = false } = {}) {
  if (!items.length) { el.innerHTML = '<div class="viz-empty">No data</div>'; return; }
  const W = widthOf(el); const H = height; const L = 36; const T = 12; const B = 34;
  const { max, ticks } = axis(Math.max(...items.map((d) => d.value)), integer);
  const slot = (W - L - 8) / items.length;
  const bw = Math.min(56, slot * 0.62);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  el.innerHTML = `<svg class="viz-bars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(items.map((d) => `${d.label} ${fmtNum(d.value)}${unit}`).join(', '))}">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - 8}" y1="${y(t)}" y2="${y(t)}" class="viz-grid"></line>
      <text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="viz-axis">${fmtNum(t)}</text>`).join('')}
    ${items.map((d, i) => {
      const cx = L + slot * i + slot / 2;
      const h = Math.max((H - T - B) * (d.value / max), d.value ? 2 : 0);
      const top = H - B - h;
      const rr = Math.min(4, h); // 4px rounded data-end, square at the baseline
      return `<path data-tip="${i}" class="viz-bar" d="M${cx - bw / 2},${H - B} V${top + rr} Q${cx - bw / 2},${top} ${cx - bw / 2 + rr},${top} H${cx + bw / 2 - rr} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + rr} V${H - B} Z"></path>
        <text x="${cx}" y="${H - 14}" text-anchor="middle" class="viz-axis">${esc(d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label)}</text>`;
    }).join('')}
  </svg>`;
  bindTips(el, (i) => `<b>${esc(items[i].label)}</b><br>${fmtNum(items[i].value)}${unit}`);
}

/** Horizontal bars, one series, labels on the left, values on the right. */
export function bars(el, items, { unit = '' } = {}) {
  if (!items.length) { el.innerHTML = '<div class="viz-empty">No data</div>'; return; }
  const max = Math.max(...items.map((d) => d.value), 1);
  el.innerHTML = `<div class="viz-hbars">${items.map((d, i) => `<div class="row" data-tip="${i}">
      <span class="lbl" title="${esc(d.label)}">${esc(d.label)}</span>
      <span class="track"><span class="fill" style="width:${(d.value / max) * 100}%"></span></span>
      <span class="val">${fmtNum(d.value)}${unit}</span></div>`).join('')}</div>`;
  bindTips(el, (i) => `<b>${esc(items[i].label)}</b><br>${fmtNum(items[i].value)}${unit}`);
}
