// Router + shell: top nav, "signed in as", and view mounting.
import { devUser, setDevUser } from './api.js';
import { state, loadMeta, can } from './state.js';
import { esc, toast } from './ui.js';

const routes = {
  overview: () => import('./views/overview.js'),
  items: () => import('./views/items.js'),
  item: () => import('./views/item-detail.js'),
  board: () => import('./views/board.js'),
  timesheet: () => import('./views/timesheet.js'),
  support: () => import('./views/support.js'),
  team: () => import('./views/team.js'),
  audit: () => import('./views/audit.js'),
  settings: () => import('./views/settings.js'),
};

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  let name = parts[0] || 'overview';
  const params = Object.fromEntries(new URLSearchParams(query));
  if (name === 'items' && parts[1]) { name = 'item'; params.id = parts[1]; }
  if (name === 'support' && parts[1]) params.id = parts[1];
  return { name: routes[name] ? name : 'overview', params };
}

function renderWhoami() {
  const m = state.meta;
  const el = document.getElementById('whoami');
  const role = `<span class="badge ${m.me.role === 'lead' ? 'accent' : m.me.role === 'member' ? 'ok' : ''}">${esc(m.me.role)}</span>`;
  if (m.devLogin) {
    el.innerHTML = `<div class="who-row"><span class="muted small">Sign in as (local demo)</span>${role}</div>
      <select id="devUser" aria-label="Sign in as"><option value="">Anonymous (viewer)</option>
      ${m.users.filter((u) => u.is_active).map((u) => `<option value="${esc(u.login_id)}" ${u.login_id === m.me.login_id ? 'selected' : ''}>${esc(u.display_name)} · ${esc(u.role)}</option>`).join('')}
      </select>`;
    el.querySelector('#devUser').onchange = async (e) => {
      setDevUser(e.target.value);
      await boot();
      toast(`Signed in as ${state.meta.me.display_name}`);
    };
  } else {
    el.innerHTML = `<div class="who-row"><span class="stack"><b>${esc(m.me.display_name)}</b><span class="muted small">${esc(m.me.login_id)}</span></span>${role}</div>`;
  }
  document.querySelectorAll('[data-lead-only]').forEach((a) => { a.hidden = !can('lead'); });
  // Reminder badge: my open items that are overdue or due within 7 days.
  const itemsLink = document.querySelector('#nav a[data-route="items"]');
  itemsLink.querySelector('.nav-badge')?.remove();
  if (m.myDueSoon) {
    itemsLink.insertAdjacentHTML('beforeend', `<span class="nav-badge" title="${m.myDueSoon} of your items are overdue or due within 7 days">${m.myDueSoon}</span>`);
  }
}

let renderSeq = 0;
let lastRoute = '';
export async function render() {
  const { name, params } = parseHash();
  const seq = ++renderSeq;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (name === 'item' ? 'items' : name)));
  const view = document.getElementById('view');
  try {
    const mod = await routes[name]();
    if (seq !== renderSeq) return;
    view.innerHTML = `<div class="skeleton" aria-busy="true" aria-label="Loading"><div class="bone title"></div>
      <div class="grid kpis"><div class="bone block"></div><div class="bone block"></div><div class="bone block"></div></div><div class="bone block"></div></div>`;
    view.setAttribute('aria-busy', 'true');
    const routeKey = `${name}|${params.id || ''}`;
    const entering = routeKey !== lastRoute;
    lastRoute = routeKey;
    await mod.render(view, params);
    if (entering) {
      view.classList.remove('view-enter');
      void view.offsetWidth; // restart the animation
      view.classList.add('view-enter');
      clearTimeout(render.enterTimer);
      render.enterTimer = setTimeout(() => view.classList.remove('view-enter'), 900);
    }
  } catch (e) {
    if (seq !== renderSeq) return;
    view.innerHTML = `<div class="panel empty">Couldn't load this page: ${esc(e.message)} <button data-retry>Try again</button></div>`;
    view.querySelector('[data-retry]').onclick = render;
  } finally {
    if (seq === renderSeq) view.removeAttribute('aria-busy');
  }
}

export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

async function boot() {
  try {
    await loadMeta();
  } catch (e) {
    document.getElementById('view').innerHTML = `<div class="panel empty">Couldn't reach the server: ${esc(e.message)}</div>`;
    return;
  }
  // First visit locally: default to the first lead so the demo is fully usable.
  if (state.meta.devLogin && !devUser()) {
    const lead = state.meta.users.find((u) => u.role === 'lead' && u.is_active);
    if (lead) { setDevUser(lead.login_id); await loadMeta(); }
  }
  renderWhoami();
  await render();
}

// After navigating, move focus to the page so keyboard and screen-reader users land on the new content.
window.addEventListener('hashchange', () => render().then(() => document.getElementById('view').focus({ preventScroll: true })));

// Clickable rows/cards/list items (data-href) open with Enter or Space, like links.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-href]')) {
    e.preventDefault();
    go(e.target.dataset.href);
  }
});
boot();
