import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, GlassSelect, LoadError, Pill, Spinner } from "../components/ui";
import { fmtET } from "../components/format";

const actionKind = { create: "pill-green", update: "pill-blue", delete: "pill-red" };

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [type, setType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [enh, setEnh] = useState([]);
  const [resources, setResources] = useState([]);
  const [err, setErr] = useState(null);

  // Lists for the dependent "specific entity" filter.
  useEffect(() => {
    api.enhancements({ active_only: false }).then(setEnh).catch(() => {});
    api.resources().then(setResources).catch(() => {});
  }, []);

  const loadRows = () => {
    setErr(null);
    // Keep rows during refetch (no flicker); Spinner only on first load.
    api.audit({ entity_type: type || undefined, entity_id: entityId || undefined, limit: 300 })
      .then(setRows).catch(setErr);
  };
  useEffect(() => { loadRows(); }, [type, entityId]);

  // When the entity type changes, reset the specific-entity selection.
  const changeType = (t) => { setType(t); setEntityId(""); };
  const clearFilters = () => { setType(""); setEntityId(""); setShowInactive(false); };
  const hasFilters = type || entityId || showInactive;

  // Options for the second filter, depending on the chosen type. Time-entry (effort)
  // audit rows are keyed by enhancement_id, so Time entries also filters by enhancement —
  // letting you see every time-log change made for one enhancement. "Show inactive"
  // includes inactive enhancements / resources in the picker list.
  const enhList = enh.filter((e) => showInactive || e.active);
  const resList = resources.filter((r) => showInactive || r.active);
  const entityOptions = (type === "enhancement" || type === "effort")
    ? [{ value: "", label: "All enhancements" }, ...enhList.map((e) => ({ value: String(e.id), label: `${e.ticket} — ${e.title}` }))]
    : type === "resource"
    ? [{ value: "", label: "All resources" }, ...resList.map((r) => ({ value: String(r.id), label: r.name }))]
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Audit log</div>
          <div className="page-sub">Every change — who, when, old → new. Append-only.</div>
        </div>
      </div>

      <div className="toolbar">
        <GlassSelect value={type} onChange={changeType} minWidth={170}
          options={[
            { value: "", label: "All entities" },
            { value: "enhancement", label: "Enhancements" },
            { value: "effort", label: "Time entries" },
            { value: "support_ticket", label: "Support tickets" },
            { value: "resource", label: "Resources" },
            { value: "group", label: "Groups" },
            { value: "status", label: "Statuses" },
            { value: "sub_status", label: "Sub-statuses" },
            { value: "setting", label: "Settings" },
          ]} />
        {entityOptions && (
          <GlassSelect value={entityId} onChange={setEntityId} minWidth={240} searchable options={entityOptions} />
        )}
        <label className="switch-row" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <button className="btn btn-ghost btn-sm" onClick={clearFilters} disabled={!hasFilters}>Clear filters</button>
      </div>

      <div className="card table-wrap">
        {err && !rows ? <LoadError error={err} onRetry={loadRows} /> : !rows ? <Spinner /> : rows.length === 0 ? (
          <Empty icon="📝" title="No activity yet" sub="Changes will appear here as the team edits data." />
        ) : (
          <table>
            <thead>
              <tr><th>When</th><th>User</th><th>Entity</th><th>Action</th><th>Change</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} style={{ cursor: "default" }}>
                  <td className="muted" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {fmtET(a.changed_at)}
                  </td>
                  <td>{a.changed_by}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.entity_label || `${a.entity_type} #${a.entity_id}`}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{a.entity_type}</div>
                  </td>
                  <td><span className={`pill ${actionKind[a.action] || "pill-gray"}`}>{a.action}</span></td>
                  <td className="audit-change">
                    {a.action === "update" ? (
                      <>
                        <span className="audit-field">{a.field}</span>:{" "}
                        <span className="old">{a.old_value || "∅"}</span>{" → "}
                        <span className="new">{a.new_value || "∅"}</span>
                      </>
                    ) : (
                      <span className="muted">{a.action === "create" ? "row created" : "row deleted"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
