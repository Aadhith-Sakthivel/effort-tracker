import React, { useEffect, useState } from "react";
import { api } from "../api";
import { GlassSelect, Modal, Spinner } from "../components/ui";

const DOW = [["0", "Monday"], ["1", "Tuesday"], ["2", "Wednesday"], ["3", "Thursday"], ["4", "Friday"], ["5", "Saturday"], ["6", "Sunday"]];
const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;
const fmtMonth = (m) => { try { return new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }); } catch { return m; } };
const MONTHS = [["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"], ["05", "May"], ["06", "June"],
  ["07", "July"], ["08", "August"], ["09", "September"], ["10", "October"], ["11", "November"], ["12", "December"]];
const YEAR_NOW = new Date().getFullYear();
const YEARS = [YEAR_NOW - 1, YEAR_NOW, YEAR_NOW + 1, YEAR_NOW + 2].map(String);
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
// "Last day (whole month)" + 1st..28th (28 is safe for every month; Last covers 29–31).
const FREEZE_DAYS = [{ value: "last", label: "Last day (whole month)" },
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1).padStart(2, "0"), label: `Through the ${ordinal(i + 1)}` }))];

// One editable row for a status (or sub-status when `sub`). Toggles save immediately;
// label/order save on blur when changed.
function LookupRow({ s, onSave, sub }) {
  const [label, setLabel] = useState(s.label);
  const [sort, setSort] = useState(s.sort_order);
  useEffect(() => { setLabel(s.label); setSort(s.sort_order); }, [s.code]);
  const save = (extra = {}) => onSave(s.code, {
    code: s.code, label, sort_order: Number(sort) || 100,
    ...(sub ? {} : { is_terminal: s.is_terminal, is_inactive: s.is_inactive }),
    active: s.active, ...extra,
  });
  return (
    <tr style={{ opacity: s.active ? 1 : 0.5 }}>
      <td><input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== s.label && save()} /></td>
      <td style={{ width: 90 }}><input type="number" value={sort} onChange={(e) => setSort(e.target.value)} onBlur={() => Number(sort) !== s.sort_order && save()} style={{ width: 70 }} /></td>
      {!sub && <td><label className="switch-row"><input type="checkbox" checked={s.is_terminal} onChange={(e) => save({ is_terminal: e.target.checked })} /> Done column</label></td>}
      {!sub && <td><label className="switch-row"><input type="checkbox" checked={s.is_inactive} onChange={(e) => save({ is_inactive: e.target.checked })} /> Marks inactive</label></td>}
      <td><span className={`pill ${s.active ? "pill-green" : "pill-gray"}`}>{s.active ? "Active" : "Retired"}</span></td>
      <td style={{ textAlign: "right" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => save({ active: !s.active })}>{s.active ? "Retire" : "Restore"}</button>
      </td>
    </tr>
  );
}

