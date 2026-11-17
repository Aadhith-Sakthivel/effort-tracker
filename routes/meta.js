// App metadata, settings and lookups (statuses, categories).
const express = require('express');
const db = require('../db');
const { wrap, HttpError, intOrNull, required, uniqueGuard } = require('../lib/http');
const { requireRole, DEV_LOGIN } = require('../lib/auth');
const { audit, diff, snapshot } = require('../lib/audit');
const { TZ, nowInTz } = require('../lib/time');

const router = express.Router();

async function getSettings() {
  const rows = await db.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

router.get('/meta', wrap(async (req, res) => {
  const today = nowInTz().date;
  const [[due], statuses, subStatuses, categories, users, settings] = await Promise.all([
    // Sidebar badge: my open items overdue or due within 7 days.
    db.query(`SELECT count(*)::int AS n FROM work_items w JOIN statuses s ON s.code = w.status_code
              WHERE w.owner_id = $1 AND w.is_active AND NOT s.is_inactive AND NOT s.is_terminal AND w.target_date <= $2::date + 7`,
    [req.user.id || 0, today]),
    db.query('SELECT * FROM statuses ORDER BY sort_order, code'),
    db.query('SELECT * FROM sub_statuses ORDER BY sort_order, code'),
    db.query('SELECT id, code, label, sort_order, is_active FROM categories WHERE owner_work_item_id IS NULL ORDER BY sort_order, label'),
    db.query('SELECT id, display_name, login_id, role, is_active FROM users ORDER BY display_name'),
    getSettings(),
  ]);
  res.json({
    me: req.user,
    devLogin: DEV_LOGIN && !req.platformIdentity,
    backend: db.name,
    timezone: TZ,
    today,
    myDueSoon: due.n,
    statuses, subStatuses, categories, users, settings,
  });
}));

router.put('/settings', requireRole('lead'), wrap(async (req, res) => {
  const allowed = {
    daily_hour_cap: (v) => Number(v) > 0 && Number(v) <= 24,
    freeze_weekday: (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 7,
    freeze_hour: (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23,
  };
  const before = await getSettings();
  await db.tx(async (q) => {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed[key]) continue;
      if (!allowed[key](value)) throw new HttpError(400, `Invalid value for ${key}`);
      await q('UPDATE settings SET value = $1 WHERE key = $2', [String(value), key]);
    }
    await audit(q, req.user, 'settings', 'app', 'update', diff(before, req.body, Object.keys(allowed)));
  });
  res.json(await getSettings());
}));

// Global categories (leads).
router.post('/categories', requireRole('lead'), wrap(async (req, res) => {
  const label = required(req.body.label, 'Label');
  const code = (req.body.code || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const row = await db.tx(async (q) => {
    const [c] = await q(
      `INSERT INTO categories(code, label, sort_order) VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(max(sort_order), 0) + 10 FROM categories))) RETURNING *`,
      [code, label, intOrNull(req.body.sort_order)],
    ).catch(uniqueGuard(`A category with code "${code}" already exists`));
    await audit(q, req.user, 'category', c.id, 'create', snapshot(c, ['code', 'label']));
    return c;
  });
  res.status(201).json(row);
}));

router.patch('/categories/:id', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const row = await db.tx(async (q) => {
    const [before] = await q('SELECT * FROM categories WHERE id = $1', [id]);
    if (!before) throw new HttpError(404, 'Category not found');
    const next = {
      label: req.body.label !== undefined ? required(req.body.label, 'Label') : before.label,
      sort_order: req.body.sort_order !== undefined ? intOrNull(req.body.sort_order) : before.sort_order,
      is_active: req.body.is_active !== undefined ? Boolean(req.body.is_active) : before.is_active,
    };
    const [after] = await q('UPDATE categories SET label = $1, sort_order = $2, is_active = $3 WHERE id = $4 RETURNING *',
      [next.label, next.sort_order, next.is_active, id]);
    await audit(q, req.user, 'category', id, 'update', diff(before, after, ['label', 'sort_order', 'is_active']));
    return after;
  });
  res.json(row);
}));

