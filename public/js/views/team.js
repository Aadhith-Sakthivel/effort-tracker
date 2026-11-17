import { api, qs } from '../api.js';
import { can, loadMeta } from '../state.js';
import { esc, initials, options, exportDialog, openModal, formData, attempt, confirmDialog, statusBadge, emptyState } from '../ui.js';
import { state } from '../state.js';

const filters = { q: '', location: '', role: '', active: 'active' };
const ROLES = [{ id: 'lead', label: 'Lead' }, { id: 'member', label: 'Member' }, { id: 'viewer', label: 'Viewer' }];
const ACTIVE = [{ id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }, { id: 'all', label: 'All' }];

const filterControls = (f, locations) => `
  <label class="field">Search<input name="q" value="${esc(f.q)}" placeholder="Name, login, skills…"></label>
  <label class="field">Location<select name="location">${options(locations.map((l) => ({ id: l, label: l })), f.location, { blank: 'All locations' })}</select></label>
  <label class="field">Role<select name="role">${options(ROLES, f.role, { blank: 'All roles' })}</select></label>
  <label class="field">Show<select name="active">${options(ACTIVE, f.active)}</select></label>`;

export async function render(el) {
  const lead = can('lead');
  const data = await api(`/api/team${qs(filters)}`);
  const COLUMNS = [
    { key: 'display_name', label: 'Name' }, { key: 'login_id', label: 'Login' }, { key: 'role', label: 'Role' },
    { key: 'location', label: 'Location' }, { key: 'skills', label: 'Skills' }, { key: 'open_items', label: 'Open items' },
    { label: 'Active', get: (u) => (u.is_active ? 'Yes' : 'No') },
    ...(data.contactVisible ? [{ key: 'email', label: 'Email', default: false }, { key: 'phone', label: 'Phone', default: false }] : []),
  ];

  el.innerHTML = `
    <div class="page-head"><h1>Team</h1>
      <div class="toolbar" style="margin:0"><button data-export>Export CSV</button>${lead ? '<button class="primary" data-new>Add member</button>' : ''}</div></div>
    <div class="panel" style="margin-bottom:14px"><div class="form-grid" data-filters>${filterControls(filters, data.locations)}</div></div>
    ${data.rows.length ? `<div class="cards">${data.rows.map((u) => `
      <div class="panel member ${u.is_active ? '' : 'inactive'}">
        <div class="top"><div class="who"><div class="avatar">${esc(initials(u.display_name))}</div>
          <div><b title="${esc(u.display_name)}">${esc(u.display_name)}</b><span class="muted small" title="${esc(u.login_id)}">${esc(u.login_id)}</span></div></div>
          ${statusBadge(u.role === 'lead' ? 'in_review' : u.role === 'member' ? 'done' : 'new', u.role)}</div>
        <div class="muted small">${esc(u.location || 'No location')}${u.is_active ? '' : ' · <b>inactive</b>'}</div>
        ${u.skills ? `<div class="small">${esc(u.skills)}</div>` : ''}
        <div class="small">${u.open_items} open work item${u.open_items === 1 ? '' : 's'}</div>
        ${data.contactVisible ? `<div data-contact="${u.id}" class="small">${(u.email || u.phone) ? `<button class="link" data-reveal="${u.id}">Show contact</button>` : '<span class="muted">No contact details</span>'}</div>` : ''}
        ${lead ? `<div class="actions"><button data-edit="${u.id}">Edit</button>
          <button data-toggle="${u.id}" class="${u.is_active ? 'danger' : ''}">${u.is_active ? 'Deactivate' : 'Activate'}</button></div>` : ''}
      </div>`).join('')}</div>` : `<div class="panel">${emptyState('search', 'No team members match', 'Try a different search or filter.')}</div>`}`;

  const refresh = () => render(el);
  let t;
  el.querySelector('[data-filters]').addEventListener('input', (e) => {
    Object.assign(filters, formData(el.querySelector('[data-filters]')));
    clearTimeout(t);
    t = setTimeout(refresh, e.target.name === 'q' ? 250 : 0);
  });

  // Reveal-to-call: contact details only render after an explicit click.
  el.querySelectorAll('[data-reveal]').forEach((b) => {
    b.onclick = () => {
      const u = data.rows.find((r) => r.id === Number(b.dataset.reveal));
      b.parentElement.innerHTML = `${u.email ? `<div>✉ <a href="mailto:${esc(u.email)}">${esc(u.email)}</a></div>` : ''}
        ${u.phone ? `<div>☎ <a href="tel:${esc(u.phone.replace(/\s+/g, ''))}">${esc(u.phone)}</a> · <a href="tel:${esc(u.phone.replace(/\s+/g, ''))}">Call</a></div>` : ''}`;
    };
  });

  el.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = async () => {
      const u = data.rows.find((r) => r.id === Number(b.dataset.toggle));
      const activate = !u.is_active;
      const ok = await confirmDialog({
        title: `${activate ? 'Activate' : 'Deactivate'} ${u.display_name}?`,
        html: activate ? `<p>${esc(u.display_name)} will be able to sign in with their <b>${esc(u.role)}</b> role again.</p>`
          : `<p>${esc(u.display_name)} will lose access and drop out of pickers. Their history and logged time are kept.</p>`,
        ok: activate ? 'Activate' : 'Deactivate', danger: !activate,
      });
      if (!ok) return;
      if (await attempt(() => api(`/api/team/${u.id}/active`, { method: 'POST', body: { is_active: activate } }), activate ? 'Activated' : 'Deactivated')) {
        await loadMeta();
        refresh();
      }
    };
  });
  el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => memberForm(data.rows.find((r) => r.id === Number(b.dataset.edit)), refresh); });
  const nb = el.querySelector('[data-new]');
  if (nb) nb.onclick = () => memberForm(null, refresh);

  el.querySelector('[data-export]').onclick = () => exportDialog({
    title: 'Export team', columns: COLUMNS, filename: `team-${state.meta.today}.csv`,
    filtersHtml: filterControls(filters, data.locations),
    fetchRows: (f) => api(`/api/team${qs(f)}`).then((r) => r.rows),
  });
}

function memberForm(u, done) {
  const x = u || { role: 'member' };
  const m = openModal({
    title: u ? `Edit ${u.display_name}` : 'Add team member', wide: true,
    body: `<div class="form-grid">
      <label class="field">Name<input name="display_name" value="${esc(x.display_name || '')}"></label>
      <label class="field">Login (workspace email)<input name="login_id" value="${esc(x.login_id || '')}"></label>
      <label class="field">Role<select name="role">${options(ROLES, x.role)}</select></label>
      <label class="field">Location<input name="location" value="${esc(x.location || '')}"></label>
      <label class="field">Email<input type="email" name="email" value="${esc(x.email || '')}"></label>
      <label class="field">Phone<input name="phone" value="${esc(x.phone || '')}"></label>
      <label class="field full">Skills<input name="skills" value="${esc(x.skills || '')}" placeholder="Comma separated"></label></div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-ok>Save</button>',
  });
  m.el.querySelector('[data-ok]').onclick = async () => {
    const body = formData(m.el.querySelector('.content'));
    const ok = await attempt(() => api(u ? `/api/team/${u.id}` : '/api/team', { method: u ? 'PATCH' : 'POST', body }), u ? 'Saved' : 'Member added');
    if (ok) { m.close(); await loadMeta(); done(); }
  };
}
