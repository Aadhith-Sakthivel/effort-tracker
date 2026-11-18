import React, { useEffect, useState } from "react";
import { api } from "../api";
import { ChipMultiSelect, Empty, GlassSelect, Modal, Pill, Select, Spinner } from "../components/ui";
import { Avatars, fmtET } from "../components/format";

const STATUSES = ["In Queue", "In Progress", "Hold", "Completed", "Cancelled"];
const statusKind = (s) => ({
  "In Queue": "pill-gray", "In Progress": "pill-blue", "Hold": "pill-amber",
  "Completed": "pill-green", "Cancelled": "pill-red",
}[s] || "pill-gray");
const statusOpts = STATUSES.map((s) => ({ code: s, label: s }));

// --- Create / edit form (leads only) -----------------------------------
const blank = { number: "", description: "", status: "In Queue", lead_resource_id: null, resource_ids: [], eta: "", active: true };

function TicketForm({ initial, resources, onSave, onClose }) {
  const [f, setF] = useState({ ...blank, ...initial, resource_ids: initial?.resource_ids || [] });
  const [err, setErr] = useState("");
  const isEdit = !!initial?.id;
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const leadOpts = resources.filter((r) => (r.is_lead && r.active) || r.id === f.lead_resource_id);

  const submit = async () => {
    if (!f.description.trim()) { setErr("Description is required."); return; }
    try { await onSave({ ...f, lead_resource_id: f.lead_resource_id ? Number(f.lead_resource_id) : null, eta: f.eta || null }, isEdit); }
    catch (e) { setErr(e.message); }
  };

  return (
    <Modal title={isEdit ? `Edit ${initial.number}` : "New support ticket"} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{isEdit ? "Save" : "Create"}</button>
      </>}>
      {err && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <div className="field row2">
        <div><label>Ticket number <span className="muted" style={{ fontWeight: 400 }}>— leave blank to auto-assign (TASK…)</span></label>
          <input value={f.number || ""} placeholder="TASK000001 / CHG… / EN…" onChange={(e) => set("number")(e.target.value)} disabled={isEdit} /></div>
        <div><label>Status</label>
          <Select value={f.status} onChange={set("status")} options={statusOpts} /></div>
      </div>
      <div className="field"><label>Description *</label>
        <textarea value={f.description} placeholder="What's the task / issue?" onChange={(e) => set("description")(e.target.value)} /></div>
      <div className="field row2">
        <div><label>Lead <span className="muted" style={{ fontWeight: 400 }}>— exactly one</span></label>
          <Select value={f.lead_resource_id} onChange={set("lead_resource_id")} options={leadOpts} labelKey="name" valueKey="id" placeholder="— unassigned —" /></div>
        <div><label>ETA <span className="muted" style={{ fontWeight: 400 }}>— target date</span></label>
          <input type="date" value={f.eta || ""} onChange={(e) => set("eta")(e.target.value)} /></div>
      </div>
      <div className="field"><label>Assigned resources</label>
        <ChipMultiSelect options={resources.filter((r) => r.active).map((r) => ({ code: r.id, label: r.name }))}
          value={f.resource_ids} onChange={set("resource_ids")} /></div>
    </Modal>
  );
}

