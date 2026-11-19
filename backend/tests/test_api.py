"""API smoke/behaviour tests for the Effort Tracker."""
from datetime import timedelta

from app.tz import est_today

# A week ahead is always past the weekly freeze cutoff, so time entry is allowed.
WORK_DATE = (est_today() + timedelta(days=7)).isoformat()



def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_lookups(client):
    d = client.get("/api/lookups").json()
    assert {g["code"] for g in d["grp"]} == {"DBX", "DW"}
    assert any(s["code"] == "Completed" and s["is_inactive"] for s in d["status"])


def test_create_and_list(client):
    r = client.post("/api/enhancements", json={
        "ticket": "EN1", "title": "Test", "groups": ["DBX", "DW"], "status_code": "Requested"})
    assert r.status_code == 201
    body = r.json()
    assert body["groups"] == ["DBX", "DW"]
    assert body["grp_code"] == "DBX"  # primary = first group
    assert any(e["id"] == body["id"] for e in client.get("/api/enhancements").json())


def test_duplicate_ticket_conflicts(client):
    client.post("/api/enhancements", json={"ticket": "EN1", "title": "a"})
    r = client.post("/api/enhancements", json={"ticket": "EN1", "title": "b"})
    assert r.status_code == 409


def test_active_filter_excludes_inactive_status(client):
    client.post("/api/enhancements", json={"ticket": "ENA", "title": "act", "status_code": "Requested"})
    client.post("/api/enhancements", json={"ticket": "ENC", "title": "done", "status_code": "Completed"})
    active = {e["ticket"] for e in client.get("/api/enhancements").json()}
    allr = {e["ticket"] for e in client.get("/api/enhancements?active_only=false").json()}
    assert "ENA" in active and "ENC" not in active       # Completed hidden by default
    assert {"ENA", "ENC"} <= allr                         # both when showing inactive


def test_update_writes_audit_with_label(client):
    eid = client.post("/api/enhancements", json={"ticket": "EN2", "title": "x", "status_code": "Requested"}).json()["id"]
    client.put(f"/api/enhancements/{eid}", json={"status_code": "In Progress Internal"})
    audit = client.get(f"/api/audit?entity_type=enhancement&entity_id={eid}").json()
    row = next(a for a in audit if a["field"] == "status_code")
    assert row["old_value"] == "Requested" and row["new_value"] == "In Progress Internal"
    assert row["entity_label"] == "EN2"                   # human label, not a bare id


def test_timesheet_cell_and_rollup(client):
    eid = client.post("/api/enhancements", json={
        "ticket": "EN3", "title": "y", "status_code": "Requested", "approved_hrs": 10}).json()["id"]
    client.put("/api/timesheet/cell-group", json={
        "enhancement_id": eid, "work_date": "2099-06-02", "grp_code": "DBX", "hours": 5})
    assert client.get("/api/dashboard/kpi").json()["total_actual_hrs"] == 5
    enh = client.get(f"/api/enhancements/{eid}").json()
    assert enh["actual_hrs"] == 5 and enh["remaining_hrs"] == 5


def test_inactive_lead_excluded(client):
    rid = client.post("/api/resources", json={"name": "Tester", "is_lead": True}).json()["id"]
    assert any(x["id"] == rid for x in client.get("/api/resources?leads_only=true").json())
    client.put(f"/api/resources/{rid}", json={"active": False})
    assert all(x["id"] != rid for x in client.get("/api/resources?leads_only=true").json())


def test_me_roles(client):
    assert client.get("/api/me").json()["role"] == "lead"  # dev identity
    # Not on the team → viewer (read-only).
    r = client.get("/api/me", headers={"X-Forwarded-Email": "someone@example.com"}).json()
    assert r["role"] == "viewer" and r["can_edit_all"] is False and r["can_edit"] is False
    # On the team (active resource) → member.
    client.post("/api/resources", json={"name": "Mem", "email": "mem1@example.com"})
    m = client.get("/api/me", headers={"X-Forwarded-Email": "mem1@example.com"}).json()
    assert m["role"] == "member" and m["can_edit_all"] is False and m["can_edit"] is True


def test_lead_by_resource_email(client):
    client.post("/api/resources", json={"name": "Lead One", "email": "lead1@example.com", "is_lead": True})
    assert client.get("/api/me", headers={"X-Forwarded-Email": "lead1@example.com"}).json()["role"] == "lead"


