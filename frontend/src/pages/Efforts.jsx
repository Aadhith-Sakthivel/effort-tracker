import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Modal, Select, Spinner, fmtHrs } from "../components/ui";

const today = () => new Date().toISOString().slice(0, 10);

function EffortForm({ initial, enhancements, resources, lookups, onSave, onClose, onDelete }) {
  const [f, setF] = useState({
    enhancement_id: "", resource_id: null, skill_code: null,
    work_date: today(), hours: "", note: "", ...initial,
  });
  const [err, setErr] = useState("");
  const isEdit = !!initial?.id;
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!f.enhancement_id) { setErr("Pick an enhancement."); return; }
    const hrs = Number(f.hours);
    if (!(hrs > 0)) { setErr("Hours must be greater than 0."); return; }
    if (hrs > 24) { setErr("A single entry can't exceed 24h — split it across days."); return; }
    try {
      await onSave({
        enhancement_id: Number(f.enhancement_id),
        resource_id: f.resource_id ? Number(f.resource_id) : null,
        skill_code: f.skill_code || null,
        work_date: f.work_date, hours: hrs, note: f.note || null,
      }, isEdit);
    } catch (e) { setErr(e.message); }
  };

  return (
    <Modal
      title={isEdit ? "Edit time entry" : "Log time"}
      onClose={onClose}
      footer={<>
        {isEdit && <button className="btn btn-danger btn-sm" style={{ marginRight: "auto" }} onClick={() => onDelete(initial)}>Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{isEdit ? "Save" : "Log time"}</button>
      </>}
    >
      {err && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <div className="field">
        <label>Enhancement *</label>
        <Select value={f.enhancement_id} onChange={set("enhancement_id")}
                options={enhancements.map((e) => ({ code: e.id, label: `${e.ticket} — ${e.title}` }))}
                placeholder="Select ticket…" />
      </div>
      <div className="field row2">
        <div><label>Resource</label><Select value={f.resource_id} onChange={set("resource_id")} options={resources} labelKey="name" valueKey="id" placeholder="—" /></div>
        <div><label>Skill</label><Select value={f.skill_code} onChange={set("skill_code")} options={lookups.skill_category} placeholder="—" /></div>
      </div>
      <div className="field row2">
        <div><label>Date *</label><input type="date" value={f.work_date} onChange={(e) => set("work_date")(e.target.value)} /></div>
        <div><label>Hours *</label><input type="number" min="0" max="24" step="0.25" value={f.hours} onChange={(e) => set("hours")(e.target.value)} /></div>
      </div>
      <div className="field"><label>Note</label><input value={f.note || ""} onChange={(e) => set("note")(e.target.value)} /></div>
    </Modal>
  );
}

export default function Efforts({ lookups, resources, toast }) {
  const [rows, setRows] = useState(null);
  const [enh, setEnh] = useState([]);
  const [enhFilter, setEnhFilter] = useState("");
  const [resFilter, setResFilter] = useState("");
  const [editing, setEditing] = useState(null);

  useEffect(() => { api.enhancements().then(setEnh); }, []);
  const load = () => {
    setRows(null);
    api.efforts({ enhancement_id: enhFilter || undefined, resource_id: resFilter || undefined }).then(setRows);
  };
  useEffect(load, [enhFilter, resFilter]);

  const ticketOf = (id) => enh.find((e) => e.id === id);
  const save = async (body, isEdit) => {
    if (isEdit) await api.updateEffort(editing.id, body);
    else await api.createEffort(body);
    setEditing(null); toast(isEdit ? "Time entry updated" : "Time logged"); load();
  };
  const remove = async (row) => {
    if (!confirm("Delete this time entry?")) return;
    await api.deleteEffort(row.id); setEditing(null); toast("Entry deleted"); load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Time entry</div>
          <div className="page-sub">One row per person · day · ticket — no more 500-column grid.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>+ Log time</button>
      </div>

      <div className="toolbar">
        <select className="filter" value={enhFilter} onChange={(e) => setEnhFilter(e.target.value)} style={{ flex: 1 }}>
          <option value="">All enhancements</option>
          {enh.map((e) => <option key={e.id} value={e.id}>{e.ticket} — {e.title}</option>)}
        </select>
        <select className="filter" value={resFilter} onChange={(e) => setResFilter(e.target.value)}>
          <option value="">All resources</option>
          {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        {!rows ? <Spinner /> : rows.length === 0 ? (
          <Empty icon="🕑" title="No time logged yet" sub="Click “Log time” to add an entry." />
        ) : (
          <table>
            <thead>
              <tr><th>Date</th><th>Ticket</th><th>Resource</th><th>Skill</th><th className="num">Hours</th><th>Note</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = ticketOf(r.enhancement_id);
                return (
                  <tr key={r.id} onClick={() => setEditing(r)}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.work_date}</td>
                    <td className="ticket-cell">{t ? t.ticket : r.enhancement_id}</td>
                    <td className="muted">{r.resource_name || "—"}</td>
                    <td className="muted">{r.skill_code || "—"}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtHrs(r.hours)}</td>
                    <td className="muted">{r.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EffortForm
          initial={editing === "new" ? null : editing}
          enhancements={enh} resources={resources} lookups={lookups}
          onSave={save} onDelete={remove} onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
