// Timesheet: month grid, one row per work item × category, hours per day.
const express = require('express');
const db = require('../db');
const { wrap, HttpError, intOrNull } = require('../lib/http');
const { requireRole, can } = require('../lib/auth');
const { monthDays, isFrozen, freezeDeadline, nowInTz } = require('../lib/time');
const { applyTimeChanges } = require('../lib/time-entries');
const { getSettings } = require('./meta');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const userId = intOrNull(req.query.user) || req.user.id;
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : nowInTz().date.slice(0, 7);
  if (!userId) throw new HttpError(400, 'Pick a team member');
  const settings = await getSettings();
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];

  // Rows: open (non-terminal) items the person owns, any item they logged time on this month,
  // and any active items added to the grid with "Add work item" (?extra=1,2).
  const extra = String(req.query.extra || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const items = await db.query(
    `SELECT w.id, w.reference, w.title, s.label AS status_label
     FROM work_items w JOIN statuses s ON s.code = w.status_code
     WHERE (w.owner_id = $1 AND w.is_active AND NOT s.is_inactive AND NOT s.is_terminal)
        OR EXISTS (SELECT 1 FROM time_entries te WHERE te.work_item_id = w.id AND te.user_id = $1 AND te.work_date BETWEEN $2 AND $3)
        OR (w.id = ANY($4::int[]) AND w.is_active AND NOT s.is_inactive)
     ORDER BY w.reference`, [userId, first, last, extra]);
  const ids = items.map((i) => i.id);
  const [cats, entries] = ids.length ? await Promise.all([
    db.query(`SELECT wc.work_item_id, c.id, c.label FROM work_item_categories wc JOIN categories c ON c.id = wc.category_id
              WHERE wc.work_item_id = ANY($1::int[]) ORDER BY c.sort_order, c.label`, [ids]),
    db.query(`SELECT work_item_id, category_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, hours::float AS hours
              FROM time_entries WHERE user_id = $1 AND work_date BETWEEN $2 AND $3`, [userId, first, last]),
  ]) : [[], []];

  const cell = {};
  for (const e of entries) cell[`${e.work_item_id}|${e.category_id}|${e.work_date}`] = e.hours;
  const rows = items.map((i) => ({
    ...i,
    categories: cats.filter((c) => c.work_item_id === i.id).map((c) => ({
      id: c.id, label: c.label,
      hours: Object.fromEntries(days.filter((d) => cell[`${i.id}|${c.id}|${d}`]).map((d) => [d, cell[`${i.id}|${c.id}|${d}`]])),
    })),
  }));

  const now = nowInTz();
  res.json({
    month, days, rows,
    userId,
    cap: Number(settings.daily_hour_cap),
    today: now.date,
    frozen: Object.fromEntries(days.map((d) => [d, isFrozen(d, settings, now)])),
    freezeRule: { weekday: Number(settings.freeze_weekday), hour: Number(settings.freeze_hour) },
    nextDeadline: freezeDeadline(now.date, settings),
    canEdit: can(req.user, 'lead') || (can(req.user, 'member') && req.user.id === userId),
  });
}));

// Save a batch of cell edits (the UI confirms the before/after first).
router.put('/', requireRole('member'), wrap(async (req, res) => {
  const userId = intOrNull(req.body.user_id) || req.user.id;
  if (!userId) throw new HttpError(400, 'Pick a team member');
  if (userId !== req.user.id && !can(req.user, 'lead')) throw new HttpError(403, 'You can only edit your own timesheet');
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (!changes.length) throw new HttpError(400, 'No changes to save');
  const settings = await getSettings();
  const applied = await db.tx((q) => applyTimeChanges(q, req.user, userId, changes, settings, 'set'));
  res.json({ saved: applied.length });
}));

module.exports = router;