def test_member_permissions(client):
    m = {"X-Forwarded-Email": "member@example.com"}
    # member must be on the team
    client.post("/api/resources", json={"name": "Member One", "email": "member@example.com"})
    # member cannot create enhancements or manage team
    assert client.post("/api/enhancements", json={"ticket": "M1", "title": "x"}, headers=m).status_code == 403
    assert client.post("/api/resources", json={"name": "Nope"}, headers=m).status_code == 403
    # lead (dev) creates one
    eid = client.post("/api/enhancements", json={"ticket": "M1", "title": "x", "status_code": "Requested"}).json()["id"]
    # member CAN move status + comment (board) and log time
    assert client.put(f"/api/enhancements/{eid}", json={"status_code": "In Progress Internal", "comments": "moved"}, headers=m).status_code == 200
    assert client.put("/api/timesheet/cell-group", json={"enhancement_id": eid, "work_date": "2099-06-02", "grp_code": "DBX", "hours": 2}, headers=m).status_code == 200
    # member CANNOT edit other fields
    assert client.put(f"/api/enhancements/{eid}", json={"title": "new title"}, headers=m).status_code == 403


def test_viewer_is_read_only(client):
    v = {"X-Forwarded-Email": "outsider@example.com"}  # not on the team
    eid = client.post("/api/enhancements", json={"ticket": "V1", "title": "x", "status_code": "Requested"}).json()["id"]
    # viewer can read
    assert client.get("/api/enhancements").status_code == 200
    # viewer cannot move the board or log time
    assert client.put(f"/api/enhancements/{eid}", json={"status_code": "In Progress Internal"}, headers=v).status_code == 403
    assert client.put("/api/timesheet/cell-group", json={"enhancement_id": eid, "work_date": "2099-06-02", "grp_code": "DBX", "hours": 2}, headers=v).status_code == 403


def _mk_enh(client, ticket="EN9"):
    return client.post("/api/enhancements", json={
        "ticket": ticket, "title": "t", "status_code": "Requested", "groups": ["DBX"]}).json()["id"]


def test_person_day_cap(client):
    eid = _mk_enh(client)
    rid = client.post("/api/resources", json={"name": "Logger", "email": "logger@example.com"}).json()["id"]
    base = {"enhancement_id": eid, "work_date": "2099-06-03", "grp_code": "DBX", "resource_id": rid}
    assert client.put("/api/timesheet/cell-group", json={**base, "hours": 8}).status_code == 200
    assert client.put("/api/timesheet/cell-group", json={**base, "hours": 9}).status_code == 400  # >8h/day


def test_month_freeze_locks_edits(client):
    eid = _mk_enh(client)
    cell = {"enhancement_id": eid, "work_date": "2099-06-15", "grp_code": "DBX", "hours": 1}
    assert client.put("/api/timesheet/cell-group", json=cell).status_code == 200          # future month open
    client.put("/api/settings/freeze", json={"weekday": 4, "hour": 13, "locked_months": ["2099-06"]})
    assert client.put("/api/timesheet/cell-group", json=cell).status_code == 403           # now locked
    # a day outside the locked month is still editable
    assert client.put("/api/timesheet/cell-group",
                      json={**cell, "work_date": "2099-07-15"}).status_code == 200


def test_delete_enhancement_cascades(client):
    from app.db import EnhComment, Grp, SessionLocal, enhancement_group
    from sqlalchemy import func, select
    eid = client.post("/api/enhancements", json={
        "ticket": "DEL1", "title": "t", "groups": ["DBX"], "custom_groups": ["TempGroup"]}).json()["id"]
    client.post(f"/api/enhancements/{eid}/comment", json={"grp_code": None, "body": "note"})
    db = SessionLocal()
    assert db.scalar(select(func.count()).select_from(EnhComment).where(EnhComment.enhancement_id == eid)) == 1
    assert db.scalar(select(func.count()).select_from(Grp).where(Grp.is_custom.is_(True))) == 1
    db.close()
    assert client.delete(f"/api/enhancements/{eid}").status_code == 204
    db = SessionLocal()
    # children + the per-enhancement custom group are gone — no orphans
    assert db.scalar(select(func.count()).select_from(EnhComment).where(EnhComment.enhancement_id == eid)) == 0
    assert db.scalar(select(func.count()).select_from(enhancement_group).where(enhancement_group.c.enhancement_id == eid)) == 0
    assert db.scalar(select(func.count()).select_from(Grp).where(Grp.is_custom.is_(True))) == 0
    db.close()


