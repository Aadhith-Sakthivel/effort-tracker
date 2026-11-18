"""Seed the Effort Tracker with fictional demo data at a realistic volume.

Everything here is made up — no real people, emails, tickets or client data.
Deterministic (fixed RNG seed) so re-runs produce the same database.

Runs against whatever the app is configured for:
  - Local (default):  SQLite  ams_local.db
  - Lakebase (PG*):   set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODE first

Usage:
    python migration/seed_dummy.py            # seed only if the DB looks empty
    python migration/seed_dummy.py --reset     # wipe app data first, then seed

The demo lead login is the first ADMIN_EMAILS entry (see app.yaml).
"""
from __future__ import annotations

import os
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import delete, func, select  # noqa: E402

from app.db import (  # noqa: E402
    AppSetting, AuditLog, EnhComment, EnhGroupState, EnhLink, Effort, Enhancement,
    Grp, Resource, SessionLocal, SkillCategory, Status, SubStatus, SupportComment,
    SupportTicket, enhancement_group, enhancement_resource, enhancement_skill,
    init_db, support_ticket_resource,
)

# The demo lead is the first ADMIN_EMAILS entry (set at deploy time), so the owner logs in as lead.
LEAD_EMAIL = (os.environ.get("ADMIN_EMAILS") or "lead@example.com").split(",")[0].strip()
RNG = random.Random(42)
TODAY = date(2026, 11, 17)

# --- Lookups (neutralised labels; generic tool names kept as-is) ----------
GROUPS = [  # code, label, sort, active, is_custom
    ("DBX", "Databricks", 0, 1, 0), ("DW", "Data Warehouse", 1, 1, 0),
    ("DE", "Data Engineering", 2, 1, 0), ("BI", "Business Intelligence", 3, 1, 0),
    ("DS", "DataStage", 5, 1, 0), ("TDV", "TDV", 6, 1, 0), ("STR", "Streaming", 7, 1, 0),
    ("TUN", "Tuning", 8, 1, 0), ("MIG", "Migration", 9, 1, 0), ("MDM", "MDM", 10, 1, 0),
]
ACTIVE_GROUPS = [g[0] for g in GROUPS]

STATUSES = [  # code, label, is_terminal, is_inactive, sort
    ("Assesment", "Assessment", 0, 0, 1),
    ("In Progress Internal", "In Progress Internal", 0, 0, 2),
    ("In Progress Vendor", "In Progress Vendor", 0, 0, 3),
    ("BP HOLD", "Hold", 0, 0, 4),
    ("UAT", "UAT", 0, 0, 5),
    ("Completed", "Completed", 1, 1, 6),
    ("Cancelled", "Cancelled", 1, 1, 7),
    ("Withdrawn", "Withdrawn", 1, 1, 8),
    ("Requested", "Requested", 0, 1, 100),
]
SUB_STATUSES = [
    "Assessment", "Assessment Needs IA", "BP Hold", "IT Director Hold",
    "In Progress Internal Modeling", "Modeling Hold", "Priority Hold", "System Testing",
    "UAT", "UnCommitted", "Waiting Assessment", "Waiting BP", "Working",
    "Completed", "Waiting Upstream Changes", "Waiting DBX", "Withdrawn",
]
SKILLS = [
    "DataStage", "Mainframe", "OAC", "Spotfire", "TDV", "Airflow", "Power BI",
    "Teradata", "Alteryx", "MDM", "Data Engineering", "SQL", "SSIS", "KT/Analysis",
]

