import React, { useEffect, useState } from "react";
import { api } from "../api";
import { ChipMultiSelect, Empty, GlassSelect, LoadError, Modal, Pill, Select, Spinner, fmtHrs } from "../components/ui";
import { Avatars, relTime } from "../components/format";

const blank = {
  ticket: "", groups: [], demand_number: "", title: "",
  status_code: null, sub_status_code: null, lead_resource_id: null, resource_ids: [], skill_codes: [], smoc_lead: "",
  initial_estimated_hrs: "", approved_hrs: "", comments: "", doc_url: "", change_ticket: "", eta: "", active: true,
};

// Columns offered in the CSV export popup (value resolution lives in the component).
const ENH_COLUMNS = [
  { key: "ticket", label: "Ticket" },
  { key: "demand_number", label: "Demand #" },
  { key: "title", label: "Title" },
  { key: "groups", label: "Groups" },
  { key: "status_code", label: "Status" },
  { key: "sub_status_code", label: "Sub-status" },
  { key: "lead_name", label: "Lead" },
  { key: "resources", label: "Team" },
  { key: "initial_estimated_hrs", label: "Initial est (h)" },
  { key: "approved_hrs", label: "Approved (h)" },
  { key: "actual_hrs", label: "Actual (h)" },
  { key: "remaining_hrs", label: "Remaining (h)" },
  { key: "eta", label: "ETA" },
  { key: "change_ticket", label: "Implementation ticket" },
  { key: "active", label: "Active / inactive" },
];

