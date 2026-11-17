-- 003: richer work items — reference links and watchers

CREATE TABLE IF NOT EXISTS work_item_links (
  id           SERIAL PRIMARY KEY,
  work_item_id INT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL CHECK (url ~* '^https?://'),
  added_by     INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_item_links_item_idx ON work_item_links (work_item_id);

CREATE TABLE IF NOT EXISTS work_item_watchers (
  work_item_id INT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, user_id)
);
