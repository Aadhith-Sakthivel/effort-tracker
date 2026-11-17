// Team: member records, roles, activate/deactivate. Contact details only go to team roles, never viewers.
const express = require('express');
const db = require('../db');
const { wrap, HttpError, intOrNull, required, uniqueGuard } = require('../lib/http');
const { requireRole, can } = require('../lib/auth');
const { audit, diff, snapshot } = require('../lib/audit');

const router = express.Router();
const FIELDS = ['display_name', 'login_id', 'role', 'location', 'email', 'phone', 'skills'];
const ROLES = ['lead', 'member', 'viewer'];

const strip = (u, viewer) => (viewer ? { ...u, email: null, phone: null, contact_hidden: true } : u);

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(u.display_name ILIKE $${params.length} OR u.login_id ILIKE $${params.length} OR u.skills ILIKE $${params.length})`); }
  if (req.query.location) { params.push(req.query.location); where.push(`u.location = $${params.length}`); }
  if (req.query.role) { params.push(req.query.role); where.push(`u.role = $${params.length}`); }
  const active = req.query.active || 'active';
  if (active === 'active') where.push('u.is_active');
  if (active === 'inactive') where.push('NOT u.is_active');
  const rows = await db.query(
    `SELECT u.id, u.display_name, u.login_id, u.role, u.location, u.email, u.phone, u.skills, u.is_active,
            (SELECT count(*) FROM work_items w JOIN statuses s ON s.code = w.status_code
             WHERE w.owner_id = u.id AND w.is_active AND NOT s.is_inactive AND NOT s.is_terminal)::int AS open_items
     FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.display_name`, params);
  const locations = (await db.query(`SELECT DISTINCT location FROM users WHERE location <> '' ORDER BY location`)).map((r) => r.location);
  const viewer = !can(req.user, 'member');
  res.json({ rows: rows.map((u) => strip(u, viewer)), locations, contactVisible: !viewer });
}));

function readUser(body, partial) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    out[f] = String(body[f] ?? '').trim();
  }
  if (!partial || out.display_name !== undefined) out.display_name = required(out.display_name, 'Name');
  if (!partial || out.login_id !== undefined) out.login_id = required(out.login_id, 'Login (email)');
  if (out.role !== undefined && !ROLES.includes(out.role)) throw new HttpError(400, 'Role must be lead, member or viewer');
  return out;
}

router.post('/', requireRole('lead'), wrap(async (req, res) => {
  const f = readUser(req.body, false);
  const u = await db.tx(async (q) => {
    const cols = Object.keys(f);
    const [row] = await q(`INSERT INTO users(${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, cols.map((c) => f[c]))
      .catch(uniqueGuard(`Login "${f.login_id}" already belongs to someone`));
    await audit(q, req.user, 'user', row.id, 'create', snapshot(row, ['display_name', 'login_id', 'role', 'location']));
    return row;
  });
  res.status(201).json(u);
}));

router.patch('/:id', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const f = readUser(req.body, true);
  if (!Object.keys(f).length) throw new HttpError(400, 'Nothing to update');
  const u = await db.tx(async (q) => {
    const [before] = await q('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'Member not found');
    if (before.id === req.user.id && f.role && f.role !== 'lead') throw new HttpError(409, "You can't remove your own lead role");
    const cols = Object.keys(f);
    const [after] = await q(`UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => f[c]), id]).catch(uniqueGuard(`Login "${f.login_id}" already belongs to someone`));
    await audit(q, req.user, 'user', id, 'update', diff(before, after, FIELDS));
    return after;
  });
  res.json(u);
}));

router.post('/:id/active', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const active = Boolean(req.body.is_active);
  await db.tx(async (q) => {
    const [before] = await q('SELECT is_active FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'Member not found');
    if (id === req.user.id && !active) throw new HttpError(409, "You can't deactivate yourself");
    await q('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2', [active, id]);
    await audit(q, req.user, 'user', id, 'update', diff(before, { is_active: active }, ['is_active']));
  });
  res.json({ ok: true });
}));

module.exports = router;