function EnhancementForm({ initial, lookups, resources, onSave, onClose, onDelete }) {
  const [f, setF] = useState({ ...blank, ...initial, groups: initial?.groups || [], resource_ids: initial?.resource_ids || [], skill_codes: initial?.skill_codes || [] });
  const [err, setErr] = useState("");
  const isEdit = !!initial?.id;
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  // Groups shown here = the shared (global) list + THIS enhancement's own custom
  // groups. Custom groups never appear for a different enhancement. `newCustom`
  // holds labels added this session (temp codes) until the save creates them.
  const [customItems] = useState(initial?.custom_group_items || []);
  const [newCustom, setNewCustom] = useState([]);
  const [addingCustom, setAddingCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const groupOptions = [...lookups.grp, ...customItems, ...newCustom];
  const commitCustom = () => {
    const label = customDraft.trim();
    if (!label) { setAddingCustom(false); setCustomDraft(""); return; }
    const code = `__new__${Date.now()}_${newCustom.length}`;
    setNewCustom((s) => [...s, { code, label }]);
    setF((s) => ({ ...s, groups: [...(s.groups || []), code] }));
    setCustomDraft(""); setAddingCustom(false);
  };
  const cancelCustom = () => { setCustomDraft(""); setAddingCustom(false); };

  // Only active leads can be assigned — but keep an already-assigned person visible.
  const leadOptions = resources.filter(
    (r) => (r.is_lead && r.active) || r.id === f.lead_resource_id
  );

  const submit = async () => {
    if (!f.ticket.trim() || !f.title.trim()) { setErr("Ticket and Title are required."); return; }
    const tempCodes = new Set(newCustom.map((c) => c.code));
    const groups = (f.groups || []).filter((c) => !tempCodes.has(c));            // global + existing custom codes
    const custom_groups = newCustom.filter((c) => (f.groups || []).includes(c.code)).map((c) => c.label);
    const body = {
      ...f,
      groups, custom_groups,
      initial_estimated_hrs: f.initial_estimated_hrs === "" ? null : Number(f.initial_estimated_hrs),
      approved_hrs: f.approved_hrs === "" ? null : Number(f.approved_hrs),
      lead_resource_id: f.lead_resource_id ? Number(f.lead_resource_id) : null,
      eta: f.eta || null,
    };
    try { await onSave(body, isEdit); } catch (e) { setErr(e.message); }
  };

  return (
    <Modal
      title={isEdit ? `Edit ${initial.ticket}` : "New enhancement"}
      onClose={onClose}
      footer={<>
        {isEdit && <button className="btn btn-danger btn-sm" style={{ marginRight: "auto" }} onClick={() => onDelete(initial)}>Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{isEdit ? "Save changes" : "Create"}</button>
      </>}
    >
      {err && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <div className="field row2">
        <div>
          <label>Ticket *</label>
          <input value={f.ticket} disabled={isEdit} placeholder="EN0000000" onChange={(e) => set("ticket")(e.target.value)} />
        </div>
        <div>
          <label>Demand #</label>
          <input value={f.demand_number || ""} placeholder="DMND0000000" onChange={(e) => set("demand_number")(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Title *</label>
        <input value={f.title} placeholder="Short description" onChange={(e) => set("title")(e.target.value)} />
      </div>
      <div className="field">
        <label>Groups <span className="muted" style={{ fontWeight: 400 }}>— select one or more</span></label>
        <ChipMultiSelect options={groupOptions} value={f.groups} onChange={set("groups")} />
        {addingCustom ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input autoFocus value={customDraft} placeholder="Custom group name…" style={{ flex: 1 }}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitCustom(); }
                if (e.key === "Escape") { e.preventDefault(); cancelCustom(); }
              }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={commitCustom}>Add</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelCustom}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setAddingCustom(true)}>+ Custom group</button>
        )}
      </div>
      <div className="field">
        <label>Lead <span className="muted" style={{ fontWeight: 400 }}>— exactly one</span></label>
        <Select value={f.lead_resource_id} onChange={set("lead_resource_id")} options={leadOptions} labelKey="name" valueKey="id" placeholder="— unassigned —" />
      </div>
      <div className="field">
        <label>Assigned resources <span className="muted" style={{ fontWeight: 400 }}>— everyone working on it</span></label>
        <ChipMultiSelect
          options={resources.filter((r) => r.active || (f.resource_ids || []).includes(r.id))}
          value={f.resource_ids} onChange={set("resource_ids")} labelKey="name" valueKey="id" />
      </div>
      <div className="field row2">
        <div><label>Status</label><Select value={f.status_code} onChange={set("status_code")} options={lookups.status} /></div>
        <div><label>Sub-status</label><Select value={f.sub_status_code} onChange={set("sub_status_code")} options={lookups.sub_status} /></div>
      </div>
      <div className="field row3">
        <div><label>Initial estimate (h)</label><input type="number" min="0" step="0.5" value={f.initial_estimated_hrs ?? ""} onChange={(e) => set("initial_estimated_hrs")(e.target.value)} /></div>
        <div><label>Approved (h)</label><input type="number" min="0" step="0.5" value={f.approved_hrs ?? ""} onChange={(e) => set("approved_hrs")(e.target.value)} /></div>
        <div><label>ETA</label><input type="date" value={f.eta || ""} onChange={(e) => set("eta")(e.target.value)} /></div>
      </div>
      <div className="field row2">
        <div>
          <label>Documentation link <span className="muted" style={{ fontWeight: 400 }}>— Confluence / SharePoint URL</span></label>
          <input value={f.doc_url || ""} placeholder="https://…" onChange={(e) => set("doc_url")(e.target.value)} />
        </div>
        <div>
          <label>Implementation ticket <span className="muted" style={{ fontWeight: 400 }}>— CHG number or URL</span></label>
          <input value={f.change_ticket || ""} placeholder="CHG2210913" onChange={(e) => set("change_ticket")(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Comments / current status</label>
        <textarea value={f.comments || ""} onChange={(e) => set("comments")(e.target.value)} />
      </div>
      <div className="field">
        <label className="switch-row">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active")(e.target.checked)} />
          Active {f.active ? "" : "— hidden from default views"}
        </label>
      </div>
    </Modal>
  );
}

function LatestComment({ e }) {
  if (!e.latest_comment) return null;
  const src = e.latest_comment_src === "timesheet" ? "timesheet" : "edit";
  return (
    <div className="latest-comment" title={e.latest_comment}>
      <span className={`lc-tag ${src}`}>{src}</span>
      <span className="lc-text">{e.latest_comment}</span>
      <span className="lc-time">· {relTime(e.latest_comment_at)}</span>
    </div>
  );
}

function HoursBar({ actual, approved }) {
  if (!approved) return <span className="muted">—</span>;
  const pct = Math.min(100, Math.round((actual / approved) * 100));
  const over = actual > approved;
  return (
    <div>
      <div className="bar" style={{ width: 120 }}><span style={{ width: `${over ? 100 : pct}%`, background: over ? "var(--red)" : undefined }} /></div>
      <div style={{ fontSize: 11.5, color: over ? "var(--red)" : "var(--text-3)", marginTop: 3 }}>
        {fmtHrs(actual)} / {fmtHrs(approved)}h
      </div>
    </div>
  );
}

export default function Enhancements({ lookups, resources, toast, canEdit = false }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [grp, setGrp] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // object | "new" | null
  const [confirmDel, setConfirmDel] = useState(null);   // enhancement pending delete
  const [exporting, setExporting] = useState(false);
  const [exportAll, setExportAll] = useState(null);   // full list fetched for export
  const [exp, setExp] = useState({ grp: "", status: "", inactive: false });   // popup's own filters
  const [selCols, setSelCols] = useState(() => Object.fromEntries(ENH_COLUMNS.map((c) => [c.key, true])));

  const grpLabel = (code, r) => (lookups.grp.find((x) => x.code === code)?.label)
    || (r.custom_group_items || []).find((x) => x.code === code)?.label || code;
  const cellValue = (r, key) => {
    switch (key) {
      case "groups": return (r.groups || []).map((g) => grpLabel(g, r)).join("; ");
      case "resources": return (r.resources || []).map((x) => x.name).join("; ");
      case "lead_name": return r.lead_name || r.smoc_lead || "";
      case "active": return r.active ? "Active" : "Inactive";
      default: { const v = r[key]; return v == null ? "" : v; }
    }
  };
  const inactiveStatuses = new Set((lookups.status || []).filter((s) => s.is_inactive).map((s) => s.code));
  const exportRows = (exportAll || []).filter((r) =>
    (exp.inactive || (r.active && !inactiveStatuses.has(r.status_code))) &&
    (!exp.grp || (r.groups || []).includes(exp.grp)) &&
    (!exp.status || r.status_code === exp.status));
  const openExport = async () => {
    setExp({ grp, status, inactive: showInactive });
    setExportAll(null);
    setExporting(true);
    try { setExportAll(await api.enhancements({ active_only: false })); } catch (e) { toast(e.message, "error"); }
  };
  const exportCsv = () => {
    const cols = ENH_COLUMNS.filter((c) => selCols[c.key]);
    if (!cols.length || !exportRows.length) return;
    const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.map((c) => esc(c.label)).join(","),
      ...exportRows.map((r) => cols.map((c) => esc(cellValue(r, c.key))).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `enhancements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setExporting(false); toast(`Exported ${exportRows.length} enhancement${exportRows.length === 1 ? "" : "s"}`);
  };

  const load = () => {
    // Keep rows visible during refetch (no flicker); Spinner only on first load.
    setErr(null);
    api.enhancements({ q, status_code: status, grp_code: grp, active_only: !showInactive }).then(setRows).catch(setErr);
  };
  useEffect(load, [q, status, grp, showInactive]);

  const save = async (body, isEdit) => {
    if (isEdit) await api.updateEnhancement(editing.id, body);
    else await api.createEnhancement(body);
    setEditing(null);
    toast(isEdit ? "Enhancement updated" : "Enhancement created");
    load();
  };
  const remove = (row) => setConfirmDel(row);   // open styled confirm (no native dialog)
  const doRemove = async () => {
    const row = confirmDel;
    setConfirmDel(null);
    if (!row) return;
    try { await api.deleteEnhancement(row.id); setEditing(null); toast("Enhancement deleted"); load(); }
    catch (e) { toast(e.message, "error"); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Enhancements</div>
          <div className="page-sub">{rows ? `${rows.length} shown` : "Loading…"} · validated statuses, logged edits</div>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing("new")}>+ New enhancement</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search ticket or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        <GlassSelect value={grp} onChange={setGrp} minWidth={150}
          options={[{ value: "", label: "All groups" }, ...lookups.grp.map((g) => ({ value: g.code, label: g.label }))]} />
        <GlassSelect value={status} onChange={setStatus} minWidth={185}
          options={[{ value: "", label: "All statuses" }, ...lookups.status.map((s) => ({ value: s.code, label: s.label }))]} />
        <label className="switch-row" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={openExport}>⬇ Export CSV</button>
      </div>

      <div className="card list-scroll">
        {err && !rows ? <LoadError error={err} onRetry={load} /> : !rows ? <Spinner /> : rows.length === 0 ? (
          <Empty icon="🔍" title="No enhancements match" sub="Adjust filters or add a new one." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ticket</th><th>Title</th><th>Group</th><th>Status</th>
                <th>Lead</th><th>Team</th><th className="num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} onClick={canEdit ? () => setEditing(e) : undefined}
                    style={{ opacity: e.active === false ? 0.5 : 1, cursor: canEdit ? "pointer" : "default" }}>
                  <td className="ticket-cell">
                    {e.ticket}
                    {e.active === false && <span className="pill pill-gray" style={{ marginLeft: 8, fontSize: 10.5 }}>Inactive</span>}
                  </td>
                  <td className="title-cell">
                    {e.title}
                    <LatestComment e={e} />
                  </td>
                  <td>
                    {e.groups && e.groups.length ? (
                      <span className="grp-chips">{e.groups.map((g) => {
                        const lbl = lookups.grp.find((x) => x.code === g)?.label
                          || (e.custom_group_items || []).find((x) => x.code === g)?.label || g;
                        return <span key={g} className="grp-chip">{lbl}</span>;
                      })}</span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td><Pill value={e.status_code} /></td>
                  <td className="muted">{e.lead_name || e.smoc_lead || "—"}</td>
                  <td><Avatars people={e.resources} /></td>
                  <td className="num"><HoursBar actual={e.actual_hrs} approved={e.approved_hrs} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EnhancementForm
          initial={editing === "new" ? null : editing}
          lookups={lookups} resources={resources}
          onSave={save} onDelete={remove} onClose={() => setEditing(null)}
        />
      )}

      {confirmDel && (
        <Modal title={`Delete ${confirmDel.ticket}?`} onClose={() => setConfirmDel(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doRemove}>Delete</button>
          </>}>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            This permanently deletes <b>{confirmDel.ticket}</b> — {confirmDel.title} — and all of its logged effort. This can't be undone.
          </div>
        </Modal>
      )}

      {exporting && (
        <Modal title="Export enhancements to CSV" onClose={() => setExporting(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setExporting(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={exportCsv} disabled={!ENH_COLUMNS.some((c) => selCols[c.key]) || exportRows.length === 0}>Download CSV</button>
          </>}>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 12 }}>Columns to include:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px" }}>
            {ENH_COLUMNS.map((c) => (
              <label key={c.key} className="switch-row" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={!!selCols[c.key]}
                  onChange={(e) => setSelCols((s) => ({ ...s, [c.key]: e.target.checked }))} /> {c.label}
              </label>
            ))}
          </div>

          <div className="cd-sep" style={{ margin: "16px 0" }} />
          <div style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 10 }}>Rows to include <span className="muted" style={{ fontWeight: 400 }}>— starts from the page filters; change here to export a different set</span></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <GlassSelect value={exp.grp} onChange={(v) => setExp((s) => ({ ...s, grp: v }))} minWidth={150}
              options={[{ value: "", label: "All groups" }, ...lookups.grp.map((g) => ({ value: g.code, label: g.label }))]} />
            <GlassSelect value={exp.status} onChange={(v) => setExp((s) => ({ ...s, status: v }))} minWidth={170}
              options={[{ value: "", label: "All statuses" }, ...lookups.status.map((s) => ({ value: s.code, label: s.label }))]} />
            <label className="switch-row" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={exp.inactive} onChange={(e) => setExp((s) => ({ ...s, inactive: e.target.checked }))} /> Include inactive
            </label>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {exportAll === null ? "Loading…" : `${exportRows.length} enhancement${exportRows.length === 1 ? "" : "s"} will be exported.`}
          </div>
        </Modal>
      )}
    </>
  );
}
