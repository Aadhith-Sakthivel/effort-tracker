-- Effort Tracker — Lakebase (PostgreSQL) schema
-- Replaces the 13-sheet Excel workbook with a normalized, logged, validated model.
-- Safe to run repeatedly (idempotent-ish via IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- Lookup tables (drive dropdowns; eliminate free-text drift)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grp (
    code        TEXT PRIMARY KEY,          -- DBX, DW, BI, BI+DW, TDV, STR, TUN, MIG
    label       TEXT NOT NULL,
    sort_order  INT  NOT NULL DEFAULT 100,
    active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS status (
    code        TEXT PRIMARY KEY,          -- Requested, In Progress Internal, In Progress Vendor, UAT, Completed, Cancelled, Withdrawn
    label       TEXT NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    is_inactive BOOLEAN NOT NULL DEFAULT FALSE,  -- Cancelled/Withdrawn => hidden from active views
    sort_order  INT  NOT NULL DEFAULT 100,
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sub_status (
    code        TEXT PRIMARY KEY,          -- Assessment, BP Hold, Priority Hold, Working, ...
    label       TEXT NOT NULL,
    sort_order  INT  NOT NULL DEFAULT 100,
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS skill_category (
    code        TEXT PRIMARY KEY,          -- DataStage, Mainframe, OAC, Spotfire, TDV, Airflow, Power BI, Teradata, Alteryx, MDM, Data Engineering, SQL, SSIS, KT/Analysis
    label       TEXT NOT NULL,
    sort_order  INT  NOT NULL DEFAULT 100,
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- Resources (team members)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resource (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    racf        TEXT UNIQUE,
    skills      TEXT,
    location    TEXT,                       -- Onshore / Offshore
    cell        TEXT,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    is_lead     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Enhancements (the tickets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enhancement (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket                TEXT UNIQUE NOT NULL,          -- EN2510473
    grp_code              TEXT REFERENCES grp(code),
    demand_number         TEXT,
    title                 TEXT NOT NULL,
    status_code           TEXT REFERENCES status(code),
    sub_status_code       TEXT REFERENCES sub_status(code),
    lead_resource_id      BIGINT REFERENCES resource(id),
    smoc_lead             TEXT,                          -- free text fallback (e.g. "Atin/Gaurav")
    initial_estimated_hrs NUMERIC(10,2),
    approved_hrs          NUMERIC(10,2),
    comments              TEXT,
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_enh_status ON enhancement(status_code);
CREATE INDEX IF NOT EXISTS ix_enh_grp    ON enhancement(grp_code);

-- An enhancement can span several groups (e.g. BI and DW).
CREATE TABLE IF NOT EXISTS enhancement_group (
    enhancement_id BIGINT NOT NULL REFERENCES enhancement(id) ON DELETE CASCADE,
    grp_code       TEXT   NOT NULL REFERENCES grp(code),
    PRIMARY KEY (enhancement_id, grp_code)
);
CREATE INDEX IF NOT EXISTS ix_eg_grp ON enhancement_group(grp_code);

-- Several resources can be assigned to one enhancement (the Lead stays single,
-- stored on enhancement.lead_resource_id).
CREATE TABLE IF NOT EXISTS enhancement_resource (
    enhancement_id BIGINT NOT NULL REFERENCES enhancement(id) ON DELETE CASCADE,
    resource_id    BIGINT NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    PRIMARY KEY (enhancement_id, resource_id)
);
CREATE INDEX IF NOT EXISTS ix_er_res ON enhancement_resource(resource_id);

-- Skills involved in an enhancement; time can be logged per skill.
CREATE TABLE IF NOT EXISTS enhancement_skill (
    enhancement_id BIGINT NOT NULL REFERENCES enhancement(id) ON DELETE CASCADE,
    skill_code     TEXT   NOT NULL REFERENCES skill_category(code),
    PRIMARY KEY (enhancement_id, skill_code)
);

-- ---------------------------------------------------------------------------
-- Daily effort — ONE ROW per (enhancement, resource, date). Replaces 541 columns.
-- Actual hrs = SUM(effort.hours); Remaining = approved_hrs - actual.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS effort (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enhancement_id   BIGINT NOT NULL REFERENCES enhancement(id) ON DELETE CASCADE,
    resource_id      BIGINT REFERENCES resource(id),
    grp_code         TEXT REFERENCES grp(code),           -- which group this effort is for
    skill_code       TEXT REFERENCES skill_category(code),
    work_date        DATE NOT NULL,
    -- DB guards against fat-finger entries; the API caps interactive single-person
    -- entry at 24h. Migrated per-ticket daily aggregates can be larger, so allow up to 100.
    hours            NUMERIC(6,2) NOT NULL CHECK (hours >= 0 AND hours <= 100),
    note             TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (enhancement_id, resource_id, grp_code, skill_code, work_date)
);
CREATE INDEX IF NOT EXISTS ix_effort_enh  ON effort(enhancement_id);
CREATE INDEX IF NOT EXISTS ix_effort_date ON effort(work_date);
CREATE INDEX IF NOT EXISTS ix_effort_res  ON effort(resource_id);

-- ---------------------------------------------------------------------------
-- Append-only audit log — answers "who changed what, when, old -> new".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type   TEXT NOT NULL,            -- enhancement | resource | effort
    entity_id     BIGINT,
    entity_label  TEXT,                     -- human-readable (ticket+date, resource name…)
    action        TEXT NOT NULL,            -- create | update | delete
    field         TEXT,                     -- NULL for create/delete (whole row)
    old_value     TEXT,
    new_value     TEXT,
    changed_by    TEXT NOT NULL,            -- workspace user email (from SSO header)
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_when   ON audit_log(changed_at DESC);

-- ---------------------------------------------------------------------------
-- Convenience view: enhancement with computed actual / remaining hours
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_enhancement_rollup AS
SELECT e.*,
       COALESCE(ef.actual_hrs, 0)                             AS actual_hrs,
       COALESCE(e.approved_hrs, 0) - COALESCE(ef.actual_hrs,0) AS remaining_hrs
FROM enhancement e
LEFT JOIN (
    SELECT enhancement_id, SUM(hours) AS actual_hrs
    FROM effort GROUP BY enhancement_id
) ef ON ef.enhancement_id = e.id;
