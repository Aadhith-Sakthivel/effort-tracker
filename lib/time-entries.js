// Shared time-entry writer used by the timesheet grid and the work-item "log time" form.
// Enforces: weekly freeze, per-person daily cap, category belongs to the item. Audits every change.
const { HttpError } = require('./http');
const { audit } = require('./audit');
const { isFrozen, isDate } = require('./time');

// changes: [{ work_item_id, category_id, work_date, hours, note? }]; hours 0 deletes the cell.
// mode 'set' replaces the cell's hours (timesheet); 'add' adds to it (log-time form).
async function applyTimeChanges(q, actor, userId, changes, settings, mode = 'set') {
  const cap = Number(settings.daily_hour_cap);
  const touchedDates = new Set();
  const results = [];

  for (const c of changes) {
    const workItemId = Number(c.work_item_id);
    const categoryId = Number(c.category_id);
    const hours = Number(c.hours);
    if (!isDate(c.work_date)) throw new HttpError(400, 'Each change needs a valid date');
    if (Number.isNaN(hours) || hours < 0 || hours > 24) throw new HttpError(400, 'Hours must be between 0 and 24');
    if (Math.round(hours * 4) !== hours * 4) throw new HttpError(400, 'Use quarter-hour steps (0.25)');
    if (isFrozen(c.work_date, settings)) throw new HttpError(409, `The week of ${c.work_date} is frozen and read-only`);

    const [link] = await q('SELECT 1 FROM work_item_categories WHERE work_item_id = $1 AND category_id = $2', [workItemId, categoryId]);
    if (!link) throw new HttpError(400, 'That category is not part of this work item');
    const [item] = await q(`SELECT w.reference, w.is_active, s.is_inactive FROM work_items w JOIN statuses s ON s.code = w.status_code WHERE w.id = $1`, [workItemId]);

    const [existing] = await q(
      'SELECT id, hours::float AS hours, note FROM time_entries WHERE work_item_id = $1 AND user_id = $2 AND category_id = $3 AND work_date = $4',
      [workItemId, userId, categoryId, c.work_date],
    );
    const before = existing ? existing.hours : 0;
    const after = mode === 'add' ? before + hours : hours;
    const note = c.note !== undefined && c.note !== null && String(c.note).trim()
      ? (mode === 'add' && existing && existing.note ? `${existing.note}\n${String(c.note).trim()}` : String(c.note).trim())
      : (existing ? existing.note : '');
    if (after > 24) throw new HttpError(400, 'A single cell cannot exceed 24 hours');
    // Inactive items (cancelled, withdrawn, deactivated) take no new time; reducing or clearing is still allowed.
    if (after > before && (!item.is_active || item.is_inactive)) throw new HttpError(409, `${item.reference} is inactive, so new time can't be logged on it`);

    if (after === before && note === (existing ? existing.note : '')) continue;
    const entityId = `${workItemId}/${categoryId}/${userId}/${c.work_date}`;
    if (after === 0) {
      if (existing) {
        await q('DELETE FROM time_entries WHERE id = $1', [existing.id]);
        await audit(q, actor, 'time_entry', entityId, 'delete', [{ field: 'hours', old: before }]);
      }
    } else if (existing) {
      await q('UPDATE time_entries SET hours = $1, note = $2, updated_at = now() WHERE id = $3', [after, note, existing.id]);
      await audit(q, actor, 'time_entry', entityId, 'update', [{ field: 'hours', old: before, new: after }]);
    } else {
      await q('INSERT INTO time_entries(work_item_id, user_id, category_id, work_date, hours, note) VALUES ($1, $2, $3, $4, $5, $6)',
        [workItemId, userId, categoryId, c.work_date, after, note]);
      await audit(q, actor, 'time_entry', entityId, 'create', [{ field: 'hours', new: after }]);
    }
    touchedDates.add(c.work_date);
    results.push({ ...c, before, after });
  }

  // Check the cap after all changes, so moving hours between cells on one day works.
  for (const d of touchedDates) {
    const [{ total }] = await q('SELECT COALESCE(sum(hours), 0)::float AS total FROM time_entries WHERE user_id = $1 AND work_date = $2', [userId, d]);
    if (total > cap) throw new HttpError(409, `${d}: ${total}h is over the daily cap of ${cap}h`);
  }
  return results;
}

module.exports = { applyTimeChanges };
