// Overview KPIs/charts and the audit log.
const express = require('express');
const db = require('../db');
const { wrap, intOrNull } = require('../lib/http');
const { nowInTz, monthDays } = require('../lib/time');

const router = express.Router();

function lastMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7));
}

router.get('/overview', wrap(async (req, res) => {
  const today = nowInTz().date;
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today.slice(0, 7);
  const months = lastMonths(today.slice(0, 7), 12);
  const days = monthDays(month);

  const [[kpi], [support], byStatus, itemsByCategory, hoursByCategory, monthCats, monthItems, perDay, perMonth, burn, available] = await Promise.all([
    db.query(`SELECT
        count(*) FILTER (WHERE NOT s.is_terminal)::int AS open_items,
        count(*)::int AS active_items,
        COALESCE(sum(w.approved_hours), 0)::float AS approved_hours,
        COALESCE(sum(t.hours), 0)::float AS actual_hours,
        count(*) FILTER (WHERE w.target_date < $1::date AND NOT s.is_terminal)::int AS overdue
      FROM work_items w JOIN statuses s ON s.code = w.status_code
      LEFT JOIN (SELECT work_item_id, sum(hours) AS hours FROM time_entries GROUP BY work_item_id) t ON t.work_item_id = w.id
      WHERE w.is_active AND NOT s.is_inactive`, [today]),
    db.query(`SELECT count(*) FILTER (WHERE is_active)::int AS open,
             count(*) FILTER (WHERE is_active AND target_date < $1::date)::int AS overdue FROM support_tasks`, [today]),
    // Every item, every status (including cancelled/withdrawn), in status order.
    db.query(`SELECT s.code, s.label, count(w.id)::int AS n
      FROM statuses s LEFT JOIN work_items w ON w.status_code = s.code
      GROUP BY s.code, s.label, s.sort_order ORDER BY s.sort_order`),
    db.query(`SELECT CASE WHEN c.is_custom THEN 'Custom' ELSE c.label END AS label, count(DISTINCT wc.work_item_id)::int AS n
      FROM work_item_categories wc JOIN categories c ON c.id = wc.category_id
      JOIN work_items w ON w.id = wc.work_item_id JOIN statuses s ON s.code = w.status_code
      WHERE w.is_active AND NOT s.is_inactive GROUP BY 1 ORDER BY n DESC, label`),
    db.query(`SELECT CASE WHEN c.is_custom THEN 'Custom' ELSE c.label END AS label, sum(te.hours)::float AS hours
      FROM time_entries te JOIN categories c ON c.id = te.category_id GROUP BY 1 ORDER BY hours DESC`),
    // Monthly snapshot: items worked on this month, by category.
    db.query(`SELECT CASE WHEN c.is_custom THEN 'Custom' ELSE c.label END AS label, count(DISTINCT te.work_item_id)::int AS n
      FROM time_entries te JOIN categories c ON c.id = te.category_id
      WHERE to_char(te.work_date, 'YYYY-MM') = $1 GROUP BY 1 ORDER BY n DESC, label`, [month]),
    db.query(`SELECT w.id, w.reference, w.title, sum(te.hours)::float AS hours
      FROM time_entries te JOIN work_items w ON w.id = te.work_item_id
      WHERE to_char(te.work_date, 'YYYY-MM') = $1 GROUP BY w.id, w.reference, w.title ORDER BY hours DESC, w.reference`, [month]),
    db.query(`SELECT to_char(work_date, 'YYYY-MM-DD') AS d, sum(hours)::float AS hours
      FROM time_entries WHERE to_char(work_date, 'YYYY-MM') = $1 GROUP BY 1`, [month]),
    db.query(`SELECT to_char(work_date, 'YYYY-MM') AS m, sum(hours)::float AS hours
      FROM time_entries WHERE to_char(work_date, 'YYYY-MM') >= $1 GROUP BY 1`, [months[0]]),
    db.query(`SELECT w.id, w.reference, w.title, w.approved_hours::float AS approved_hours, COALESCE(t.hours, 0)::float AS actual_hours
      FROM work_items w JOIN statuses s ON s.code = w.status_code
      LEFT JOIN (SELECT work_item_id, sum(hours) AS hours FROM time_entries GROUP BY work_item_id) t ON t.work_item_id = w.id
      WHERE w.is_active AND NOT s.is_inactive AND w.approved_hours IS NOT NULL
      ORDER BY COALESCE(t.hours, 0) / NULLIF(w.approved_hours, 0) DESC NULLS LAST LIMIT 8`),
    db.query(`SELECT DISTINCT to_char(work_date, 'YYYY-MM') AS m FROM time_entries ORDER BY 1 DESC`),
  ]);
  // Reminders: open items that are overdue or due in the next 7 days (business time).
  const dueSoon = await db.query(
    `SELECT w.id, w.reference, w.title, to_char(w.target_date, 'YYYY-MM-DD') AS target_date, (w.target_date - $1::date) AS days,
            u.display_name AS owner_name, w.owner_id
     FROM work_items w JOIN statuses s ON s.code = w.status_code LEFT JOIN users u ON u.id = w.owner_id
     WHERE w.is_active AND NOT s.is_inactive AND NOT s.is_terminal AND w.target_date <= $1::date + 7
     ORDER BY w.target_date, w.reference LIMIT 12`, [today]);

  const dayMap = Object.fromEntries(perDay.map((r) => [r.d, r.hours]));
  const monthMap = Object.fromEntries(perMonth.map((r) => [r.m, r.hours]));
  const monthsWithData = new Set([today.slice(0, 7), ...available.map((r) => r.m)]);

  res.json({
    today, month,
    monthOptions: [...monthsWithData].sort().reverse(),
    kpi, support,
    snapshot: {
      itemsByCategory: monthCats,
      hoursByItem: monthItems,
      hoursPerDay: days.map((d) => ({ date: d, hours: dayMap[d] || 0 })),
      totalHours: monthItems.reduce((s, r) => s + r.hours, 0),
      itemCount: new Set(monthItems.map((r) => r.id)).size,
    },
    effortByMonth: months.map((m) => ({ month: m, hours: monthMap[m] || 0 })),
    byStatus, itemsByCategory, hoursByCategory, burn, dueSoon,
  });
}));

router.get('/audit', wrap(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.entity) { params.push(req.query.entity); where.push(`entity_type = $${params.length}`); }
  if (req.query.entity_id) { params.push(String(req.query.entity_id)); where.push(`entity_id = $${params.length}`); }
  params.push(Math.min(intOrNull(req.query.limit) || 200, 1000));
  const rows = await db.query(
    `SELECT id, entity_type, entity_id, action, field, old_value, new_value, actor, changed_at
     FROM audit_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY changed_at DESC, id DESC LIMIT $${params.length}`, params);
  const entities = (await db.query('SELECT DISTINCT entity_type FROM audit_entries ORDER BY 1')).map((r) => r.entity_type);
  res.json({ rows, entities });
}));

module.exports = router;
