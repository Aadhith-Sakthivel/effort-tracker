-- 001: initial schema

CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  login_id     TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member', 'viewer')),
  location     TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  skills       TEXT NOT NULL DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_login_uq ON users (lower(login_id));

-- Lookups. Work-item statuses are configurable by leads.
CREATE TABLE statuses (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  is_inactive BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE sub_statuses (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE work_items (
  id                  SERIAL PRIMARY KEY,
  reference           TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  primary_category_id INT,
  status_code         TEXT NOT NULL REFERENCES statuses(code),
  sub_status_code     TEXT REFERENCES sub_statuses(code),
  owner_id            INT REFERENCES users(id) ON DELETE SET NULL,
  estimated_hours     NUMERIC(8, 2),
  approved_hours      NUMERIC(8, 2),
  target_date         DATE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX work_items_reference_uq ON work_items (lower(reference));

-- A category is global (owner_work_item_id NULL) or a custom one owned by a single work item.
CREATE TABLE categories (
  id                 SERIAL PRIMARY KEY,
  code               TEXT NOT NULL,
  label              TEXT NOT NULL,
  sort_order         INT NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom          BOOLEAN NOT NULL DEFAULT FALSE,
  owner_work_item_id INT REFERENCES work_items(id) ON DELETE CASCADE,
  CHECK (is_custom = (owner_work_item_id IS NOT NULL))
);
CREATE UNIQUE INDEX categories_global_code_uq ON categories (lower(code)) WHERE owner_work_item_id IS NULL;
CREATE UNIQUE INDEX categories_custom_code_uq ON categories (owner_work_item_id, lower(code)) WHERE owner_work_item_id IS NOT NULL;

ALTER TABLE work_items
  ADD CONSTRAINT work_items_primary_category_fk FOREIGN KEY (primary_category_id) REFERENCES categories(id) ON DELETE SET NULL;

CREATE TABLE work_item_categories (
  work_item_id INT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  category_id  INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (work_item_id, category_id)
);

-- Per-item, per-category sub-status, independent of the item's overall status.
CREATE TABLE group_states (
  work_item_id    INT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  category_id     INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sub_status_code TEXT NOT NULL REFERENCES sub_statuses(code),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, category_id)
);

-- One row per person, item, category and day, so a timesheet cell maps to exactly one row.
CREATE TABLE time_entries (
  id           SERIAL PRIMARY KEY,
  work_item_id INT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id),
  category_id  INT NOT NULL REFERENCES categories(id),
  work_date    DATE NOT NULL,
  hours        NUMERIC(5, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, user_id, category_id, work_date)
);
CREATE INDEX time_entries_user_date_idx ON time_entries (user_id, work_date);

-- category_id NULL = a card-level comment that shows on every category tab.
CREATE TABLE comments (
  id           SERIAL PRIMARY KEY,
  work_item_id INT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  category_id  INT REFERENCES categories(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  author_id    INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_item_idx ON comments (work_item_id);

CREATE TABLE support_tasks (
  id          SERIAL PRIMARY KEY,
  reference   TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_progress', 'hold', 'done', 'cancelled')),
  owner_id    INT REFERENCES users(id) ON DELETE SET NULL,
  target_date DATE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX support_tasks_reference_uq ON support_tasks (lower(reference));

CREATE TABLE support_activity (
  id         SERIAL PRIMARY KEY,
  task_id    INT NOT NULL REFERENCES support_tasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('comment', 'status', 'state')),
  body       TEXT NOT NULL,
  author_id  INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_activity_task_idx ON support_activity (task_id);

CREATE TABLE audit_entries (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  actor       TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entries_entity_idx ON audit_entries (entity_type, changed_at DESC);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO statuses (code, label, sort_order, is_terminal, is_inactive) VALUES
  ('new',         'New',         10, FALSE, FALSE),
  ('in_progress', 'In Progress', 20, FALSE, FALSE),
  ('in_review',   'In Review',   30, FALSE, FALSE),
  ('done',        'Done',        40, TRUE,  FALSE),
  ('cancelled',   'Cancelled',   50, TRUE,  TRUE),
  ('withdrawn',   'Withdrawn',   60, TRUE,  TRUE);

INSERT INTO sub_statuses (code, label, sort_order, is_terminal) VALUES
  ('not_started', 'Not Started', 10, FALSE),
  ('in_progress', 'In Progress', 20, FALSE),
  ('blocked',     'Blocked',     30, FALSE),
  ('completed',   'Completed',   40, TRUE),
  ('not_needed',  'Not Needed',  50, TRUE);

INSERT INTO categories (code, label, sort_order) VALUES
  ('analysis', 'Analysis',      10),
  ('dev',      'Development',   20),
  ('testing',  'Testing',       30),
  ('deploy',   'Deployment',    40),
  ('docs',     'Documentation', 50);

-- daily_hour_cap: max hours per person per day.
-- A week (Mon–Sun) freezes on freeze_weekday of the following week (1 = Monday) at freeze_hour, business time.
INSERT INTO settings (key, value) VALUES
  ('daily_hour_cap', '10'),
  ('freeze_weekday', '1'),
  ('freeze_hour',    '18');