export default function Settings({ toast, onChanged, canEdit = false }) {
  const [data, setData] = useState(null);
  const [fz, setFz] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [newSub, setNewSub] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [fMonth, setFMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [fYear, setFYear] = useState(String(YEAR_NOW));
  const [addOpen, setAddOpen] = useState(false);
  const [savedWeekly, setSavedWeekly] = useState({ weekday: "4", hour: "13" });   // last-persisted weekly rule

  const load = () => api.settings().then((d) => {
    setData(d); setFz(d.freeze);
    setSavedWeekly({ weekday: String(d.freeze.weekday), hour: String(d.freeze.hour) });
  });
  useEffect(() => { load().catch((e) => toast(e.message, "error")); }, []);

  const afterChange = async () => { await load(); onChanged?.(); };
  const saveStatus = async (code, body) => { try { await api.updateStatus(code, body); toast("Status updated"); await afterChange(); } catch (e) { toast(e.message, "error"); } };
  const saveSub = async (code, body) => { try { await api.updateSubStatus(code, body); toast("Sub-status updated"); await afterChange(); } catch (e) { toast(e.message, "error"); } };
  const addStatus = async () => { const label = newStatus.trim(); if (!label) return; try { await api.createStatus({ label }); setNewStatus(""); toast("Status added"); await afterChange(); } catch (e) { toast(e.message, "error"); } };
  const addSub = async () => { const label = newSub.trim(); if (!label) return; try { await api.createSubStatus({ label }); setNewSub(""); toast("Sub-status added"); await afterChange(); } catch (e) { toast(e.message, "error"); } };
  const saveGroup = async (code, body) => { try { await api.updateGroup(code, body); toast("Group updated"); await afterChange(); } catch (e) { toast(e.message, "error"); } };
  const addGroup = async () => { const label = newGroup.trim(); if (!label) return; try { await api.createGroup({ label }); setNewGroup(""); toast("Group added"); await afterChange(); } catch (e) { toast(e.message, "error"); } };
  // Persist the whole freeze config (weekly rule + locked months) and refresh.
  const persist = async (next, msg) => {
    try { await api.setFreeze({ weekday: Number(next.weekday), hour: Number(next.hour), locked_months: next.locked_months || [], lock_day: next.lock_day || "last" }); setFz(next); toast(msg || "Freeze updated"); load(); }
    catch (e) { toast(e.message, "error"); }
  };
  const saveWeekly = () => persist(fz, "Weekly lock saved");
  const weeklyDirty = fz && (String(fz.weekday) !== savedWeekly.weekday || String(fz.hour) !== savedWeekly.hour);
  const setLockDay = (v) => persist({ ...fz, lock_day: v }, "Freeze cutoff updated");
  const addFreeze = async () => {
    const m = `${fYear}-${fMonth}`;
    if ((fz.locked_months || []).includes(m)) { setAddOpen(false); return; }
    await persist({ ...fz, locked_months: [...(fz.locked_months || []), m].sort() }, "Month frozen");
    setAddOpen(false);
  };
  const removeFreeze = (m) => persist({ ...fz, locked_months: (fz.locked_months || []).filter((x) => x !== m) }, "Month unfrozen");

  if (!data || !fz) return <Spinner />;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Statuses, sub-statuses, and the timesheet freeze rule.{canEdit ? "" : " Read-only: only leads can change these."}</div>
        </div>
      </div>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>

      {/* Timesheet freeze */}
      <div className="card" style={{ padding: "20px 22px", marginBottom: 18 }}>
        <div className="kpi-label" style={{ marginBottom: 12 }}>Weekly lock</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 180, marginBottom: 0 }}><label>Lock day</label>
            <GlassSelect block value={String(fz.weekday)} onChange={(v) => setFz((s) => ({ ...s, weekday: v }))} options={DOW.map(([v, l]) => ({ value: v, label: l }))} /></div>
          <div className="field" style={{ minWidth: 150, marginBottom: 0 }}><label>Lock time (ET)</label>
            <GlassSelect block value={String(fz.hour)} onChange={(v) => setFz((s) => ({ ...s, hour: v }))} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }))} /></div>
          {weeklyDirty
            ? <button className="btn btn-primary" onClick={saveWeekly}>Save weekly lock</button>
            : <span className="muted" style={{ fontSize: 12.5, paddingBottom: 10 }}>✓ Saved</span>}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Each week (Mon–Sun) locks at this day &amp; time ET; the next week opens automatically.</div>

        <div className="cd-sep" style={{ margin: "18px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div className="kpi-label">Active month freezes</div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setFMonth(String(new Date().getMonth() + 1).padStart(2, "0")); setFYear(String(YEAR_NOW)); setAddOpen(true); }}>+ Add freeze</button>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>Freeze every locked month up to:</span>
          <div style={{ minWidth: 220 }}><GlassSelect block value={fz.lock_day || "last"} onChange={setLockDay} options={FREEZE_DAYS} /></div>
        </div>
        {(fz.locked_months || []).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No months are frozen. (The weekly lock above still applies.)</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {fz.locked_months.map((m) => (
              <span key={m} className="chip-opt on" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {fmtMonth(m)}
                <button onClick={() => removeFreeze(m)} aria-label={`Unfreeze ${fmtMonth(m)}`}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title="Freeze a month" onClose={() => setAddOpen(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addFreeze} disabled={(fz.locked_months || []).includes(`${fYear}-${fMonth}`)}>Add freeze</button>
          </>}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Month to lock <span className="muted" style={{ fontWeight: 400 }}>— the “freeze up to” day below applies to it</span></label>
            <div style={{ display: "flex", gap: 10 }}>
              <GlassSelect block value={fMonth} onChange={setFMonth} options={MONTHS.map(([v, l]) => ({ value: v, label: l }))} />
              <GlassSelect block value={fYear} onChange={setFYear} options={YEARS.map((y) => ({ value: y, label: y }))} />
            </div>
          </div>
        </Modal>
      )}

      {/* Statuses */}
      <div className="card table-wrap" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "16px 16px 12px", flexWrap: "wrap" }}>
          <div className="kpi-label">Enhancement statuses <span className="muted" style={{ fontWeight: 400 }}>— board columns; retire instead of delete to keep history</span></div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="search" placeholder="New status name…" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStatus(); }} />
            <button className="btn btn-primary btn-sm" onClick={addStatus}>+ Add</button>
          </div>
        </div>
        <div className="lookup-scroll">
          <table className="lookup-table">
            <thead><tr><th>Label</th><th>Order</th><th>Done column</th><th>Marks inactive</th><th>State</th><th></th></tr></thead>
            <tbody>{data.statuses.map((s) => <LookupRow key={s.code} s={s} onSave={saveStatus} />)}</tbody>
          </table>
        </div>
      </div>

      {/* Sub-statuses */}
      <div className="card table-wrap">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "16px 16px 12px", flexWrap: "wrap" }}>
          <div className="kpi-label">Sub-statuses</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="search" placeholder="New sub-status name…" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSub(); }} />
            <button className="btn btn-primary btn-sm" onClick={addSub}>+ Add</button>
          </div>
        </div>
        <div className="lookup-scroll">
          <table className="lookup-table">
            <thead><tr><th>Label</th><th>Order</th><th>State</th><th></th></tr></thead>
            <tbody>{data.sub_statuses.map((s) => <LookupRow key={s.code} s={s} onSave={saveSub} sub />)}</tbody>
          </table>
        </div>
      </div>

      {/* Groups */}
      <div className="card table-wrap" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "16px 16px 12px", flexWrap: "wrap" }}>
          <div className="kpi-label">Groups <span className="muted" style={{ fontWeight: 400 }}>— shared across enhancements &amp; the timesheet; retire to hide from pickers</span></div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="search" placeholder="New group name…" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addGroup(); }} />
            <button className="btn btn-primary btn-sm" onClick={addGroup}>+ Add</button>
          </div>
        </div>
        <div className="lookup-scroll">
          <table className="lookup-table">
            <thead><tr><th>Label</th><th>Order</th><th>State</th><th></th></tr></thead>
            <tbody>{(data.groups || []).map((g) => <LookupRow key={g.code} s={g} onSave={saveGroup} sub />)}</tbody>
          </table>
        </div>
      </div>
      </fieldset>
    </>
  );
}
