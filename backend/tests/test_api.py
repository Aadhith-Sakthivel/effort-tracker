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
    client.put("/api/timesheet/cell-groups", json={
        "enhancement_id": eid, "work_date": WORK_DATE, "allocations": [{"grp_code": "DBX", "hours": 5}]})
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
    assert client.put("/api/timesheet/cell-groups", json={"enhancement_id": eid, "work_date": WORK_DATE, "allocations": [{"grp_code": "DBX", "hours": 2}]}, headers=m).status_code == 200
    # member CANNOT edit other fields
    assert client.put(f"/api/enhancements/{eid}", json={"title": "new title"}, headers=m).status_code == 403


def test_viewer_is_read_only(client):
    v = {"X-Forwarded-Email": "outsider@example.com"}  # not on the team
    eid = client.post("/api/enhancements", json={"ticket": "V1", "title": "x", "status_code": "Requested"}).json()["id"]
    # viewer can read
    assert client.get("/api/enhancements").status_code == 200
    # viewer cannot move the board or log time
    assert client.put(f"/api/enhancements/{eid}", json={"status_code": "In Progress Internal"}, headers=v).status_code == 403
    assert client.put("/api/timesheet/cell-groups", json={"enhancement_id": eid, "work_date": WORK_DATE, "allocations": [{"grp_code": "DBX", "hours": 2}]}, headers=v).status_code == 403
