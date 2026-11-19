import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Empty, GlassSelect, LoadError, Modal, Spinner } from "../components/ui";

const DAILY_TARGET = 8; // hours flagged as "over" above this per cell

// First day of the month that is `n` months away from the month containing `iso`.
function addMonths(iso, n) {
  const d = new Date(iso + "T00:00:00");
  return new Date(d.getFullYear(), d.getMonth() + n, 1).toLocaleDateString("en-CA"); // YYYY-MM-DD
}
const firstOfMonth = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-CA");
};
const fmtCell = (v) => (v ? Number(v).toFixed(v % 1 ? 1 : 0) : "");
const fmtMonth = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
const prettyDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });

// A cell proposes a change (via onPropose); it always displays the committed `value`.
function Cell({ row, day, value, onPropose, isToday, canEdit, frozen }) {
  const [v, setV] = useState(fmtCell(value));
  useEffect(() => { setV(fmtCell(value)); }, [value]);
  const editable = canEdit && !frozen;   // frozen weeks are locked for everyone

  const propose = () => {
    const hrs = v === "" ? 0 : Number(v);
    if (Number.isNaN(hrs) || hrs === (value || 0)) { setV(fmtCell(value)); return; }
    onPropose(row, day, hrs);
    setV(fmtCell(value)); // revert display until confirmed; modal drives the commit
  };

  const num = value || 0;
  const cls = num > DAILY_TARGET ? "over" : num > 0 ? "filled" : "";
  return (
    <td className={`ts-cell ${cls} ${day.weekend ? "weekend" : ""} ${day.dow === "Mon" ? "monday" : ""} ${isToday ? "today" : ""} ${frozen ? "frozen" : ""}`}
        title={frozen ? "Locked — this week froze Friday 1 PM ET" : undefined}>
      <input
        value={v}
        inputMode="decimal"
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
        onChange={editable ? (e) => setV(e.target.value.replace(/[^\d.]/g, "")) : undefined}
        onFocus={editable ? (e) => e.target.select() : undefined}
        onBlur={editable ? propose : undefined}
        onKeyDown={editable ? (e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setV(fmtCell(value)); e.target.blur(); } } : undefined}
      />
    </td>
  );
}