def test_support_close_requires_terminal_status(client):
    tid = client.post("/api/support-tickets", json={"description": "d", "status": "In Progress"}).json()["id"]
    assert client.put(f"/api/support-tickets/{tid}", json={"active": False}).status_code == 400  # not terminal
    assert client.put(f"/api/support-tickets/{tid}", json={"status": "Completed", "active": False}).status_code == 200


def test_settings_group_add_and_retire(client):
    g = client.post("/api/settings/groups", json={"label": "Pod X"}).json()
    assert any(x["code"] == g["code"] for x in client.get("/api/lookups").json()["grp"])  # visible in pickers
    client.put(f"/api/settings/groups/{g['code']}", json={"label": "Pod X", "sort_order": 100, "active": False})
    assert all(x["code"] != g["code"] for x in client.get("/api/lookups").json()["grp"])  # retired → hidden


def test_text_length_validation(client):
    r = client.post("/api/enhancements", json={"ticket": "LEN1", "title": "x" * 600})  # title max 500
    assert r.status_code == 422


def test_read_tolerates_overlength_legacy_fields(client):
    """Input length caps must not break READS of migrated rows that exceed them
    (e.g. a demand_number holding many newline-joined values)."""
    from app.db import Enhancement, SessionLocal
    db = SessionLocal()
    db.add(Enhancement(ticket="LEG1", title="t", demand_number="\n".join(f"DMND{i:07d}" for i in range(40))))
    db.commit()
    db.close()
    r = client.get("/api/enhancements?active_only=false")
    assert r.status_code == 200
    assert any(e["ticket"] == "LEG1" for e in r.json())


def test_auth_denial_is_logged(client, caplog):
    """S10: a denied write emits a structured 'authz_denied' warning naming the user."""
    import logging
    with caplog.at_level(logging.WARNING, logger="effort_tracker.auth"):
        r = client.get("/api/audit", headers={"X-Forwarded-Email": "denied@example.com"})
    assert r.status_code == 403
    rec = next((x for x in caplog.records if x.getMessage() == "authz_denied"), None)
    assert rec is not None and rec.levelno == logging.WARNING
    assert getattr(rec, "extra_fields", {}).get("user") == "denied@example.com"


def test_list_pagination(client):
    """S9: list endpoints honor limit/offset and clamp limit to the 500 max."""
    for i in range(5):
        client.post("/api/enhancements", json={"ticket": f"PG{i}", "title": "t"})
    # limit caps the page
    assert len(client.get("/api/enhancements?limit=2&active_only=false").json()) == 2
    # offset returns a different slice
    page1 = client.get("/api/enhancements?limit=2&offset=0&active_only=false").json()
    page2 = client.get("/api/enhancements?limit=2&offset=2&active_only=false").json()
    assert {e["ticket"] for e in page1}.isdisjoint({e["ticket"] for e in page2})
    # an over-max limit is clamped, not rejected (all 5 come back)
    assert len(client.get("/api/enhancements?limit=9999&active_only=false").json()) == 5
    # resources paginate too
    for i in range(3):
        client.post("/api/resources", json={"name": f"PgRes{i}"})
    assert len(client.get("/api/resources?limit=1").json()) == 1


def test_csrf_header_required_on_writes(client):
    """S6: state-changing API calls require the X-Requested-With header (CSRF guard);
    safe reads do not."""
    from fastapi.testclient import TestClient

    import app.main as m
    raw = TestClient(m.app)  # no X-Requested-With header
    # Safe GET works without the header.
    assert raw.get("/api/health").status_code == 200
    assert raw.get("/api/enhancements").status_code == 200
    # A write without the header is refused before auth/handler logic.
    assert raw.post("/api/enhancements", json={"ticket": "CSRF1", "title": "x"}).status_code == 403
    # The same write with the header proceeds (dev identity is lead).
    assert client.post("/api/enhancements", json={"ticket": "CSRF2", "title": "x"}).status_code == 201


