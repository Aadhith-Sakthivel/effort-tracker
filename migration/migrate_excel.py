"""Migrate an Enhancements Daily Tracker workbook into the normalized DB.

Usage (from project root):
    cd backend && pip install -r requirements.txt && cd ..
    python migration/migrate_excel.py "C:/path/to/Enhancements Daily Tracker.xlsx"

Idempotent: tickets/resources are upserted by natural key; effort rows are
replaced for the migrated date range. Run against SQLite locally (default) or
set DATABASE_URL / PG* env vars to load Lakebase.
"""
from __future__ import annotations

import re
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import func, select

import openpyxl

# Make the backend package importable.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import (  # noqa: E402
    Effort, Enhancement, Grp, Resource, SkillCategory, SessionLocal, Status,
    SubStatus, enhancement_group, init_db,
)

# --- Canonical lookup seeds ------------------------------------------------
# (code, label). The daily grid pollutes groups with combos like "DW/DE/DS" and
# a stray-apostrophe "DW/DE/DS/BI'"; normalize_grp() collapses those to the primary.
# Each is a single, atomic group. Combinations like "BI+DW" are NOT groups —
# they mean the enhancement belongs to BOTH BI and DW (handled by parse_groups).
GRP_LABELS = {
    "DBX": "Databricks", "DW": "Data Warehouse", "DE": "Data Engineering",
    "BI": "Business Intelligence", "DS": "DataStage",
    "TDV": "TDV", "STR": "Streaming", "TUN": "Tuning", "MIG": "Migration", "MDM": "MDM",
}
GRPS = list(GRP_LABELS.keys())


def parse_groups(raw):
    """Split a raw group string into a list of atomic canonical codes.

    e.g. "BI+DW" -> ["BI", "DW"], "DW/DE/DS" -> ["DW", "DE", "DS"].
    """
    if not raw:
        return []
    s = str(raw).strip().replace("'", "").replace('"', "").upper()
    out = []
    for tok in re.split(r"[\/+,\s]+", s):
        tok = tok.strip()
        if tok and tok in GRP_LABELS and tok not in out:
            out.append(tok)
    return out


def normalize_grp(raw):
    """Primary (first) canonical group code for the raw string."""
    g = parse_groups(raw)
    return g[0] if g else None


def ensure_groups(db, raw):
    """Return Grp objects for every group in the raw string, creating as needed."""
    objs = []
    for code in parse_groups(raw):
        g = db.get(Grp, code)
        if not g:
            g = Grp(code=code, label=GRP_LABELS.get(code, code), sort_order=500)
            db.add(g)
            db.flush()
        objs.append(g)
    return objs
# (code, is_terminal, is_inactive). Completed/Cancelled/Withdrawn are terminal AND
# inactive — they drop out of the default (active) views.
STATUSES = [
    ("Requested", False, False), ("In Progress Internal", False, False), ("In Progress Vendor", False, False),
    ("UAT", False, False), ("Completed", True, True),
    ("Cancelled", True, True), ("Withdrawn", True, True),
]
SUB_STATUSES = [
    "Assessment", "Assessment Needs IA", "BP Hold", "IT Director Hold",
    "In Progress Internal Modeling", "Modeling Hold", "Priority Hold", "System Testing",
    "UAT", "UnCommitted", "Waiting Assessment", "Waiting BP", "Working",
]
SKILLS = [
    "DataStage", "Mainframe", "OAC", "Spotfire", "TDV", "Airflow", "Power BI",
    "Teradata", "Alteryx", "MDM", "Data Engineering", "SQL", "SSIS", "KT/Analysis",
]

# Normalize spelling drift found in the workbook.
STATUS_ALIAS = {"Canceled": "Cancelled", "Cancelled": "Cancelled", "Complete": "Completed",
                "Withdraw": "Withdrawn", "Withdrawn": "Withdrawn"}


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def seed_lookups(db):
    for i, c in enumerate(GRPS):
        if not db.get(Grp, c):
            db.add(Grp(code=c, label=GRP_LABELS[c], sort_order=i))
    for i, (c, term, inact) in enumerate(STATUSES):
        s = db.get(Status, c)
        if not s:
            db.add(Status(code=c, label=c, is_terminal=term, is_inactive=inact, sort_order=i))
        else:
            s.is_terminal, s.is_inactive = term, inact
    for i, c in enumerate(SUB_STATUSES):
        if not db.get(SubStatus, c):
            db.add(SubStatus(code=c, label=c, sort_order=i))
    for i, c in enumerate(SKILLS):
        if not db.get(SkillCategory, c):
            db.add(SkillCategory(code=c, label=c, sort_order=i))
    db.commit()


_CANON_STATUS = {c.lower(): c for c, _, _ in STATUSES}


def ensure_status(db, raw):
    if not raw:
        return None
    code = STATUS_ALIAS.get(str(raw).strip(), str(raw).strip())
    # Fold case-variant duplicates (e.g. "completed") into the canonical status.
    code = _CANON_STATUS.get(code.lower(), code)
    if not db.get(Status, code):
        db.add(Status(code=code, label=code, sort_order=500))
        db.flush()
    return code


# Fold Excel misspellings / non-sub-status values into the canonical set.
SUB_STATUS_ALIAS = {
    "Assesment": "Assessment",
    "Waiting Assesment": "Waiting Assessment",
    "UAT--> We need to wait for Buisness": "UAT",
}
_SUB_DROP = {"Canceled", "Cancelled"}            # these are statuses, not sub-statuses
_CANON_SUB = {s.lower(): s for s in SUB_STATUSES}