// Work-item statuses are configurable (leads).
router.post('/statuses', requireRole('lead'), wrap(async (req, res) => {
  const label = required(req.body.label, 'Label');
  const code = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const row = await db.tx(async (q) => {
    const [s] = await q(
      `INSERT INTO statuses(code, label, sort_order, is_terminal, is_inactive)
       VALUES ($1, $2, (SELECT COALESCE(max(sort_order), 0) + 10 FROM statuses), $3, $4) RETURNING *`,
      [code, label, Boolean(req.body.is_terminal), Boolean(req.body.is_inactive)],
    ).catch(uniqueGuard(`Status "${label}" already exists`));
    await audit(q, req.user, 'status', code, 'create', snapshot(s, ['label', 'is_terminal', 'is_inactive']));
    return s;
  });
  res.status(201).json(row);
}));

router.patch('/statuses/:code', requireRole('lead'), wrap(async (req, res) => {
  const row = await db.tx(async (q) => {
    const [before] = await q('SELECT * FROM statuses WHERE code = $1', [req.params.code]);
    if (!before) throw new HttpError(404, 'Status not found');
    const pick = (k, conv) => (req.body[k] !== undefined ? conv(req.body[k]) : before[k]);
    const [after] = await q(
      'UPDATE statuses SET label = $1, sort_order = $2, is_terminal = $3, is_inactive = $4 WHERE code = $5 RETURNING *',
      [pick('label', (v) => required(v, 'Label')), pick('sort_order', intOrNull), pick('is_terminal', Boolean), pick('is_inactive', Boolean), before.code],
    );
    await audit(q, req.user, 'status', before.code, 'update', diff(before, after, ['label', 'sort_order', 'is_terminal', 'is_inactive']));
    return after;
  });
  res.json(row);
}));

// Sub-statuses (per-category states) are configurable too (leads).
router.post('/sub-statuses', requireRole('lead'), wrap(async (req, res) => {
  const label = required(req.body.label, 'Label');
  const code = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const row = await db.tx(async (q) => {
    const [s] = await q(
      `INSERT INTO sub_statuses(code, label, sort_order, is_terminal, is_inactive)
       VALUES ($1, $2, (SELECT COALESCE(max(sort_order), 0) + 10 FROM sub_statuses), $3, $4) RETURNING *`,
      [code, label, Boolean(req.body.is_terminal), Boolean(req.body.is_inactive)],
    ).catch(uniqueGuard(`Sub-status "${label}" already exists`));
    await audit(q, req.user, 'sub_status', code, 'create', snapshot(s, ['label', 'is_terminal', 'is_inactive']));
    return s;
  });
  res.status(201).json(row);
}));

router.patch('/sub-statuses/:code', requireRole('lead'), wrap(async (req, res) => {
  const row = await db.tx(async (q) => {
    const [before] = await q('SELECT * FROM sub_statuses WHERE code = $1', [req.params.code]);
    if (!before) throw new HttpError(404, 'Sub-status not found');
    const pick = (k, conv) => (req.body[k] !== undefined ? conv(req.body[k]) : before[k]);
    const [after] = await q(
      'UPDATE sub_statuses SET label = $1, sort_order = $2, is_terminal = $3, is_inactive = $4 WHERE code = $5 RETURNING *',
      [pick('label', (v) => required(v, 'Label')), pick('sort_order', intOrNull), pick('is_terminal', Boolean), pick('is_inactive', Boolean), before.code],
    );
    await audit(q, req.user, 'sub_status', before.code, 'update', diff(before, after, ['label', 'sort_order', 'is_terminal', 'is_inactive']));
    return after;
  });
  res.json(row);
}));

module.exports = { router, getSettings };