def test_security_headers_present(client):
    """S5: every response carries the hardening headers."""
    r = client.get("/api/health")
    assert r.status_code == 200
    csp = r.headers.get("Content-Security-Policy", "")
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "script-src 'self'" in csp
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "max-age=" in r.headers.get("Strict-Transport-Security", "")


def test_audit_is_lead_only(client):
    """S4: the audit log is lead-only (viewers/members cannot read change history)."""
    eid = _mk_enh(client, "AUD1")
    client.put(f"/api/enhancements/{eid}", json={"status_code": "In Progress Internal"})
    # lead (dev identity) can read
    assert client.get("/api/audit").status_code == 200
    # viewer (not on the team) is denied
    assert client.get("/api/audit", headers={"X-Forwarded-Email": "outsider-aud@example.com"}).status_code == 403
    # a plain member is also denied (audit is lead-only)
    client.post("/api/resources", json={"name": "Aud Mem", "email": "audmem@example.com"})
    assert client.get("/api/audit", headers={"X-Forwarded-Email": "audmem@example.com"}).status_code == 403


def test_auth_fails_closed_without_sso(client, monkeypatch):
    """S3: the dev identity is lead only locally; a deployed env with no SSO header
    must fail closed to viewer instead of silently granting lead."""
    import app.deps as deps
    # Seed a real team member while still local-lead (needs lead to create).
    client.post("/api/resources", json={"name": "Prod Mem", "email": "prodmem@example.com"})
    # Local (SQLite) mode: dev identity resolves to lead (dev convenience).
    assert client.get("/api/me").json()["role"] == "lead"
    # Simulate a deployed (non-SQLite) environment: no SSO header → fail closed to viewer.
    monkeypatch.setattr(deps, "_is_local", lambda: False)
    assert client.get("/api/me").json()["role"] == "viewer"
    # A real team member still resolves correctly in deployed mode.
    assert client.get("/api/me", headers={"X-Forwarded-Email": "prodmem@example.com"}).json()["role"] == "member"


def test_spa_no_path_traversal(client):
    """S2: the SPA catch-all must never serve files outside frontend/dist."""
    import app.main as m
    if not m._DIST.exists():
        import pytest
        pytest.skip("frontend/dist not built")
    # Raw and percent-encoded ../ payloads targeting a known backend source file.
    payloads = [
        "../../backend/app/main.py",
        "..%2f..%2fbackend%2fapp%2fmain.py",
        "%2e%2e%2f%2e%2e%2fbackend%2fapp%2fmain.py",
        "..%2F..%2Fapp%2Fconfig.py",
    ]
    for p in payloads:
        r = client.get("/" + p)
        # Allowed: the SPA shell (200 index.html) or a 404 — but never source contents.
        assert r.status_code in (200, 404), (p, r.status_code)
        assert "FastAPI entrypoint" not in r.text, f"leaked source for {p}"
        assert "resolve_url" not in r.text, f"leaked source for {p}"


def test_efforts_require_membership(client):
    """S1: the /api/efforts writes are role-guarded (viewer 403) and obey freeze + cap."""
    eid = _mk_enh(client, "EFF1")
    rid = client.post("/api/resources", json={"name": "EffLogger", "email": "eff@example.com"}).json()["id"]
    body = {"enhancement_id": eid, "work_date": "2099-06-03", "resource_id": rid, "hours": 4}

    # viewer (not on the team) cannot create / update / delete effort
    v = {"X-Forwarded-Email": "outsider-eff@example.com"}
    assert client.post("/api/efforts", json=body, headers=v).status_code == 403

    # member (dev identity is lead, but a real member works too) can create
    r = client.post("/api/efforts", json=body)
    assert r.status_code == 201
    fid = r.json()["id"]
    assert client.put(f"/api/efforts/{fid}", json={"hours": 5}).status_code == 200

    # member is blocked by the 8h/day person cap
    assert client.post("/api/efforts",
                       json={**body, "work_date": "2099-06-04", "hours": 9}).status_code == 400

    # member is blocked by a month freeze
    client.put("/api/settings/freeze", json={"weekday": 4, "hour": 13, "locked_months": ["2099-07"]})
    assert client.post("/api/efforts",
                       json={**body, "work_date": "2099-07-10"}).status_code == 403