def ensure_sub_status(db, raw):
    if not raw:
        return None
    code = str(raw).strip()
    code = SUB_STATUS_ALIAS.get(code, code)
    if code in _SUB_DROP:
        return None
    code = _CANON_SUB.get(code.lower(), code)     # fold case variants
    if not db.get(SubStatus, code):
        db.add(SubStatus(code=code, label=code, sort_order=500))
        db.flush()
    return code


def ensure_grp(db, raw):
    code = normalize_grp(raw)
    if not code:
        return None
    if not db.get(Grp, code):
        db.add(Grp(code=code, label=GRP_LABELS.get(code, code), sort_order=500))
        db.flush()
    return code


def import_resources(db, wb):
    ws = wb["Resources"]
    n = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = row[1]
        if not name or not str(name).strip():
            continue
        name = str(name).strip()
        racf = str(row[2]).strip() if row[2] else None
        existing = None
        if racf:
            existing = db.query(Resource).filter_by(racf=racf).first()
        if not existing:
            existing = db.query(Resource).filter_by(name=name).first()
        if not existing:
            db.add(Resource(name=name, racf=racf,
                            skills=str(row[3]).strip() if row[3] else None,
                            location=str(row[4]).strip() if row[4] else None,
                            cell=str(row[5]).strip() if len(row) > 5 and row[5] else None))
            n += 1
    db.commit()
    print(f"  resources imported: {n}")


def import_enhancements_master(db, wb):
    """Primary source: 'DO NOT UPDATE Enhancement' (has estimates/approved/comments)."""
    ws = wb["DO NOT UPDATE Enhancement"]
    n = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        grp, ticket, title, status, sub_status, lead = row[0], row[1], row[2], row[3], row[4], row[5]
        if not ticket or not str(ticket).strip().upper().startswith("EN"):
            continue
        ticket = str(ticket).strip()
        e = db.query(Enhancement).filter_by(ticket=ticket).first()
        if not e:
            e = Enhancement(ticket=ticket, title=str(title).strip() if title else ticket)
            db.add(e)
            n += 1
        e.title = str(title).strip() if title else e.title or ticket
        e.grp_code = ensure_grp(db, grp)
        e.groups = ensure_groups(db, grp)
        e.status_code = ensure_status(db, status)
        e.sub_status_code = ensure_sub_status(db, sub_status)
        e.smoc_lead = str(lead).strip() if lead else None
        e.initial_estimated_hrs = _num(row[6])
        e.approved_hrs = _num(row[7])
        e.comments = str(row[10]).strip() if len(row) > 10 and row[10] else None
    db.commit()
    print(f"  enhancements (master) imported/updated: {n}")


def import_daily_efforts(db, wb):
    """Un-pivot the 541-column 'Daily Efforts Tracker' grid into effort rows."""
    ws = wb["Daily Efforts Tracker"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    header = rows[0]
    # Find where the date columns begin.
    date_cols: list[tuple[int, date]] = []
    for idx, val in enumerate(header):
        if isinstance(val, datetime):
            date_cols.append((idx, val.date()))
    print(f"  daily grid: {len(date_cols)} date columns detected")

    new_enh = 0
    effort_rows = 0
    for r in rows[1:]:
        ticket = r[1]
        if not ticket or not str(ticket).strip().upper().startswith("EN"):
            continue
        ticket = str(ticket).strip()
        e = db.query(Enhancement).filter_by(ticket=ticket).first()
        if not e:
            e = Enhancement(ticket=ticket, title=str(r[3]).strip() if r[3] else ticket,
                            grp_code=ensure_grp(db, r[0]),
                            demand_number=str(r[2]).strip() if r[2] else None,
                            status_code=ensure_status(db, r[6]),
                            sub_status_code=ensure_sub_status(db, r[7]))
            db.add(e)
            db.flush()
            e.groups = ensure_groups(db, r[0])
            new_enh += 1
        else:
            if not e.demand_number and r[2]:
                e.demand_number = str(r[2]).strip()
            if not e.groups:
                e.groups = ensure_groups(db, r[0])

        # Clear previously migrated (resource-less, skill-less) rows for this ticket, then reload.
        db.query(Effort).filter_by(enhancement_id=e.id, resource_id=None, skill_code=None).delete()
        for col_idx, d in date_cols:
            hrs = _num(r[col_idx]) if col_idx < len(r) else None
            if hrs and hrs > 0:
                db.add(Effort(enhancement_id=e.id, resource_id=None, skill_code=None,
                              work_date=d, hours=min(hrs, 100), note="migrated from Excel"))
                effort_rows += 1
    db.commit()
    print(f"  enhancements (from daily grid) added: {new_enh}")
    print(f"  effort rows created: {effort_rows}")


def main():
    if len(sys.argv) < 2:
        print("usage: python migration/migrate_excel.py <path-to-xlsx>")
        sys.exit(1)
    path = sys.argv[1]
    print(f"Loading workbook: {path}")
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)

    init_db()  # ensure tables exist (SQLite/dev)
    db = SessionLocal()
    try:
        print("Seeding lookups...");       seed_lookups(db)
        print("Importing resources...");   import_resources(db, wb)
        # Rebuild group memberships authoritatively from the workbook each run.
        db.execute(enhancement_group.delete()); db.commit()
        print("Importing enhancements..."); import_enhancements_master(db, wb)
        print("Un-pivoting daily grid..."); import_daily_efforts(db, wb)
        multi = db.execute(
            select(enhancement_group.c.enhancement_id).group_by(enhancement_group.c.enhancement_id)
            .having(func.count() > 1)
        ).all()
        print(f"Done. ({len(multi)} enhancements span multiple groups)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
