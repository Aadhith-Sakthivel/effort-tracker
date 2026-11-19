import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Empty, GlassSelect, LoadError, Modal, Spinner } from "../components/ui";

const blank = { name: "", racf: "", email: "", skills: "", location: "Onshore", cell: "", active: true, is_lead: false };

// Exportable columns. `contact: true` = contains contact info → team members only, never viewers.
const COLUMNS = [
  { key: "name", label: "Name", get: (r) => r.name },
  { key: "racf", label: "RACF", get: (r) => r.racf || "" },
  { key: "email", label: "Email", get: (r) => r.email || "" },
  { key: "skills", label: "Skills", get: (r) => r.skills || "" },
  { key: "location", label: "Location", get: (r) => r.location || "" },
  { key: "cell", label: "Cell / phone", get: (r) => r.cell || "", contact: true },
  { key: "is_lead", label: "Lead (yes/no)", get: (r) => (r.is_lead ? "Yes" : "No") },
];

function ResourceForm({ initial, onSave, onClose, limited = false }) {
  const [f, setF] = useState({ ...blank, ...initial });
  const [err, setErr] = useState("");
  const isEdit = !!initial?.id;
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!limited && !f.name.trim()) { setErr("Name is required."); return; }
    const body = limited ? { racf: f.racf, cell: f.cell } : f;
    try { await onSave(body, isEdit); } catch (e) { setErr(e.message); }
  };

  return (
    <Modal
      title={limited ? "Edit my contact details" : isEdit ? `Edit ${initial.name}` : "Add team member"}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{isEdit ? "Save" : "Add"}</button>
      </>}
    >
      {err && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {limited ? (
        <>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>You can update your RACF and cell number. Ask a lead to change anything else.</div>
          <div className="field"><label>RACF</label><input autoFocus value={f.racf || ""} onChange={(e) => set("racf")(e.target.value)} /></div>
          <div className="field"><label>Cell</label><input value={f.cell || ""} placeholder="+1 555 123 4567" onChange={(e) => set("cell")(e.target.value)} /></div>
        </>
      ) : (
        <>
          <div className="field"><label>Name *</label><input value={f.name} onChange={(e) => set("name")(e.target.value)} /></div>
          <div className="field row2">
            <div><label>RACF</label><input value={f.racf || ""} onChange={(e) => set("racf")(e.target.value)} /></div>
            <div><label>Location</label>
              <GlassSelect block value={f.location || "Onshore"} onChange={set("location")}
                options={[{ value: "Onshore", label: "Onshore" }, { value: "Offshore", label: "Offshore" }]} />
            </div>
          </div>
          <div className="field">
            <label>Login email <span className="muted" style={{ fontWeight: 400 }}>— their SSO email; a lead with this email gets full edit</span></label>
            <input value={f.email || ""} placeholder="first.last@example.com" onChange={(e) => set("email")(e.target.value)} />
          </div>
          <div className="field"><label>Skills</label><input value={f.skills || ""} placeholder="DBX, AWS, SQL…" onChange={(e) => set("skills")(e.target.value)} /></div>
          <div className="field"><label>Cell</label><input value={f.cell || ""} onChange={(e) => set("cell")(e.target.value)} /></div>
          <div className="field row2">
            <label className="switch-row"><input type="checkbox" checked={f.active} onChange={(e) => set("active")(e.target.checked)} /> Active</label>
            <label className="switch-row"><input type="checkbox" checked={f.is_lead} onChange={(e) => set("is_lead")(e.target.checked)} /> Can be Lead</label>
          </div>
        </>
      )}
    </Modal>
  );
}

