// Work items: list, detail with per-category tabs, board status moves, categories, comments, time.
const express = require('express');
const db = require('../db');
const { wrap, HttpError, intOrNull, numOrNull, required, uniqueGuard } = require('../lib/http');
const { requireRole } = require('../lib/auth');
const { audit, diff, snapshot } = require('../lib/audit');
const { isDate, nowInTz } = require('../lib/time');
const { applyTimeChanges } = require('../lib/time-entries');
const { getSettings } = require('./meta');

const router = express.Router();
const EDITABLE = ['reference', 'title', 'description', 'primary_category_id', 'owner_id', 'estimated_hours', 'approved_hours', 'target_date', 'is_active', 'sub_status_code'];

const ITEM_SELECT = `
  SELECT w.id, w.reference, w.title, w.description, w.primary_category_id, w.status_code, w.sub_status_code,
         w.owner_id, w.estimated_hours::float AS estimated_hours, w.approved_hours::float AS approved_hours,
         to_char(w.target_date, 'YYYY-MM-DD') AS target_date, w.is_active, w.created_at, w.updated_at,
         s.label AS status_label, s.is_terminal, s.is_inactive, ss.label AS sub_status_label,
         u.display_name AS owner_name, pc.label AS primary_category_label,
         COALESCE((SELECT sum(hours) FROM time_entries te WHERE te.work_item_id = w.id), 0)::float AS actual_hours,
         (SELECT count(*) FROM comments c WHERE c.work_item_id = w.id)::int AS comment_count,
         COALESCE((SELECT json_agg(json_build_object('id', c.id, 'label', c.label, 'is_custom', c.is_custom) ORDER BY c.sort_order, c.label)
                   FROM work_item_categories wc JOIN categories c ON c.id = wc.category_id WHERE wc.work_item_id = w.id), '[]') AS categories
  FROM work_items w
  JOIN statuses s ON s.code = w.status_code
  LEFT JOIN sub_statuses ss ON ss.code = w.sub_status_code
  LEFT JOIN users u ON u.id = w.owner_id
  LEFT JOIN categories pc ON pc.id = w.primary_category_id`;

const parseCats = (row) => ({ ...row, categories: typeof row.categories === 'string' ? JSON.parse(row.categories) : row.categories });

async function loadItem(id, q = db.query) {
  const [row] = await q(`${ITEM_SELECT} WHERE w.id = $1`, [id]);
  if (!row) throw new HttpError(404, 'Work item not found');
  return parseCats(row);
}

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.q) add(`(w.title ILIKE ? OR w.reference ILIKE $${params.length + 1} OR w.description ILIKE $${params.length + 1})`, `%${req.query.q}%`);
  if (req.query.status) add('w.status_code = ?', req.query.status);
  if (intOrNull(req.query.category)) add('EXISTS (SELECT 1 FROM work_item_categories wc WHERE wc.work_item_id = w.id AND wc.category_id = ?)', intOrNull(req.query.category));
  if (intOrNull(req.query.owner)) add('w.owner_id = ?', intOrNull(req.query.owner));
  const active = req.query.active || 'active';
  if (active === 'active') where.push('w.is_active AND NOT s.is_inactive');
  if (active === 'inactive') where.push('(NOT w.is_active OR s.is_inactive)');
  // Due filter in business time: overdue, or due within the next 7 days (open items only).
  const today = nowInTz().date;
  if (req.query.due === 'overdue') add('(w.target_date < ?::date AND NOT s.is_terminal)', today);
  if (req.query.due === 'week') add('(w.target_date >= ?::date AND w.target_date <= ?::date + 7 AND NOT s.is_terminal)'.replace(/\?/g, () => `$${params.length + 1}`), today);
  if (req.query.watching === '1' && req.user.id) add('EXISTS (SELECT 1 FROM work_item_watchers ww WHERE ww.work_item_id = w.id AND ww.user_id = ?)', req.user.id);
  const rows = await db.query(`${ITEM_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.updated_at DESC`, params);
  const watched = req.user.id
    ? new Set((await db.query('SELECT work_item_id FROM work_item_watchers WHERE user_id = $1', [req.user.id])).map((r) => r.work_item_id))
    : new Set();
  res.json(rows.map((r) => ({ ...parseCats(r), is_watching: watched.has(r.id) })));
}));

