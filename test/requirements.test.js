// Requirement checks against SPEC.md. Starts the app on a spare port with a throwaway database
// seeded with the demo data, then exercises each rule through the REST API (the same path the UI uses).
// Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 8000 + Math.floor(Math.random() * 900) + 50;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'effort-test-'));
let server;

const LEAD = 'asha@example.com';
const MEMBER = 'ben@example.com';
const VIEWER = 'eli@example.com';

async function call(method, url, who, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'x-user': who || '', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SEED_DEMO: 'true', DEV_LOGIN: 'true', PGHOST: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(() => {
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('roles resolve from the identity header (lead, member, viewer, unknown)', async () => {
  assert.equal((await call('GET', '/api/meta', LEAD)).data.me.role, 'lead');
  assert.equal((await call('GET', '/api/meta', MEMBER)).data.me.role, 'member');
  assert.equal((await call('GET', '/api/meta', VIEWER)).data.me.role, 'viewer');
  assert.equal((await call('GET', '/api/meta', 'stranger@example.com')).data.me.role, 'viewer');
});

test('viewers are read-only on the server, not just in the UI', async () => {
  assert.equal((await call('POST', '/api/work-items/1/status', VIEWER, { status_code: 'done' })).status, 403);
  assert.equal((await call('POST', '/api/work-items/1/comments', VIEWER, { body: 'x' })).status, 403);
  assert.equal((await call('POST', '/api/support', VIEWER, { description: 'x' })).status, 403);
  assert.equal((await call('PUT', '/api/timesheet', VIEWER, { changes: [{}] })).status, 403);
});

test('members change statuses but cannot edit work items, people or settings', async () => {
  assert.equal((await call('POST', '/api/work-items/1/status', MEMBER, { status_code: 'in_review' })).status, 200);
  assert.equal((await call('PATCH', '/api/work-items/1', MEMBER, { title: 'x' })).status, 403);
  assert.equal((await call('POST', '/api/team', MEMBER, { display_name: 'x', login_id: 'x@x' })).status, 403);
  assert.equal((await call('PUT', '/api/settings', MEMBER, { daily_hour_cap: 12 })).status, 403);
});

test('work items: create requires fields, references are unique, list filters work', async () => {
  assert.equal((await call('POST', '/api/work-items', LEAD, { title: '', category_ids: [1] })).status, 400);
  assert.equal((await call('POST', '/api/work-items', LEAD, { title: 'No cats', category_ids: [] })).status, 400);
  const created = await call('POST', '/api/work-items', LEAD, { title: 'Test item', category_ids: [1, 2], approved_hours: 10 });
  assert.equal(created.status, 201);
  assert.match(created.data.reference, /^WI-\d{4}$/);
  assert.equal((await call('POST', '/api/work-items', LEAD, { reference: created.data.reference.toLowerCase(), title: 'Dup', category_ids: [1] })).status, 409);
  const byCat = await call('GET', '/api/work-items?category=2&active=all', LEAD);
  assert.ok(byCat.data.every((w) => w.categories.some((c) => c.id === 2)));
  const inactive = await call('GET', '/api/work-items?active=inactive', LEAD);
  assert.ok(inactive.data.every((w) => !w.is_active || w.is_inactive));
});

test('detail: per-category sub-status, card-level vs per-tab comments, custom categories', async () => {
  const { data: item } = await call('POST', '/api/work-items', LEAD, { title: 'Tabs item', category_ids: [1, 2] });
  assert.equal((await call('PUT', `/api/work-items/${item.id}/categories/1/state`, MEMBER, { sub_status_code: 'blocked' })).status, 200);
  await call('POST', `/api/work-items/${item.id}/comments`, MEMBER, { body: 'all tabs', category_id: null });
  await call('POST', `/api/work-items/${item.id}/comments`, MEMBER, { body: 'tab 2 only', category_id: 2 });
  const custom = await call('POST', `/api/work-items/${item.id}/categories`, LEAD, { label: 'Vendor sign-off' });
  assert.equal(custom.status, 201);
  const { data: d } = await call('GET', `/api/work-items/${item.id}`, VIEWER);
  assert.equal(d.groups.find((g) => g.id === 1).sub_status_code, 'blocked');
  assert.equal(d.groups.find((g) => g.id === 2).sub_status_code, 'not_started'); // independent
  assert.equal(d.status_code, 'new'); // overall status untouched
  assert.ok(d.groups.some((g) => g.label === 'Vendor sign-off' && g.is_custom));
  assert.equal(d.comments.find((c) => c.body === 'all tabs').category_id, null);
  assert.equal(d.comments.find((c) => c.body === 'tab 2 only').category_id, 2);
});

test('timesheet: frozen weeks, daily cap, per-category cells, inactive items', async () => {
  const meta = (await call('GET', '/api/meta', MEMBER)).data;
  const ts = (await call('GET', `/api/timesheet?user=${meta.me.id}`, MEMBER)).data;
  const row = ts.rows[0];
  const [c1, c2] = row.categories;
  const frozen = Object.keys(ts.frozen).find((d) => ts.frozen[d]);
  if (frozen) {
    const r = await call('PUT', '/api/timesheet', MEMBER, { changes: [{ work_item_id: row.id, category_id: c1.id, work_date: frozen, hours: 1 }] });
    assert.equal(r.status, 409);
  }
  const today = ts.today;
  const over = await call('PUT', '/api/timesheet', MEMBER, { changes: [{ work_item_id: row.id, category_id: c1.id, work_date: today, hours: ts.cap + 1 }] });
  assert.equal(over.status, 409);
  assert.equal((await call('PUT', '/api/timesheet', MEMBER, { changes: [{ work_item_id: row.id, category_id: c1.id, work_date: today, hours: 2 }] })).status, 200);
  if (c2) {
    await call('PUT', '/api/timesheet', MEMBER, { changes: [{ work_item_id: row.id, category_id: c2.id, work_date: today, hours: 1 }] });
    const again = (await call('GET', `/api/timesheet?user=${meta.me.id}`, MEMBER)).data.rows.find((r) => r.id === row.id);
    assert.equal(again.categories.find((c) => c.id === c1.id).hours[today], 2); // other category untouched
  }
  assert.equal((await call('PUT', '/api/timesheet', MEMBER, { user_id: 1, changes: [{ work_item_id: row.id, category_id: c1.id, work_date: today, hours: 1 }] })).status, 403);
  // Inactive (withdrawn) items take no new time.
  const items = (await call('GET', '/api/work-items?active=inactive', LEAD)).data;
  const withdrawn = items[0];
  const r = await call('PUT', '/api/timesheet', LEAD, { changes: [{ work_item_id: withdrawn.id, category_id: withdrawn.categories[0].id, work_date: today, hours: 1 }] });
  assert.equal(r.status, 409);
});

test('support tasks: activity feed, closing blocked until Done/Cancelled', async () => {
  const { data: t } = await call('POST', '/api/support', MEMBER, { description: 'Broken extract' });
  assert.match(t.reference, /^SUP-\d{4}$/);
  assert.equal((await call('POST', `/api/support/${t.id}/close`, MEMBER)).status, 409);
  await call('POST', `/api/support/${t.id}/status`, MEMBER, { status: 'in_progress' });
  await call('POST', `/api/support/${t.id}/comments`, MEMBER, { body: 'Investigating' });
  await call('POST', `/api/support/${t.id}/status`, MEMBER, { status: 'done' });
  assert.equal((await call('POST', `/api/support/${t.id}/close`, MEMBER)).status, 200);
  const { data: d } = await call('GET', `/api/support/${t.id}`, VIEWER);
  assert.equal(d.is_active, false);
  assert.deepEqual(d.activity.map((a) => a.kind), ['state', 'status', 'comment', 'status', 'state']);
});

test('team: contact details never reach viewers', async () => {
  const asViewer = (await call('GET', '/api/team', VIEWER)).data;
  assert.equal(asViewer.contactVisible, false);
  assert.ok(asViewer.rows.every((u) => u.email === null && u.phone === null));
  const asMember = (await call('GET', '/api/team', MEMBER)).data;
  assert.ok(asMember.rows.some((u) => u.phone));
});

test('audit: changes record field, old → new, actor', async () => {
  await call('PATCH', '/api/work-items/2', LEAD, { title: 'Renamed for audit' });
  const { data } = await call('GET', '/api/audit?entity=work_item', VIEWER);
  const e = data.rows.find((r) => r.field === 'title' && r.new_value === 'Renamed for audit');
  assert.ok(e, 'audit row written');
  assert.equal(e.actor, LEAD);
  assert.ok(e.old_value);
});

test('overview: KPIs and chart series are returned', async () => {
  const { data } = await call('GET', '/api/overview', VIEWER);
  for (const k of ['open_items', 'approved_hours', 'actual_hours']) assert.equal(typeof data.kpi[k], 'number');
  assert.equal(data.effortByMonth.length, 12);
  assert.ok(data.snapshot.hoursPerDay.length >= 28);
  assert.ok(data.byStatus.length >= 4);
});

test('richer work items: links, watchers, activity, bulk edit, due filter', async () => {
  const { data: item } = await call('POST', '/api/work-items', LEAD, { title: 'Rich item', category_ids: [1], target_date: (await call('GET', '/api/meta', LEAD)).data.today });
  assert.equal((await call('POST', `/api/work-items/${item.id}/links`, MEMBER, { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call('POST', `/api/work-items/${item.id}/links`, MEMBER, { url: 'https://example.com/spec', title: 'Spec' })).status, 201);
  assert.equal((await call('POST', `/api/work-items/${item.id}/links`, VIEWER, { url: 'https://example.com/x' })).status, 403);
  assert.equal((await call('POST', `/api/work-items/${item.id}/watch`, VIEWER, { watching: true })).status, 200); // viewers may follow
  const detail = (await call('GET', `/api/work-items/${item.id}`, VIEWER)).data;
  assert.equal(detail.links[0].title, 'Spec');
  assert.ok(detail.is_watching);
  assert.ok(detail.activity.some((a) => a.entity_type === 'link' && a.action === 'create'));
  const watching = (await call('GET', '/api/work-items?watching=1', VIEWER)).data;
  assert.ok(watching.some((w) => w.id === item.id));
  const dueWeek = (await call('GET', '/api/work-items?due=week', LEAD)).data;
  assert.ok(dueWeek.some((w) => w.id === item.id));
  assert.equal((await call('POST', '/api/work-items/bulk', MEMBER, { ids: [item.id], status_code: 'in_progress' })).status, 403);
  const bulk = await call('POST', '/api/work-items/bulk', LEAD, { ids: [item.id, 1], status_code: 'in_progress' });
  assert.equal(bulk.status, 200);
  assert.ok(bulk.data.updated >= 1);
  assert.equal((await call('GET', `/api/work-items/${item.id}`, LEAD)).data.status_code, 'in_progress');
});

test('security headers and health check', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(`${BASE}/healthz`)).status, 200);
});