function MemberCard({ r, canEdit, canContact, meEmail, onEdit, onToggleActive, onToggleLead }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCell, setShowCell] = useState(false);
  const wrapRef = useRef(null);
  const isSelf = !!meEmail && !!r.email && r.email.toLowerCase() === meEmail.toLowerCase();
  const canEditThis = canEdit || isSelf;   // leads edit anyone; a member can edit their own contact
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [menuOpen]);

  return (
    <div className={`card tm-card ${r.active ? "" : "inactive"}`}>
      <div className="tm-top">
        <div className="tm-name">{r.name}</div>
        <div className="tm-badges">
          {r.is_lead && <span className="pill pill-purple">Lead</span>}
          {!r.active && <span className="pill pill-gray">Inactive</span>}
        </div>
      </div>
      <div className="tm-sub">{[r.racf, r.location].filter(Boolean).join(" · ") || "—"}</div>
      {r.email && <div className="tm-email" title={r.email}>{r.email}</div>}
      <div className="tm-skills"><SkillTags value={r.skills} max={3} /></div>
      <div className="tm-foot">
        <div>
          {canContact && (showCell
            ? (r.cell
                ? <a className="tm-call" href={`tel:${String(r.cell).replace(/[^\d+]/g, "")}`}>{r.cell}</a>
                : <span className="muted" style={{ fontSize: 13 }}>No number on file</span>)
            : <button className="btn btn-ghost btn-sm" onClick={() => setShowCell(true)}>📞 Call</button>)}
        </div>
        {canEditThis && (
          <div className="tm-menu-wrap" ref={wrapRef}>
            <button className="btn btn-ghost btn-sm tm-dots" onClick={() => setMenuOpen((o) => !o)} aria-label="Actions">⋯</button>
            {menuOpen && (
              <div className="tm-menu">
                <button onClick={() => { setMenuOpen(false); onEdit(r, !canEdit); }}>{canEdit ? "Edit" : "Edit my details"}</button>
                {canEdit && <button onClick={() => { setMenuOpen(false); onToggleLead(r); }}>{r.is_lead ? "Remove lead" : "Make lead"}</button>}
                {canEdit && <button className="danger" onClick={() => { setMenuOpen(false); onToggleActive(r); }}>{r.active ? "Deactivate" : "Activate"}</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillTags({ value, max = 4 }) {
  if (!value) return <span className="muted">—</span>;
  const all = value.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean);
  const shown = all.slice(0, max);
  const extra = all.length - shown.length;
  return (
    <div className="skill-tags" title={all.join(", ")}>
      {shown.map((s, i) => <span key={i} className="skill-tag">{s}</span>)}
      {extra > 0 && <span className="skill-tag more">+{extra}</span>}
    </div>
  );
}

export default function Resources({ toast, onChanged, canEdit = false, canContact = false, meEmail = "" }) {
  const [rows, setRows] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editLimited, setEditLimited] = useState(false);   // member editing only their own RACF + cell
  const [confirmRow, setConfirmRow] = useState(null);   // member pending deactivation
  const [q, setQ] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  // Cell (contact) and Skills are off by default; the rest on.
  const [selectedCols, setSelectedCols] = useState(() => Object.fromEntries(COLUMNS.map((c) => [c.key, c.key !== "cell" && c.key !== "skills"])));
  // The export popup carries its own copy of the page filters, seeded on open.
  const [exp, setExp] = useState({ loc: "", role: "", inactive: false });
  const openExport = () => { setExp({ loc: locFilter, role: roleFilter, inactive: showInactive }); setExporting(true); };

  const [err, setErr] = useState(null);
  const load = () => { setErr(null); api.resources().then(setRows).catch(setErr); };   // keep rows during refetch (no flicker)
  useEffect(load, []);

  const save = async (body, isEdit) => {
    if (isEdit) await api.updateResource(editing.id, body);
    else await api.createResource(body);
    setEditing(null); toast(isEdit ? "Member updated" : "Member added"); load(); onChanged?.();
  };
  const toggle = async (r, field) => {
    await api.updateResource(r.id, { [field]: !r[field] });
    toast(`${r.name} ${field === "active" ? (!r.active ? "activated" : "deactivated") : (!r.is_lead ? "marked lead" : "unmarked lead")}`);
    load(); onChanged?.();
  };
  // Deactivating hides the person from default views — confirm so a misclick can't make them vanish.
  const onToggleActive = (r) => { if (r.active) setConfirmRow(r); else toggle(r, "active"); };
  const doDeactivate = async () => { const r = confirmRow; setConfirmRow(null); if (r) await toggle(r, "active"); };

  const matchFilters = (r, f) =>
    (f.inactive || r.active) &&
    (!f.q || `${r.name} ${r.racf || ""} ${r.email || ""}`.toLowerCase().includes(f.q.toLowerCase())) &&
    (!f.loc || (r.location || "") === f.loc) &&
    (!f.role || (f.role === "lead" ? r.is_lead : !r.is_lead));

  const filtered = (rows || []).filter((r) => matchFilters(r, { q, loc: locFilter, role: roleFilter, inactive: showInactive }));
  const leads = (rows || []).filter((r) => r.is_lead && r.active).length;

  // Columns a viewer isn't allowed to export (contact info) are dropped regardless of selection.
  const exportableCols = COLUMNS.filter((c) => !c.contact || canContact);
  const exportRows = (rows || []).filter((r) => matchFilters(r, exp));   // uses the popup's own filters
  const exportCsv = () => {
    const cols = exportableCols.filter((c) => selectedCols[c.key]);
    if (!cols.length) return;
    const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.map((c) => esc(c.label)).join(","),
      ...exportRows.map((r) => cols.map((c) => esc(c.get(r))).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `team-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setExporting(false); toast(`Exported ${exportRows.length} member${exportRows.length === 1 ? "" : "s"}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Team</div>
          <div className="page-sub">
            {rows ? `${rows.filter((r) => r.active).length} active · ${leads} leads` : "Loading…"}
          </div>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => { setEditLimited(false); setEditing("new"); }}>+ Add member</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search name, RACF, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <GlassSelect value={locFilter} onChange={setLocFilter} minWidth={150}
          options={[{ value: "", label: "All locations" }, { value: "Onshore", label: "Onshore" }, { value: "Offshore", label: "Offshore" }]} />
        <GlassSelect value={roleFilter} onChange={setRoleFilter} minWidth={140}
          options={[{ value: "", label: "All roles" }, { value: "lead", label: "Leads" }, { value: "member", label: "Members" }]} />
        <label className="switch-row" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={openExport}>⬇ Export CSV</button>
      </div>

      {err && !rows ? <LoadError error={err} onRetry={load} /> : !rows ? <Spinner /> : filtered.length === 0 ? (
        <div className="card table-wrap"><Empty icon="👥" title="No team members match" sub="Adjust filters or add a member." /></div>
      ) : (
        <div className="team-grid">
          {filtered.map((r) => (
            <MemberCard key={r.id} r={r} canEdit={canEdit} canContact={canContact} meEmail={meEmail}
              onEdit={(row, limited) => { setEditLimited(!!limited); setEditing(row); }}
              onToggleActive={onToggleActive}
              onToggleLead={(x) => toggle(x, "is_lead")} />
          ))}
        </div>
      )}

      {editing && (
        <ResourceForm initial={editing === "new" ? null : editing} limited={editLimited} onSave={save} onClose={() => setEditing(null)} />
      )}

      {exporting && (
        <Modal title="Export team to CSV" onClose={() => setExporting(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setExporting(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={exportCsv} disabled={!exportableCols.some((c) => selectedCols[c.key]) || exportRows.length === 0}>Download CSV</button>
          </>}>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 12 }}>Columns to include:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px" }}>
            {exportableCols.map((c) => (
              <label key={c.key} className="switch-row" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={!!selectedCols[c.key]}
                  onChange={(e) => setSelectedCols((s) => ({ ...s, [c.key]: e.target.checked }))} /> {c.label}
              </label>
            ))}
          </div>
          {!canContact && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Cell / phone can only be exported by team members.</div>}

          <div className="cd-sep" style={{ margin: "16px 0" }} />
          <div style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 10 }}>Rows to include <span className="muted" style={{ fontWeight: 400 }}>— starts from the page filters; change here to export a different set</span></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <GlassSelect value={exp.loc} onChange={(v) => setExp((s) => ({ ...s, loc: v }))} minWidth={150}
              options={[{ value: "", label: "All locations" }, { value: "Onshore", label: "Onshore" }, { value: "Offshore", label: "Offshore" }]} />
            <GlassSelect value={exp.role} onChange={(v) => setExp((s) => ({ ...s, role: v }))} minWidth={140}
              options={[{ value: "", label: "All roles" }, { value: "lead", label: "Leads" }, { value: "member", label: "Members" }]} />
            <label className="switch-row" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={exp.inactive} onChange={(e) => setExp((s) => ({ ...s, inactive: e.target.checked }))} /> Include inactive
            </label>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {exportRows.length} member{exportRows.length === 1 ? "" : "s"} will be exported.
          </div>
        </Modal>
      )}

      {confirmRow && (
        <Modal title="Deactivate member" onClose={() => setConfirmRow(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmRow(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDeactivate}>Deactivate</button>
          </>}>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Deactivate <b>{confirmRow.name}</b>? They'll be hidden from default views — toggle <b>Show inactive</b> to see them again.
          </div>
        </Modal>
      )}
    </>
  );
}