router.get('/:id', wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const item = await loadItem(id);
  const [groups, comments, timeNotes, totals] = await Promise.all([
    db.query(`SELECT c.id, c.code, c.label, c.is_custom, gs.sub_status_code, ss.label AS sub_status_label
              FROM work_item_categories wc JOIN categories c ON c.id = wc.category_id
              LEFT JOIN group_states gs ON gs.work_item_id = wc.work_item_id AND gs.category_id = c.id
              LEFT JOIN sub_statuses ss ON ss.code = gs.sub_status_code
              WHERE wc.work_item_id = $1 ORDER BY c.sort_order, c.label`, [id]),
    db.query(`SELECT c.id, c.category_id, c.body, c.created_at, u.display_name AS author
              FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.work_item_id = $1 ORDER BY c.created_at, c.id`, [id]),
    db.query(`SELECT te.id, te.category_id, to_char(te.work_date, 'YYYY-MM-DD') AS work_date, te.hours::float AS hours, te.note,
                     te.updated_at AS created_at, u.display_name AS author
              FROM time_entries te JOIN users u ON u.id = te.user_id
              WHERE te.work_item_id = $1 AND te.note <> '' ORDER BY te.work_date, te.id`, [id]),
    db.query(`SELECT category_id, sum(hours)::float AS hours FROM time_entries WHERE work_item_id = $1 GROUP BY category_id`, [id]),
  ]);
  const [links, watchers, activity] = await Promise.all([
    db.query(`SELECT l.id, l.title, l.url, l.created_at, l.added_by, u.display_name AS added_by_name
              FROM work_item_links l LEFT JOIN users u ON u.id = l.added_by WHERE l.work_item_id = $1 ORDER BY l.created_at`, [id]),
    db.query(`SELECT u.id, u.display_name FROM work_item_watchers w JOIN users u ON u.id = w.user_id WHERE w.work_item_id = $1 ORDER BY u.display_name`, [id]),
    // Everything that happened to this item, from the audit trail.
    db.query(`SELECT a.id, a.entity_type, a.action, a.field, a.old_value, a.new_value, a.changed_at, COALESCE(u.display_name, a.actor) AS actor
              FROM audit_entries a LEFT JOIN users u ON lower(u.login_id) = lower(a.actor)
              WHERE (a.entity_type = 'work_item' AND a.entity_id = $1)
                 OR (a.entity_type IN ('group_state', 'time_entry', 'link') AND a.entity_id LIKE $1 || '/%')
                 OR (a.entity_type = 'comment' AND a.entity_id IN (SELECT id::text FROM comments WHERE work_item_id = $2))
              ORDER BY a.changed_at DESC, a.id DESC LIMIT 200`, [String(id), id]),
  ]);
  const hoursBy = Object.fromEntries(totals.map((t) => [t.category_id, t.hours]));
  res.json({
    ...item, groups: groups.map((g) => ({ ...g, hours: hoursBy[g.id] || 0 })), comments, timeNotes,
    links, watchers, is_watching: watchers.some((w) => w.id === req.user.id), activity,
  });
}));

