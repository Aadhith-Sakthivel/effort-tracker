// Audit trail: one row per changed field (updates) or one row per create/delete.
const str = (v) => (v === undefined || v === null ? null : v instanceof Date ? v.toISOString() : String(v));

async function audit(q, actor, entityType, entityId, action, changes = []) {
  const who = actor ? actor.login_id : 'system';
  if (action !== 'update' || !changes.length) {
    const summary = changes.length ? JSON.stringify(Object.fromEntries(changes.map((c) => [c.field, c.new ?? c.old]))) : null;
    await q(
      `INSERT INTO audit_entries(entity_type, entity_id, action, field, old_value, new_value, actor)
       VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
      [entityType, String(entityId), action, action === 'delete' ? summary : null, action === 'delete' ? null : summary, who],
    );
    return;
  }
  for (const c of changes) {
    await q(
      `INSERT INTO audit_entries(entity_type, entity_id, action, field, old_value, new_value, actor)
       VALUES ($1, $2, 'update', $3, $4, $5, $6)`,
      [entityType, String(entityId), c.field, str(c.old), str(c.new), who],
    );
  }
}

// Compare a row before/after for the given fields; returns only real changes.
function diff(before, after, fields) {
  const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v));
  return fields
    .filter((f) => after[f] !== undefined && norm(before[f]) !== norm(after[f]))
    .map((f) => ({ field: f, old: before[f], new: after[f] }));
}

// For creates: record the given fields as the new values.
const snapshot = (row, fields) => fields.filter((f) => row[f] !== undefined && row[f] !== null && row[f] !== '')
  .map((f) => ({ field: f, new: row[f] }));

module.exports = { audit, diff, snapshot };