function ConfirmChange({ pending, resourceId, resourceName, toast, onSaved, onCancel }) {
  const { row, day, prev, next } = pending;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [nextVal, setNextVal] = useState(String(next));

  // Whole-team mode: show the people actually assigned to this enhancement (lead first).
  const teamNames = [...(row.lead ? [row.lead] : []), ...(row.resources || []).filter((n) => n !== row.lead)];
  const whoLabel = resourceName
    || (teamNames.length ? `Whole team — ${teamNames.join(", ")}` : "Whole team (combined total)");

  const nextNum = nextVal === "" ? 0 : Number(nextVal) || 0;
  const delta = Math.round((nextNum - prev) * 100) / 100;
  const removing = nextNum === 0;

  const save = async () => {
    setBusy(true);
    try {
      await api.setCellGroup({ enhancement_id: row.enhancement_id, work_date: day.date,
        grp_code: row.grp_code || null, resource_id: resourceId || null, hours: nextNum, note: note || null });
      onSaved(nextNum);
    } catch (e) { toast(e.message, "error"); setBusy(false); }
  };

  return (
    <Modal
      title={removing ? "Remove time entry" : prev === 0 ? "Add time" : "Change time"}
      onClose={onCancel}
      footer={<>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn ${removing ? "btn-danger" : "btn-primary"}`} onClick={save} disabled={busy}>
          {busy ? "Saving…" : removing ? "Remove" : "Confirm"}
        </button>
      </>}
    >
      <div className="chg-meta">
        <div><span className="chg-k">Enhancement</span><span className="chg-v">{row.ticket} — {row.title}</span></div>
        <div><span className="chg-k">Group</span><span className="chg-v">{row.group_label || "—"}</span></div>
        <div><span className="chg-k">Date</span><span className="chg-v">{prettyDate(day.date)}</span></div>
        <div><span className="chg-k">Who</span><span className="chg-v">{whoLabel}</span></div>
      </div>

      <div className="chg-diff">
        <div className="chg-box prev"><div className="chg-lab">Previous</div><div className="chg-num">{prev ? prev.toFixed(prev % 1 ? 1 : 0) : "0"}<small>h</small></div></div>
        <div className="chg-arrow">→</div>
        <div className={`chg-box next ${removing ? "rm" : ""}`}>
          <div className="chg-lab">{removing ? "Removed" : "New"}</div>
          <div className="chg-num">
            <input className="chg-num-input" inputMode="decimal" value={nextVal} autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setNextVal(e.target.value.replace(/[^\d.]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) save(); }} />
            <small>h</small>
          </div>
        </div>
        <div className={`chg-delta ${delta > 0 ? "up" : "down"}`}>{delta > 0 ? "+" : ""}{delta}h</div>
      </div>

      {!removing && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>Note (optional) <span className="muted" style={{ fontWeight: 400 }}>— shows in this group's card tab</span></label>
          <input value={note} placeholder="What was worked on…" onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

export default function Timesheet({ lookups, resources, toast, canEdit = false }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [from, setFrom] = useState(null);
  const [, setTo] = useState(null);
  // Hours are the whole-team total per ticket/day (no per-person picker wired in).
  const [resourceId] = useState("");
  const [assignee, setAssignee] = useState("");   // filter rows to a person's assigned tickets
  const [status, setStatus] = useState("");       // filter rows to a status
  const [showInactive, setShowInactive] = useState(false);  // default: active enhancements only
  const [grp, setGrp] = useState("");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(null); // { row, day, prev, next }
  const scrollRef = useRef(null);
  const todayRef = useRef(null);

  const load = (df) => {
    // Keep the current grid visible during refetch (no blank flicker); Spinner only on first load.
    // df is the first-of-month anchor; backend fills the month end. No df => current EST month.
    api.timesheet({
      date_from: df || undefined,
      resource_id: resourceId || undefined, assignee_id: assignee || undefined,
      grp_code: grp || undefined, status_code: status || undefined, q: q || undefined,
      active_only: !showInactive,
      include_empty: true, // show every active ticket so time can be entered on any of them
    }).then((d) => { setData(d); setFrom(d.date_from); setTo(d.date_to); setErr(null); }).catch(setErr);
  };
  useEffect(() => { load(from); }, [resourceId, assignee, grp, status, q, showInactive]);

  // After each load, bring today's column into view (if this month contains it).
  useEffect(() => {
    if (data && todayRef.current) todayRef.current.scrollIntoView({ inline: "center", block: "nearest" });
  }, [data]);

  const shiftMonth = (n) => load(addMonths(from, n));
  const goToday = () => load(null);
  const isCurrentMonth = data && from && firstOfMonth(data.today) === firstOfMonth(from);

  const applyLocal = (eid, grp, date, hrs) => {
    setData((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => {
        if (r.enhancement_id !== eid || (r.grp_code || null) !== (grp || null)) return r;
        const cells = { ...r.cells };
        if (hrs === 0) delete cells[date]; else cells[date] = hrs;
        const total = Object.values(cells).reduce((a, b) => a + b, 0);
        return { ...r, cells, total: Math.round(total * 100) / 100 };
      });
      const day_totals = { ...prev.day_totals };
      day_totals[date] = Math.round(rows.reduce((a, r) => a + (r.cells[date] || 0), 0) * 100) / 100;
      return { ...prev, rows, day_totals };
    });
  };

  const propose = (row, day, next) => setPending({ row, day, prev: row.cells[day.date] || 0, next });

  // Called by the confirm popup after it saves a single group's hours.
  const onSaved = (total) => {
    const { row, day } = pending;
    applyLocal(row.enhancement_id, row.grp_code, day.date, total);
    toast(total === 0 ? "Entry removed" : `${row.ticket}${row.group_label ? " · " + row.group_label : ""}: ${total}h on ${day.dom}`);
    setPending(null);
  };

  const resourceName = resourceId ? (resources.find((r) => String(r.id) === String(resourceId))?.name) : null;
  // A date is frozen by a month lock if its month is listed AND (whole month, or day ≤ lock_day).
  const monthFrozen = (iso) => {
    if (!(data?.locked_months || []).includes(iso.slice(0, 7))) return false;
    const ld = data?.lock_day || "last";
    return ld === "last" || Number(iso.slice(8, 10)) <= Number(ld);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Timesheet</div>
          <div className="page-sub">Enter hours per day — every change is confirmed and logged.</div>
        </div>
        <div className="ts-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => shiftMonth(-1)} disabled={!from}>‹ Prev</button>
          <span className="ts-range">{from ? fmtMonth(from) : "…"}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => shiftMonth(1)} disabled={!from}>Next ›</button>
          <button className="btn btn-ghost btn-sm" onClick={goToday} disabled={!from || isCurrentMonth}
            style={{ visibility: isCurrentMonth ? "hidden" : "visible" }}>Today</button>
          <label className="switch-row" style={{ fontSize: 13.5, whiteSpace: "nowrap", marginLeft: 8 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search ticket or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        <GlassSelect value={assignee} onChange={setAssignee} minWidth={180}
          options={[{ value: "", label: "All assignees" }, ...resources.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))]} />
        <GlassSelect value={grp} onChange={setGrp} minWidth={150}
          options={[{ value: "", label: "All groups" }, ...lookups.grp.map((g) => ({ value: g.code, label: g.label }))]} />
        <GlassSelect value={status} onChange={setStatus} minWidth={160}
          options={[{ value: "", label: "All statuses" }, ...lookups.status.map((s) => ({ value: s.code, label: s.label }))]} />
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setQ(""); setAssignee(""); setGrp(""); setStatus(""); setShowInactive(false); }}>
          Clear filters
        </button>
      </div>

      <div className="card ts-scroll" ref={scrollRef}>
        {err && !data ? <LoadError error={err} onRetry={() => load(from)} /> : !data ? <Spinner /> : data.rows.length === 0 ? (
          <Empty icon="🗓️" title="No logged hours in this range" sub="Use Prev / Next to find data, or clear filters." />
        ) : (
          <table className="ts">
            <thead>
              <tr>
                <th className="sticky-col ts-ticket" style={{ textAlign: "left" }}>Enhancement</th>
                <th className="ts-grp-col">Group</th>
                <th className="ts-total-col">Total</th>
                {data.days.map((d) => (
                  <th key={d.date}
                      ref={d.date === data.today ? todayRef : null}
                      className={`ts-day ${d.weekend ? "weekend" : ""} ${d.dow === "Mon" ? "monday" : ""} ${d.date === data.today ? "today" : ""}`}>
                    <div className="ts-dow">{d.dow}</div>
                    <div className="ts-dom">{d.dom}</div>
                    {(() => {
                      const t = data.day_totals[d.date] || 0;
                      const cl = t === 0 ? "zero" : t >= DAILY_TARGET ? "ok" : "has";
                      return <div className={`ts-daytotal ${cl}`}>{t ? t.toFixed(t % 1 ? 1 : 0) : "·"}</div>;
                    })()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.enhancement_id}:${r.grp_code || ""}`} className={r.first ? "ts-enh-first" : ""}>
                  {r.first && (
                    <td className="sticky-col ts-ticket" rowSpan={r.row_span}>
                      <div className="tk">{r.ticket}</div>
                      <div className="tt" title={r.title}>{r.title}</div>
                    </td>
                  )}
                  <td className="ts-grp-col"><span className="grp-chip">{r.group_label || "—"}</span></td>
                  <td className="ts-total-col">{r.total ? r.total.toFixed(r.total % 1 ? 1 : 0) : "—"}</td>
                  {data.days.map((d) => (
                    <Cell key={d.date} row={r} day={d} value={r.cells[d.date]} onPropose={propose} isToday={d.date === data.today} canEdit={canEdit} frozen={(data.editable_from && d.date < data.editable_from) || monthFrozen(d.date)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 12 }}>
        {canEdit ? (
          <>Tip: click a cell, type hours, press <b>Enter</b> — you'll see a before/after confirmation before it saves. Hours are the team total per ticket/day. Weeks lock <b>Friday 1 PM ET</b>; earlier weeks are read-only.</>
        ) : (
          <>Read-only view — only people on the team can log time.</>
        )}
      </div>

      {pending && (
        <ConfirmChange pending={pending} resourceId={resourceId} resourceName={resourceName}
          toast={toast} onSaved={onSaved} onCancel={() => setPending(null)} />
      )}
    </>
  );
}
