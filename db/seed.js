// Fake demo data (made-up people, items and numbers). Inserted only into an empty database.
const db = require('./index');
const { nowInTz, addDays, weekStart } = require('../lib/time');

const USERS = [
  ['Asha Rao', 'asha@example.com', 'lead', 'Bengaluru', '+91 90000 00001', 'Databricks, PySpark, data modelling'],
  ['Ben Tan', 'ben@example.com', 'member', 'Singapore', '+65 8000 0002', 'SQL, testing, reconciliation'],
  ['Chen Wei', 'chen@example.com', 'member', 'Singapore', '+65 8000 0003', 'Airflow, AWS Glue'],
  ['Divya Nair', 'divya@example.com', 'member', 'Chennai', '+91 90000 00004', 'PySpark, Delta Live Tables'],
  ['Eli Gomez', 'eli@example.com', 'viewer', 'Bengaluru', '+91 90000 00005', 'Delivery management'],
];

// reference, title, owner, status, approved, estimated, target offset (days), categories (codes)
const ITEMS = [
  ['WI-0001', 'Customer dimension rebuild', 'Divya Nair', 'in_progress', 40, 36, 10, ['analysis', 'dev', 'testing']],
  ['WI-0002', 'Nightly sales aggregate migration', 'Chen Wei', 'in_review', 24, 24, 3, ['dev', 'testing', 'deploy']],
  ['WI-0003', 'Reconciliation test template', 'Ben Tan', 'done', 16, 14, -5, ['dev', 'docs']],
  ['WI-0004', 'Orders data-quality rules', 'Ben Tan', 'in_progress', 20, 18, 7, ['analysis', 'dev']],
  ['WI-0005', 'Weekly KPI gold table', 'Asha Rao', 'new', 30, 28, 21, ['analysis', 'dev', 'testing', 'deploy']],
  ['WI-0006', 'Retire legacy status spreadsheet', 'Asha Rao', 'in_progress', 12, 10, -2, ['analysis', 'docs']],
  ['WI-0007', 'Archive old extract jobs', 'Chen Wei', 'withdrawn', 8, 8, -20, ['dev']],
];

// Completed items for the six months before "now" (oldest first).
const HISTORY = [
  'Product dimension clean-up', 'Monthly finance extract migration', 'Late-arriving data handling',
  'Inventory snapshot pipeline', 'Customer churn feature table', 'Pipeline alerting rules',
];

const SUPPORT = [
  ['SUP-0001', 'Dashboard shows yesterday’s numbers after the nightly run', 'Chen Wei', 'in_progress', 1],
  ['SUP-0002', 'Access request for the analytics schema', 'Ben Tan', 'done', -1],
  ['SUP-0003', 'Duplicate rows in the orders extract', 'Divya Nair', 'hold', 4],
  ['SUP-0004', 'Update runbook for the weekend batch', 'Asha Rao', 'queued', 9],
];

