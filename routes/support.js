// Support tasks: standalone tracker with an activity feed (comments + status/close events).
const express = require('express');
const db = require('../db');
const { wrap, HttpError, intOrNull, required, uniqueGuard } = require('../lib/http');
const { requireRole } = require('../lib/auth');
const { audit, diff, snapshot } = require('../lib/audit');
const { isDate } = require('../lib/time');

const router = express.Router();
const STATUSES = { queued: 'Queued', in_progress: 'In Progress', hold: 'Hold', done: 'Done', cancelled: 'Cancelled' };
const TERMINAL = ['done', 'cancelled'];

const TASK_SELECT = `
  SELECT t.id, t.reference, t.description, t.status, t.owner_id, to_char(t.target_date, 'YYYY-MM-DD') AS target_date,
         t.is_active, t.closed_at, t.created_at, t.updated_at, u.display_name AS owner_name,
         (SELECT count(*) FROM support_activity a WHERE a.task_id = t.id AND a.kind = 'comment')::int AS comment_count
  FROM support_tasks t LEFT JOIN users u ON u.id = t.owner_id`;

async function loadTask(id) {
  const [t] = await db.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
  if (!t) throw new HttpError(404, 'Support task not found');
  return t;
}

const activity = (q, taskId, kind, body, user) =>
  q('INSERT INTO support_activity(task_id, kind, body, author_id) VALUES ($1, $2, $3, $4)', [taskId, kind, body, user.id]);

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { params.push(req.query.status); where.push(`t.status = $${params.length}`); }
  if (intOrNull(req.query.owner)) { params.push(intOrNull(req.query.owner)); where.push(`t.owner_id = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(t.reference ILIKE $${params.length} OR t.description ILIKE $${params.length})`); }
  const state = req.query.state || 'open';
  if (state === 'open') where.push('t.is_active');
  if (state === 'closed') where.push('NOT t.is_active');
  res.json({ statuses: STATUSES, terminal: TERMINAL,
    rows: await db.query(`${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.is_active DESC, t.target_date NULLS LAST, t.id DESC`, params) });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const task = await loadTask(id);
  const feed = await db.query(
    `SELECT a.id, a.kind, a.body, a.created_at, u.display_name AS author
     FROM support_activity a LEFT JOIN users u ON u.id = a.author_id WHERE a.task_id = $1 ORDER BY a.created_at, a.id`, [id]);
  res.json({ ...task, activity: feed });
}));

router.post('/', requireRole('member'), wrap(async (req, res) => {
  const description = required(req.body.description, 'Description');
  if (req.body.target_date && !isDate(req.body.target_date)) throw new HttpError(400, 'Target date is invalid');
  const id = await db.tx(async (q) => {
    let reference = String(req.body.reference || '').trim();
    if (!reference) {
      const [{ n }] = await q('SELECT count(*)::int + 1 AS n FROM support_tasks');
      for (let i = n; ; i++) {
        reference = `SUP-${String(i).padStart(4, '0')}`;
        const [hit] = await q('SELECT 1 FROM support_tasks WHERE lower(reference) = lower($1)', [reference]);
        if (!hit) break;
      }
    }
    const [t] = await q(
      'INSERT INTO support_tasks(reference, description, owner_id, target_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [reference, description, intOrNull(req.body.owner_id), req.body.target_date || null],
    ).catch(uniqueGuard(`Reference "${reference}" is already used`));
    await activity(q, t.id, 'state', 'Opened', req.user);
    await audit(q, req.user, 'support_task', t.id, 'create', snapshot(t, ['reference', 'description', 'owner_id', 'status']));
    return t.id;
  });
  res.status(201).json(await loadTask(id));
}));

router.patch('/:id', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  await db.tx(async (q) => {
    const [before] = await q(`SELECT description, owner_id, to_char(target_date, 'YYYY-MM-DD') AS target_date FROM support_tasks WHERE id = $1 FOR UPDATE`, [id]);
    if (!before) throw new HttpError(404, 'Support task not found');
    const next = {
      description: req.body.description !== undefined ? required(req.body.description, 'Description') : before.description,
      owner_id: req.body.owner_id !== undefined ? intOrNull(req.body.owner_id) : before.owner_id,
      target_date: req.body.target_date !== undefined ? (req.body.target_date || null) : before.target_date,
    };
    if (next.target_date && !isDate(next.target_date)) throw new HttpError(400, 'Target date is invalid');
    await q('UPDATE support_tasks SET description = $1, owner_id = $2, target_date = $3, updated_at = now() WHERE id = $4',
      [next.description, next.owner_id, next.target_date, id]);
    await audit(q, req.user, 'support_task', id, 'update', diff(before, next, ['description', 'owner_id', 'target_date']));
  });
  res.json(await loadTask(id));
}));

router.post('/:id/status', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const to = req.body.status;
  if (!STATUSES[to]) throw new HttpError(400, 'Unknown status');
  await db.tx(async (q) => {
    const [t] = await q('SELECT status, is_active FROM support_tasks WHERE id = $1 FOR UPDATE', [id]);
    if (!t) throw new HttpError(404, 'Support task not found');
    if (!t.is_active) throw new HttpError(409, 'Reopen the task before changing its status');
    if (t.status === to) return;
    await q('UPDATE support_tasks SET status = $1, updated_at = now() WHERE id = $2', [to, id]);
    await activity(q, id, 'status', `${STATUSES[t.status]} → ${STATUSES[to]}`, req.user);
    await audit(q, req.user, 'support_task', id, 'update', [{ field: 'status', old: t.status, new: to }]);
  });
  res.json(await loadTask(id));
}));

router.post('/:id/comments', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const body = required(req.body.body, 'Comment');
  await db.tx(async (q) => {
    const [t] = await q('SELECT 1 FROM support_tasks WHERE id = $1', [id]);
    if (!t) throw new HttpError(404, 'Support task not found');
    await activity(q, id, 'comment', body, req.user);
    await q('UPDATE support_tasks SET updated_at = now() WHERE id = $1', [id]);
  });
  res.status(201).json({ ok: true });
}));

// Closing is blocked unless the task has reached a terminal status.
router.post('/:id/close', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  await db.tx(async (q) => {
    const [t] = await q('SELECT status, is_active FROM support_tasks WHERE id = $1 FOR UPDATE', [id]);
    if (!t) throw new HttpError(404, 'Support task not found');
    if (!t.is_active) return;
    if (!TERMINAL.includes(t.status)) throw new HttpError(409, `Move the task to Done or Cancelled before closing (it is ${STATUSES[t.status]})`);
    await q('UPDATE support_tasks SET is_active = FALSE, closed_at = now(), updated_at = now() WHERE id = $1', [id]);
    await activity(q, id, 'state', `Closed as ${STATUSES[t.status]}`, req.user);
    await audit(q, req.user, 'support_task', id, 'update', [{ field: 'is_active', old: true, new: false }]);
  });
  res.json(await loadTask(id));
}));

router.post('/:id/reopen', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  await db.tx(async (q) => {
    const [t] = await q('SELECT is_active FROM support_tasks WHERE id = $1 FOR UPDATE', [id]);
    if (!t) throw new HttpError(404, 'Support task not found');
    if (t.is_active) return;
    await q(`UPDATE support_tasks SET is_active = TRUE, closed_at = NULL, status = 'in_progress', updated_at = now() WHERE id = $1`, [id]);
    await activity(q, id, 'state', 'Reopened', req.user);
    await audit(q, req.user, 'support_task', id, 'update', [{ field: 'is_active', old: false, new: true }]);
  });
  res.json(await loadTask(id));
}));

module.exports = router;