function readFields(body) {
  const out = {};
  if (body.reference !== undefined) out.reference = required(body.reference, 'Reference');
  if (body.title !== undefined) out.title = required(body.title, 'Title');
  if (body.description !== undefined) out.description = String(body.description || '');
  if (body.primary_category_id !== undefined) out.primary_category_id = intOrNull(body.primary_category_id);
  if (body.owner_id !== undefined) out.owner_id = intOrNull(body.owner_id);
  if (body.estimated_hours !== undefined) out.estimated_hours = numOrNull(body.estimated_hours);
  if (body.approved_hours !== undefined) out.approved_hours = numOrNull(body.approved_hours);
  if (body.target_date !== undefined) {
    if (body.target_date && !isDate(body.target_date)) throw new HttpError(400, 'Target date is invalid');
    out.target_date = body.target_date || null;
  }
  if (body.is_active !== undefined) out.is_active = Boolean(body.is_active);
  if (body.sub_status_code !== undefined) out.sub_status_code = body.sub_status_code || null;
  return out;
}

async function nextReference(q, prefix, table) {
  const [{ n }] = await q(`SELECT count(*)::int + 1 AS n FROM ${table}`);
  for (let i = n; ; i++) {
    const ref = `${prefix}-${String(i).padStart(4, '0')}`;
    const [hit] = await q(`SELECT 1 FROM ${table} WHERE lower(reference) = lower($1)`, [ref]);
    if (!hit) return ref;
  }
}

router.post('/', requireRole('lead'), wrap(async (req, res) => {
  const body = { ...req.body, title: req.body.title ?? '' };
  if (!String(body.reference || '').trim()) delete body.reference; // blank = auto-numbered
  const f = readFields(body);
  const categoryIds = (req.body.category_ids || []).map(Number).filter(Boolean);
  if (f.primary_category_id && !categoryIds.includes(f.primary_category_id)) categoryIds.unshift(f.primary_category_id);
  if (!categoryIds.length) throw new HttpError(400, 'Pick at least one category');

  const id = await db.tx(async (q) => {
    const reference = f.reference || await nextReference(q, 'WI', 'work_items');
    const [statusRow] = await q('SELECT code FROM statuses ORDER BY sort_order LIMIT 1');
    const [w] = await q(
      `INSERT INTO work_items(reference, title, description, primary_category_id, status_code, owner_id, estimated_hours, approved_hours, target_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [reference, f.title, f.description || '', f.primary_category_id || categoryIds[0], req.body.status_code || statusRow.code,
        f.owner_id ?? null, f.estimated_hours ?? null, f.approved_hours ?? null, f.target_date ?? null],
    ).catch(uniqueGuard(`Reference "${reference}" is already used`));
    for (const cid of categoryIds) {
      await q('INSERT INTO work_item_categories(work_item_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [w.id, cid]);
      await q(`INSERT INTO group_states(work_item_id, category_id, sub_status_code) VALUES ($1, $2, 'not_started') ON CONFLICT DO NOTHING`, [w.id, cid]);
    }
    await audit(q, req.user, 'work_item', w.id, 'create', snapshot(w, ['reference', 'title', 'status_code', 'owner_id', 'approved_hours', 'target_date']));
    return w.id;
  });
  res.status(201).json(await loadItem(id));
}));

// Bulk edit (leads): set status, owner and/or target date on many items at once; each change is audited.
router.post('/bulk', requireRole('lead'), wrap(async (req, res) => {
  const ids = [...new Set((req.body.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new HttpError(400, 'Select at least one work item');
  if (ids.length > 200) throw new HttpError(400, 'Select at most 200 items at a time');
  const set = {};
  if (req.body.status_code) set.status_code = req.body.status_code;
  if (req.body.owner_id !== undefined && req.body.owner_id !== '') set.owner_id = intOrNull(req.body.owner_id);
  if (req.body.target_date) {
    if (!isDate(req.body.target_date)) throw new HttpError(400, 'Target date is invalid');
    set.target_date = req.body.target_date;
  }
  if (!Object.keys(set).length) throw new HttpError(400, 'Choose what to change');
  const updated = await db.tx(async (q) => {
    if (set.status_code) {
      const [s] = await q('SELECT 1 FROM statuses WHERE code = $1', [set.status_code]);
      if (!s) throw new HttpError(400, 'Unknown status');
    }
    let n = 0;
    for (const id of ids) {
      const [before] = await q(`SELECT status_code, owner_id, to_char(target_date, 'YYYY-MM-DD') AS target_date FROM work_items WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) continue;
      const changes = diff(before, set, Object.keys(set));
      if (!changes.length) continue;
      const cols = changes.map((c) => c.field);
      await q(`UPDATE work_items SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`,
        [...cols.map((c) => set[c]), id]);
      await audit(q, req.user, 'work_item', id, 'update', changes);
      n++;
    }
    return n;
  });
  res.json({ updated });
}));