# --- Fictional people -----------------------------------------------------
# name, location, is_lead, active, skills
PEOPLE = [
    ("Maya Fernandez", "Onshore", 1, 1, "DBX, AWS, SQL"),
    ("Daniel Okafor", "Onshore", 0, 1, "Teradata, SQL, DBX, AWS"),
    ("Priya Nair", "Onshore", 1, 1, "BI/DW"),
    ("Lucas Meyer", "Onshore", 0, 1, "DBX, AWS, PySpark, SQL"),
    ("Hana Kim", "Onshore", 0, 1, "DBX, AWS, SSIS, SQL, Python"),
    ("Omar Haddad", "Offshore", 1, 0, "TD, SQL, DBX, AWS, Kafka"),
    ("Sofia Rossi", "Offshore", 1, 1, "DBX, AWS, PySpark, SQL"),
    ("Arjun Mehta", "Offshore", 0, 0, "Tower lead, TD & DBX"),
    ("Elena Petrova", "Offshore", 0, 1, "DBX, AWS, PySpark, SQL, Python"),
    ("Tomas Silva", "Offshore", 0, 0, "OAC, OBIEE, OAS, OTBI, DWH"),
    ("Ingrid Johansson", "Offshore", 0, 1, "Python, PySpark, Power BI, OAC"),
    ("Rahul Verma", "Offshore", 0, 1, "Spotfire, Tableau, Power BI, DS"),
    ("Chloe Dubois", "Offshore", 0, 0, "MDM, SQL"),
    ("Kenji Tanaka", "Offshore", 0, 1, "DS, SQL, DBX"),
    ("Amara Nwosu", "Offshore", 0, 1, "DBX, AWS, SQL, PySpark"),
    ("Diego Alvarez", "Offshore", 0, 1, "Mainframe"),
    ("Leila Karimi", "Offshore", 0, 1, "DBX, AWS, PySpark, SQL"),
    ("Nikhil Rao", "Offshore", 0, 1, "DBX, SQL, PySpark"),
    ("Grace Liang", "Offshore", 0, 0, "Mainframe (COBOL, JCL, DB2), SQL, Teradata"),
    ("Mateo Romano", "Offshore", 1, 1, "Mainframe, Teradata"),
    ("Fatima Zahra", "Offshore", 0, 0, "Mainframe (JCL, COBOL, DB2, VSAM), Teradata"),
    ("Sanjay Kulkarni", "Offshore", 0, 1, "Reporting"),
    ("Aadhith Kumar", "Offshore", 1, 1, "DBX, AWS, SQL, TD, DS, AI"),  # portfolio owner (lead)
    ("Yuki Sato", "Offshore", 0, 1, "DBX, SQL, PySpark"),
    ("Pavel Novak", "Offshore", 0, 1, "TL, Power BI, ServiceNow, ADF, SSIS, SQL, Spotfire, Tableau"),
    ("Ritu Desai", "Onshore", 1, 1, "SQL, MF"),
]

# --- Title generation -----------------------------------------------------
ACTIONS = [
    "Rebuild", "Migrate", "Optimize", "Refactor", "Automate", "Validate", "Backfill",
    "Enhance", "Consolidate", "Document", "Re-platform", "Tune", "Add data-quality rules to",
    "Build a dashboard for", "Create gold layer for", "Decommission legacy",
]
OBJECTS = [
    "customer dimension", "nightly sales aggregate", "inventory snapshot pipeline",
    "order facts table", "monthly finance extract", "churn feature table",
    "shipment tracking feed", "weekly KPI gold table", "vendor spend report",
    "payroll data feed", "clickstream events load", "product catalog sync",
    "pricing model inputs", "demand forecast dataset", "returns pipeline",
    "loyalty program metrics", "fraud signal features", "supplier scorecard",
    "asset registry", "route optimization dataset", "fuel usage report",
    "maintenance log ingestion", "safety incident mart", "headcount rollup",
    "budget variance report", "data retention rules", "reconciliation template",
    "late-arriving data handling", "pipeline alerting rules", "access-request workflow",
]
SMOC_NAMES = ["Maya", "Priya", "Arjun", "Sofia", "Rahul", "Diego", "Mateo",
              "Aadhith", "Ritu", "Nikhil", "Amara/Lucas", "Priya/Maya", "Sanjay"]
COMMENTS = [
    None, None, None,
    "Waiting on upstream team to confirm the schema.",
    "Estimate: ~40h (8h build, 32h testing).",
    "11/04: owner will update once ready.",
    "Kicked off; target end of next sprint.",
    "Blocked on access request, follow-up raised.",
    "In review with the business partner.",
    "Testing in progress, no blockers.",
]


def _racf(i: int) -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(RNG.choice(chars) for _ in range(5))


def _email(name: str) -> str:
    first, *rest = name.lower().replace("/", " ").split()
    last = rest[-1] if rest else "user"
    return f"{first}.{last}@example.com"


def _reset(db):
    # Children first, then parents, then lookups.
    for stmt in (
        delete(support_ticket_resource), delete(SupportComment), delete(SupportTicket),
        delete(AuditLog), delete(EnhLink), delete(EnhComment), delete(EnhGroupState),
        delete(enhancement_skill), delete(enhancement_resource), delete(enhancement_group),
        delete(Effort), delete(Enhancement), delete(Resource), delete(AppSetting),
        delete(SkillCategory), delete(SubStatus), delete(Status), delete(Grp),
    ):
        db.execute(stmt)
    db.commit()