async function seed() {
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM work_items');
  if (n > 0) return false;
  const today = nowInTz().date;

  await db.tx(async (q) => {
    const user = {};
    for (const [name, login, role, location, phone, skills] of USERS) {
      const [u] = await q(
        `INSERT INTO users(display_name, login_id, role, location, email, phone, skills) VALUES ($1, $2, $3, $4, $2, $5, $6) RETURNING id`,
        [name, login, role, location, phone, skills]);
      user[name] = u.id;
    }
    const cats = Object.fromEntries((await q('SELECT id, code FROM categories WHERE owner_work_item_id IS NULL')).map((c) => [c.code, c.id]));

    const itemIds = [];
    for (const [ref, title, owner, status, approved, est, offset, codes] of ITEMS) {
      const [w] = await q(
        `INSERT INTO work_items(reference, title, description, primary_category_id, status_code, owner_id, estimated_hours, approved_hours, target_date, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [ref, title, `Demo work item: ${title.toLowerCase()}.`, cats[codes[0]], status, user[owner], est, approved, addDays(today, offset), status !== 'withdrawn']);
      itemIds.push({ id: w.id, owner: user[owner], codes, status });
      for (const [i, code] of codes.entries()) {
        await q('INSERT INTO work_item_categories(work_item_id, category_id) VALUES ($1, $2)', [w.id, cats[code]]);
        const sub = status === 'done' ? 'completed' : i === 0 && status !== 'new' ? 'completed' : i === 1 && status !== 'new' ? 'in_progress' : 'not_started';
        await q('INSERT INTO group_states(work_item_id, category_id, sub_status_code) VALUES ($1, $2, $3)', [w.id, cats[code], sub]);
      }
      await q(`INSERT INTO audit_entries(entity_type, entity_id, action, new_value, actor) VALUES ('work_item', $1, 'create', $2, 'seed')`,
        [String(w.id), JSON.stringify({ reference: ref, title })]);
    }

    // Time: weekdays of the last three weeks, 2–7h per person per day, within the cap.
    const start = addDays(weekStart(today), -14);
    for (let d = start; d < today; d = addDays(d, 1)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      for (const [k, it] of itemIds.entries()) {
        if (it.status === 'new' || it.status === 'withdrawn') continue;
        const seedNum = (Number(d.slice(8)) + k * 3) % 5;
        if (seedNum > 2) continue;
        const code = it.codes[seedNum % it.codes.length];
        const hours = [1.5, 2, 2.5][seedNum];
        await q(`INSERT INTO time_entries(work_item_id, user_id, category_id, work_date, hours, note) VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT DO NOTHING`,
          [it.id, it.owner, cats[code], d, hours, seedNum === 0 ? `Worked on ${code} for this item` : '']);
      }
    }

    // History: one completed item per past month (6 months), so month-level charts have a trend.
    const owners = ['Ben Tan', 'Chen Wei', 'Divya Nair', 'Asha Rao'];
    for (let m = 6; m >= 1; m--) {
      const [y, mo] = today.slice(0, 7).split('-').map(Number);
      const first = new Date(Date.UTC(y, mo - 1 - m, 1)).toISOString().slice(0, 10);
      const last = new Date(Date.UTC(y, mo - m, 0)).toISOString().slice(0, 10);
      const title = HISTORY[6 - m];
      const owner = owners[m % owners.length];
      let total = 0;
      const [w] = await q(
        `INSERT INTO work_items(reference, title, description, primary_category_id, status_code, owner_id, approved_hours, estimated_hours, target_date)
         VALUES ($1, $2, $3, $4, 'done', $5, 0, 0, $6) RETURNING id`,
        [`WI-${String(100 + m).padStart(4, '0')}`, title, `Demo work item: ${title.toLowerCase()}.`, cats.dev, user[owner], last]);
      for (const code of ['analysis', 'dev', 'testing']) {
        await q('INSERT INTO work_item_categories(work_item_id, category_id) VALUES ($1, $2)', [w.id, cats[code]]);
        await q(`INSERT INTO group_states(work_item_id, category_id, sub_status_code) VALUES ($1, $2, 'completed')`, [w.id, cats[code]]);
      }
      for (let d = first; d <= last; d = addDays(d, 1)) {
        const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
        if (dow === 0 || dow === 6) continue;
        const n = Number(d.slice(8));
        const code = n < 10 ? 'analysis' : n < 22 ? 'dev' : 'testing';
        const hours = [2, 3, 4, 2.5, 3.5][(n + m) % 5];
        await q('INSERT INTO time_entries(work_item_id, user_id, category_id, work_date, hours) VALUES ($1, $2, $3, $4, $5)',
          [w.id, user[owner], cats[code], d, hours]);
        total += hours;
      }
      await q('UPDATE work_items SET approved_hours = $1, estimated_hours = $2 WHERE id = $3', [Math.ceil(total * 1.1), Math.ceil(total), w.id]);
    }

    const [first] = itemIds;
    await q(`INSERT INTO work_item_links(work_item_id, title, url, added_by) VALUES
      ($1, 'Source-to-target mapping (demo)', 'https://example.com/specs/customer-dimension', $2),
      ($1, 'Data quality dashboard (demo)', 'https://example.com/dashboards/dq', $3)`, [first.id, user['Divya Nair'], user['Asha Rao']]);
    for (const [it, who] of [[itemIds[0], 'Asha Rao'], [itemIds[0], 'Ben Tan'], [itemIds[1], 'Asha Rao'], [itemIds[3], 'Chen Wei']]) {
      await q('INSERT INTO work_item_watchers(work_item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [it.id, user[who]]);
    }
    await q('INSERT INTO comments(work_item_id, category_id, body, author_id) VALUES ($1, NULL, $2, $3)',
      [first.id, 'Kick-off done. Target is end of next sprint.', user['Asha Rao']]);
    await q('INSERT INTO comments(work_item_id, category_id, body, author_id) VALUES ($1, $2, $3, $4)',
      [first.id, cats.analysis, 'Source-to-target mapping signed off.', user['Divya Nair']]);
    await q('INSERT INTO comments(work_item_id, category_id, body, author_id) VALUES ($1, $2, $3, $4)',
      [first.id, cats.dev, 'SCD2 merge logic in place; testing next.', user['Divya Nair']]);

    for (const [ref, desc, owner, status, offset] of SUPPORT) {
      const [t] = await q('INSERT INTO support_tasks(reference, description, status, owner_id, target_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [ref, desc, status, user[owner], addDays(today, offset)]);
      await q(`INSERT INTO support_activity(task_id, kind, body, author_id) VALUES ($1, 'state', 'Opened', $2)`, [t.id, user['Asha Rao']]);
      if (status !== 'queued') {
        await q(`INSERT INTO support_activity(task_id, kind, body, author_id) VALUES ($1, 'status', $2, $3)`, [t.id, `Queued → ${status === 'in_progress' ? 'In Progress' : status === 'hold' ? 'Hold' : 'Done'}`, user[owner]]);
      }
      await q(`INSERT INTO support_activity(task_id, kind, body, author_id) VALUES ($1, 'comment', $2, $3)`, [t.id, 'Looking into this.', user[owner]]);
    }
  });
  return true;
}

module.exports = { seed };