// --- Detail: status, comments history, close ---------------------------
function TicketDetail({ ticket, canEdit, canEditAll, toast, onClose, onEdit, onChanged }) {
  const [full, setFull] = useState(ticket);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.supportTicket(ticket.id).then(setFull); }, [ticket.id]);

  const saveStatus = async (val) => {
    try { const t = await api.updateSupportTicket(ticket.id, { status: val }); setFull(t); toast("Status updated"); onChanged?.(); }
    catch (e) { toast(e.message, "error"); }
  };
  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    setBusy(true);
    try { const t = await api.addSupportComment(ticket.id, text); setFull(t); setComment(""); toast("Comment added"); onChanged?.(); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const setActive = async (active) => {
    try { const t = await api.updateSupportTicket(ticket.id, { active }); setFull(t); toast(active ? "Reopened" : "Ticket closed"); onChanged?.(); }
    catch (e) { toast(e.message, "error"); }
  };

  // Newest first (by timestamp, id as tiebreaker) — don't rely on backend order.
  const comments = [...(full.comments || [])].sort((a, b) => {
    const d = new Date(b.created_at) - new Date(a.created_at);
    return d !== 0 ? d : (b.id - a.id);
  });

  return (
    <Modal title={full.number} onClose={onClose}>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12, whiteSpace: "pre-wrap" }}>{full.description}</div>
      <div className="chg-meta" style={{ marginBottom: 16 }}>
        <div><span className="chg-k">Status</span><span className="chg-v">
          {canEdit
            ? <GlassSelect value={full.status} onChange={saveStatus} minWidth={170} options={statusOpts.map((o) => ({ value: o.code, label: o.label }))} />
            : <Pill value={full.status} kind={statusKind(full.status)} />}
        </span></div>
        <div><span className="chg-k">Lead</span><span className="chg-v">{full.lead_name || "—"}</span></div>
        <div><span className="chg-k">ETA</span><span className="chg-v">{full.eta || "—"}</span></div>
        <div><span className="chg-k">Team</span><span className="chg-v">{full.resources?.length ? <Avatars people={full.resources} max={6} size={24} /> : "—"}</span></div>
        <div><span className="chg-k">State</span><span className="chg-v"><Pill value={full.active ? "Open" : "Closed"} kind={full.active ? "pill-green" : "pill-gray"} /></span></div>
      </div>

      <div className="field" style={{ marginBottom: 6 }}>
        <label>Add comment</label>
        {canEdit ? (
          <>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note…" />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
              {canEditAll && <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => onEdit(full)}>Edit details</button>}
              {full.active
                ? <button className="btn btn-danger" onClick={() => {
                    if (!["Completed", "Cancelled"].includes(full.status)) {
                      toast("Set the status to Completed or Cancelled first, then close the ticket.", "error");
                      return;
                    }
                    setActive(false);
                  }}>Close ticket</button>
                : <button className="btn btn-ghost" onClick={() => setActive(true)}>Reopen</button>}
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={addComment} disabled={busy || !comment.trim()}>{busy ? "Saving…" : "Add comment"}</button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="kpi-label" style={{ marginBottom: 8 }}>Activity</div>
        {comments.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No activity yet.</div>
          : <div className="timeline">{comments.map((c) => {
              const sys = c.kind && c.kind !== "comment";   // status / close-reopen = system entry
              const dot = c.kind === "status" ? "#f59e0b" : c.kind === "state" ? "var(--text-3)" : "#0a84ff";
              return (
                <div className="tl-item" key={c.id}>
                  <span className="tl-dot" style={{ background: dot }} />
                  <div>
                    <div className="tl-text" style={{ whiteSpace: "pre-wrap", fontStyle: sys ? "italic" : "normal", color: sys ? "var(--text-2)" : undefined }}>{c.body}</div>
                    <div className="tl-meta">{c.created_by || "—"} · {fmtET(c.created_at)} ET</div>
                  </div>
                </div>);
            })}</div>}
      </div>
    </Modal>
  );
}

// --- Page --------------------------------------------------------------
export default function SupportTickets({ toast, resources, canEditAll = false, canEdit = false }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = () => { api.supportTickets({ active_only: !showInactive }).then(setRows); };
  useEffect(() => { load(); }, [showInactive]);   // wrap so the effect never returns the Promise

  const save = async (body, isEdit) => {
    if (isEdit) await api.updateSupportTicket(editing.id, body);
    else await api.createSupportTicket(body);
    setEditing(null); toast(isEdit ? "Ticket updated" : "Ticket created"); load();
  };

  const filtered = (rows || []).filter((t) =>
    (!q || `${t.number} ${t.description}`.toLowerCase().includes(q.toLowerCase())) &&
    (!status || t.status === status));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Support tickets</div>
          <div className="page-sub">{rows ? `${rows.length} ${showInactive ? "total" : "open"}` : "Loading…"} · leads create, team updates status &amp; comments.</div>
        </div>
        {canEditAll && <button className="btn btn-primary" onClick={() => setEditing("new")}>+ Add ticket</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search number or description…" value={q} onChange={(e) => setQ(e.target.value)} />
        <GlassSelect value={status} onChange={setStatus} minWidth={160}
          options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
        <label className="switch-row" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      <div className="card table-wrap">
        {!rows ? <Spinner /> : filtered.length === 0 ? (
          <Empty icon="🎫" title="No support tickets" sub={canEditAll ? "Add the first ticket." : "Nothing here yet."} />
        ) : (
          <table>
            <thead>
              <tr><th>Ticket</th><th>Description</th><th>Status</th><th>Lead</th><th>ETA</th><th>Team</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} onClick={() => setDetail(t)} style={{ opacity: t.active ? 1 : 0.55 }}>
                  <td className="ticket-cell">{t.number}</td>
                  <td className="title-cell">{t.description}</td>
                  <td><Pill value={t.status} kind={statusKind(t.status)} /></td>
                  <td className="muted">{t.lead_name || "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{t.eta || "—"}</td>
                  <td>{t.resources?.length ? <Avatars people={t.resources} max={4} size={22} /> : <span className="muted">—</span>}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtET(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <TicketForm initial={editing === "new" ? null : editing} resources={resources} onSave={save} onClose={() => setEditing(null)} />
      )}
      {detail && (
        <TicketDetail ticket={detail} canEdit={canEdit} canEditAll={canEditAll} toast={toast}
          onClose={() => setDetail(null)} onEdit={(t) => { setDetail(null); setEditing(t); }} onChanged={load} />
      )}
    </>
  );
}