router.patch('/:id', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const f = readFields(req.body);
  if (!Object.keys(f).length) throw new HttpError(400, 'Nothing to update');
  await db.tx(async (q) => {
    const [before] = await q(
      `SELECT reference, title, description, primary_category_id, owner_id, estimated_hours::float AS estimated_hours,
              approved_hours::float AS approved_hours, to_char(target_date, 'YYYY-MM-DD') AS target_date, is_active, sub_status_code
       FROM work_items WHERE id = $1 FOR UPDATE`, [id]);
    if (!before) throw new HttpError(404, 'Work item not found');
    const cols = Object.keys(f);
    await q(`UPDATE work_items SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`,
      [...cols.map((c) => f[c]), id]).catch(uniqueGuard(`Reference "${f.reference}" is already used`));
    await audit(q, req.user, 'work_item', id, 'update', diff(before, f, EDITABLE));
  });
  res.json(await loadItem(id));
}));

router.delete('/:id', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  await db.tx(async (q) => {
    const [w] = await q('SELECT * FROM work_items WHERE id = $1', [id]);
    if (!w) throw new HttpError(404, 'Work item not found');
    await q('DELETE FROM work_items WHERE id = $1', [id]);
    await audit(q, req.user, 'work_item', id, 'delete', snapshot(w, ['reference', 'title']).map((c) => ({ ...c, old: c.new })));
  });
  res.status(204).end();
}));

// Board drag or detail dropdown. Members and leads; viewers are blocked by the guard.
router.post('/:id/status', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const code = required(req.body.status_code, 'Status');
  await db.tx(async (q) => {
    const [s] = await q('SELECT code FROM statuses WHERE code = $1', [code]);
    if (!s) throw new HttpError(400, 'Unknown status');
    const [w] = await q('SELECT status_code FROM work_items WHERE id = $1 FOR UPDATE', [id]);
    if (!w) throw new HttpError(404, 'Work item not found');
    if (w.status_code === code) return;
    await q('UPDATE work_items SET status_code = $1, updated_at = now() WHERE id = $2', [code, id]);
    await audit(q, req.user, 'work_item', id, 'update', [{ field: 'status_code', old: w.status_code, new: code }]);
  });
  res.json(await loadItem(id));
}));

// Overall sub-status (members can change statuses).
router.post('/:id/sub-status', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const code = req.body.sub_status_code || null;
  await db.tx(async (q) => {
    if (code) {
      const [s] = await q('SELECT 1 FROM sub_statuses WHERE code = $1', [code]);
      if (!s) throw new HttpError(400, 'Unknown sub-status');
    }
    const [w] = await q('SELECT sub_status_code FROM work_items WHERE id = $1 FOR UPDATE', [id]);
    if (!w) throw new HttpError(404, 'Work item not found');
    await q('UPDATE work_items SET sub_status_code = $1, updated_at = now() WHERE id = $2', [code, id]);
    await audit(q, req.user, 'work_item', id, 'update', diff(w, { sub_status_code: code }, ['sub_status_code']));
  });
  res.json(await loadItem(id));
}));

