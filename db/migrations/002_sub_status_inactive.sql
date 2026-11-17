-- 002: sub-statuses get the same lookup shape as statuses (code, label, sortOrder, isTerminal, isInactive)
ALTER TABLE sub_statuses ADD COLUMN IF NOT EXISTS is_inactive BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE sub_statuses SET is_inactive = TRUE WHERE code = 'not_needed';