def main():
    reset = "--reset" in sys.argv[1:]
    init_db()
    db = SessionLocal()
    try:
        existing = db.scalar(select(func.count()).select_from(Enhancement)) or 0
        if existing and not reset:
            print(f"DB already has {existing} enhancements — pass --reset to re-seed. Nothing done.")
            return
        if reset:
            _reset(db)

        # Lookups
        for code, label, sort, active, custom in GROUPS:
            db.add(Grp(code=code, label=label, sort_order=sort, active=bool(active), is_custom=bool(custom)))
        for code, label, term, inact, sort in STATUSES:
            db.add(Status(code=code, label=label, is_terminal=bool(term), is_inactive=bool(inact),
                          sort_order=sort, active=True))
        for i, s in enumerate(SUB_STATUSES):
            db.add(SubStatus(code=s, label=s, sort_order=i, active=True))
        for i, s in enumerate(SKILLS):
            db.add(SkillCategory(code=s, label=s, sort_order=i, active=True))
        db.flush()

        # Resources
        resources: list[Resource] = []
        for i, (name, loc, lead, active, skills) in enumerate(PEOPLE):
            owner = name == "Aadhith Kumar"
            email = LEAD_EMAIL if owner else (_email(name) if (active and (lead or RNG.random() > 0.3)) else None)
            cc = ("+1 " if loc == "Onshore" else "+91 ") + f"{RNG.randint(60,99)}{RNG.randint(1000000,9999999)}"
            r = Resource(name=name, racf=_racf(i), email=email, skills=skills, location=loc,
                         cell=cc, active=bool(active), is_lead=bool(lead))
            db.add(r)
            resources.append(r)
        db.flush()
        leads = [r for r in resources if r.is_lead and r.active]
        active_res = [r for r in resources if r.active]

        # Enhancements
        status_pool = (["In Progress Internal"] * 5 + ["In Progress Vendor"] * 4 +
                       ["UAT"] * 3 + ["Assesment"] * 2 + ["BP HOLD"] * 2 +
                       ["Completed"] * 5 + ["Requested"] * 2 + ["Cancelled"] + ["Withdrawn"])
        inactive_status = {"Completed", "Cancelled", "Withdrawn"}
        enh_list: list[Enhancement] = []
        base_ticket = 2510473
        titles_used = set()
        for n in range(154):
            while True:
                t = f"{RNG.choice(ACTIONS)} {RNG.choice(OBJECTS)}"
                if t not in titles_used or len(titles_used) > 140:
                    break
            titles_used.add(t)
            status = status_pool[n % len(status_pool)] if n else "UAT"
            grp = RNG.choice(ACTIVE_GROUPS)
            lead_res = RNG.choice(leads) if RNG.random() > 0.3 else None
            approved = RNG.choice([8, 10, 16, 20, 24, 30, 40, 60, 80, 120])
            est = max(4, int(approved * RNG.choice([0.7, 0.8, 0.9, 1.0, 1.1])))
            eta = TODAY + timedelta(days=RNG.randint(-30, 45))
            e = Enhancement(
                ticket=f"EN{base_ticket - n}", grp_code=grp, title=t, status_code=status,
                sub_status_code=(RNG.choice(SUB_STATUSES) if RNG.random() > 0.5 else None),
                lead_resource_id=(lead_res.id if lead_res else None),
                smoc_lead=(RNG.choice(SMOC_NAMES) if RNG.random() > 0.3 else None),
                initial_estimated_hrs=est, approved_hrs=approved,
                comments=RNG.choice(COMMENTS),
                change_ticket=(f"CHG{RNG.randint(2200000,2299999)}" if RNG.random() > 0.8 else None),
                eta=eta, active=status not in inactive_status,
            )
            db.add(e)
            enh_list.append(e)
        db.flush()

        # Associations: primary group + sometimes a second; 1-3 resources; 1-2 skills
        for e in enh_list:
            db.execute(enhancement_group.insert().values(enhancement_id=e.id, grp_code=e.grp_code))
            if RNG.random() > 0.8:
                g2 = RNG.choice([g for g in ACTIVE_GROUPS if g != e.grp_code])
                db.execute(enhancement_group.insert().values(enhancement_id=e.id, grp_code=g2))
            for r in RNG.sample(active_res, RNG.randint(1, 3)):
                db.execute(enhancement_resource.insert().values(enhancement_id=e.id, resource_id=r.id))
            for s in RNG.sample(SKILLS, RNG.randint(1, 2)):
                db.execute(enhancement_skill.insert().values(enhancement_id=e.id, skill_code=s))

        # Effort rows — every weekday from the 1st of the month ~6 months back up to
        # and including today, so "effort by month" covers all months evenly (incl.
        # the current month). ~16 rows/weekday lands near the original ~1994 total.
        start = date(TODAY.year, TODAY.month, 1) - timedelta(days=150)
        start = date(start.year, start.month, 1)   # snap to the 1st of that month
        workable = [e for e in enh_list if e.status_code not in {"Requested", "Cancelled", "Withdrawn"}]
        effort_count = 0
        d = start
        while d <= TODAY:
            if d.weekday() < 5:  # Mon-Fri
                for e in RNG.sample(workable, RNG.randint(13, 20)):
                    r = RNG.choice(active_res)
                    hrs = RNG.choice([1, 1.5, 2, 2.5, 3, 4])
                    db.add(Effort(
                        enhancement_id=e.id, resource_id=r.id, grp_code=e.grp_code,
                        skill_code=RNG.choice(SKILLS), work_date=d, hours=hrs,
                        note=(RNG.choice(["", "", "", "progress on build", "testing", "code review"])),
                        updated_by=(r.email or LEAD_EMAIL),
                    ))
                    effort_count += 1
            d += timedelta(days=1)

        # Per-group sub-status + a few comments on the first handful of items
        for e in enh_list[:4]:
            db.add(EnhGroupState(enhancement_id=e.id, grp_code=e.grp_code, sub_status_code="Working"))
        for e in enh_list[:8]:
            db.add(EnhComment(enhancement_id=e.id, grp_code=None,
                              body="Kick-off done; owner assigned.", kind="comment", created_by=LEAD_EMAIL))

        # Settings
        for k, v in [("freeze_weekday", "4"), ("freeze_hour", "13"), ("freeze_before", ""),
                     ("locked_months", ""), ("lock_day", "last")]:
            db.add(AppSetting(key=k, value=v))

        # Support tickets
        sup_desc = [
            "Dashboard shows yesterday's numbers after the nightly run",
            "Access request for the analytics schema",
            "Duplicate rows in the orders extract",
            "Update run-book for the weekend batch",
            "Investigate slow load on the sales aggregate",
            "Set up alerting for the ingestion failures",
            "Document the gold-layer refresh schedule",
        ]
        sup_status = ["In Progress", "Completed", "On Hold", "In Queue", "In Progress", "In Queue", "Completed"]
        tickets = []
        for i, (desc, st) in enumerate(zip(sup_desc, sup_status)):
            closed = st == "Completed"
            tk = SupportTicket(number=f"TASK{i+1:06d}", description=desc, status=st,
                               lead_resource_id=RNG.choice(leads).id, eta=TODAY + timedelta(days=RNG.randint(-5, 12)),
                               active=not closed, created_by=LEAD_EMAIL)
            db.add(tk)
            tickets.append(tk)
        db.flush()
        for tk in tickets:
            db.add(SupportComment(ticket_id=tk.id, body="Opened", kind="state", created_by=LEAD_EMAIL))
            if tk.status != "In Queue":
                db.add(SupportComment(ticket_id=tk.id, body="Looking into this.", kind="comment",
                                      created_by=(RNG.choice(active_res).email or LEAD_EMAIL)))
        db.execute(support_ticket_resource.insert().values(ticket_id=tickets[0].id, resource_id=active_res[0].id))

        # A little audit history on the first enhancement
        e0 = enh_list[0]
        for field, old, new in [(None, None, "created"), ("status_code", "Requested", e0.status_code),
                                ("comments", None, "kicked off")]:
            db.add(AuditLog(entity_type="enhancement", entity_id=e0.id, action="update" if field else "create",
                            field=field, old_value=old, new_value=new, changed_by=LEAD_EMAIL,
                            changed_at=datetime(2026, 11, 3, 5, 14)))

        db.commit()

        counts = {
            "resources": db.scalar(select(func.count()).select_from(Resource)),
            "enhancements": db.scalar(select(func.count()).select_from(Enhancement)),
            "efforts": db.scalar(select(func.count()).select_from(Effort)),
            "support_tickets": db.scalar(select(func.count()).select_from(SupportTicket)),
        }
        print("Seeded fictional data:", counts)
    finally:
        db.close()


if __name__ == "__main__":
    main()