// Attach a global category, or create an item-scoped custom one ({ label }).
router.post('/:id/categories', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  await db.tx(async (q) => {
    const [w] = await q('SELECT id FROM work_items WHERE id = $1', [id]);
    if (!w) throw new HttpError(404, 'Work item not found');
    let categoryId = intOrNull(req.body.category_id);
    if (!categoryId) {
      const label = required(req.body.label, 'Category name');
      const code = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const [c] = await q(
        `INSERT INTO categories(code, label, sort_order, is_custom, owner_work_item_id) VALUES ($1, $2, 900, TRUE, $3) RETURNING id`,
        [code, label, id],
      ).catch(uniqueGuard(`This item already has a category called "${label}"`));
      categoryId = c.id;
      await audit(q, req.user, 'category', categoryId, 'create', [{ field: 'label', new: label }, { field: 'owner_work_item_id', new: id }]);
    } else {
      const [c] = await q('SELECT owner_work_item_id FROM categories WHERE id = $1 AND is_active', [categoryId]);
      if (!c || (c.owner_work_item_id && c.owner_work_item_id !== id)) throw new HttpError(400, 'Category not available for this item');
    }
    await q('INSERT INTO work_item_categories(work_item_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, categoryId]);
    await q(`INSERT INTO group_states(work_item_id, category_id, sub_status_code) VALUES ($1, $2, 'not_started') ON CONFLICT DO NOTHING`, [id, categoryId]);
    await audit(q, req.user, 'work_item', id, 'update', [{ field: 'categories', old: null, new: `+${categoryId}` }]);
  });
  res.status(201).json(await loadItem(id));
}));

router.delete('/:id/categories/:cid', requireRole('lead'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const cid = intOrNull(req.params.cid);
  await db.tx(async (q) => {
    const [{ n }] = await q('SELECT count(*)::int AS n FROM time_entries WHERE work_item_id = $1 AND category_id = $2', [id, cid]);
    if (n) throw new HttpError(409, 'This category has logged time; clear it in the timesheet first');
    await q('DELETE FROM group_states WHERE work_item_id = $1 AND category_id = $2', [id, cid]);
    await q('DELETE FROM work_item_categories WHERE work_item_id = $1 AND category_id = $2', [id, cid]);
    await q('UPDATE work_items SET primary_category_id = NULL WHERE id = $1 AND primary_category_id = $2', [id, cid]);
    const removed = await q('DELETE FROM categories WHERE id = $1 AND owner_work_item_id = $2 RETURNING label', [cid, id]); // custom ones go with the item
    if (removed.length) await audit(q, req.user, 'category', cid, 'delete', [{ field: 'label', old: removed[0].label }]);
    await audit(q, req.user, 'work_item', id, 'update', [{ field: 'categories', old: `${cid}`, new: `-${cid}` }]);
  });
  res.json(await loadItem(id));
}));

// Per-category sub-status (a tab's own status).
router.put('/:id/categories/:cid/state', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const cid = intOrNull(req.params.cid);
  const code = required(req.body.sub_status_code, 'Sub-status');
  await db.tx(async (q) => {
    const [s] = await q('SELECT 1 FROM sub_statuses WHERE code = $1', [code]);
    if (!s) throw new HttpError(400, 'Unknown sub-status');
    const [link] = await q('SELECT 1 FROM work_item_categories WHERE work_item_id = $1 AND category_id = $2', [id, cid]);
    if (!link) throw new HttpError(404, 'Category is not on this item');
    const [before] = await q('SELECT sub_status_code FROM group_states WHERE work_item_id = $1 AND category_id = $2', [id, cid]);
    await q(`INSERT INTO group_states(work_item_id, category_id, sub_status_code, updated_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (work_item_id, category_id) DO UPDATE SET sub_status_code = EXCLUDED.sub_status_code, updated_at = now()`, [id, cid, code]);
    await q('UPDATE work_items SET updated_at = now() WHERE id = $1', [id]);
    await audit(q, req.user, 'group_state', `${id}/${cid}`, 'update', [{ field: 'sub_status_code', old: before && before.sub_status_code, new: code }]);
  });
  res.json({ ok: true });
}));

// category_id null = card-level comment, shown on every tab.
router.post('/:id/comments', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const body = required(req.body.body, 'Comment');
  const cid = intOrNull(req.body.category_id);
  await db.tx(async (q) => {
    if (cid) {
      const [link] = await q('SELECT 1 FROM work_item_categories WHERE work_item_id = $1 AND category_id = $2', [id, cid]);
      if (!link) throw new HttpError(400, 'Category is not on this item');
    }
    const [c] = await q('INSERT INTO comments(work_item_id, category_id, body, author_id) VALUES ($1, $2, $3, $4) RETURNING id', [id, cid, body, req.user.id]);
    await q('UPDATE work_items SET updated_at = now() WHERE id = $1', [id]);
    await audit(q, req.user, 'comment', c.id, 'create', [{ field: 'work_item_id', new: id }, { field: 'category_id', new: cid ?? 'all' }]);
  });
  res.status(201).json({ ok: true });
}));

// Quick "log time" from the detail view (adds to the day's cell for the signed-in user).
router.post('/:id/time', requireRole('member'), wrap(async (req, res) => {
  if (!req.user.id) throw new HttpError(403, 'Your login is not linked to a team member');
  const settings = await getSettings();
  const date = req.body.work_date || nowInTz().date;
  await db.tx((q) => applyTimeChanges(q, req.user, req.user.id, [{
    work_item_id: intOrNull(req.params.id), category_id: intOrNull(req.body.category_id),
    work_date: date, hours: Number(req.body.hours), note: req.body.note,
  }], settings, 'add'));
  res.status(201).json({ ok: true });
}));

// Reference links (specs, tickets, dashboards). Any team member can add; the adder or a lead can remove.
router.post('/:id/links', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const url = String(required(req.body.url, 'Link URL'));
  if (!/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, 'Links must start with http:// or https://');
  const title = String(req.body.title || '').trim() || url.replace(/^https?:\/\//i, '').slice(0, 80);
  await db.tx(async (q) => {
    const [w] = await q('SELECT 1 FROM work_items WHERE id = $1', [id]);
    if (!w) throw new HttpError(404, 'Work item not found');
    const [l] = await q('INSERT INTO work_item_links(work_item_id, title, url, added_by) VALUES ($1, $2, $3, $4) RETURNING id', [id, title, url, req.user.id]);
    await audit(q, req.user, 'link', `${id}/${l.id}`, 'create', [{ field: 'title', new: title }, { field: 'url', new: url }]);
    await q('UPDATE work_items SET updated_at = now() WHERE id = $1', [id]);
  });
  res.status(201).json({ ok: true });
}));

router.delete('/:id/links/:lid', requireRole('member'), wrap(async (req, res) => {
  const id = intOrNull(req.params.id);
  const lid = intOrNull(req.params.lid);
  await db.tx(async (q) => {
    const [l] = await q('SELECT title, added_by FROM work_item_links WHERE id = $1 AND work_item_id = $2', [lid, id]);
    if (!l) throw new HttpError(404, 'Link not found');
    if (l.added_by !== req.user.id && req.user.role !== 'lead') throw new HttpError(403, 'Only the person who added it or a lead can remove a link');
    await q('DELETE FROM work_item_links WHERE id = $1', [lid]);
    await audit(q, req.user, 'link', `${id}/${lid}`, 'delete', [{ field: 'title', old: l.title }]);
  });
  res.status(204).end();
}));

// Watch / unwatch: anyone linked to a team record (viewers included) can follow an item.
router.post('/:id/watch', wrap(async (req, res) => {
  if (!req.user.id) throw new HttpError(403, 'Your sign-in is not linked to a team member');
  const id = intOrNull(req.params.id);
  const on = req.body.watching !== false;
  if (on) await db.query('INSERT INTO work_item_watchers(work_item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
  else await db.query('DELETE FROM work_item_watchers WHERE work_item_id = $1 AND user_id = $2', [id, req.user.id]);
  res.json({ watching: on });
}));

module.exports = router;
