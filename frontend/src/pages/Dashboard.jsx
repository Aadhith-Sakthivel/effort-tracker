import React, { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api";
import { GlassSelect, Spinner, fmtHrs } from "../components/ui";
import { COLORS } from "../components/format";

function KpiCard({ label, value, unit, foot }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}{unit && <small> {unit}</small>}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

const axis = { fontSize: 12, fill: "var(--text-3)" };
const tip = {
  contentStyle: { borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-solid)", boxShadow: "var(--shadow)", fontSize: 13, color: "var(--text)" },
  itemStyle: { color: "var(--text)" },
  labelStyle: { color: "var(--text-2)" },
};

// Consecutive Sat/Sun day-number ranges in a month, for shaded weekend bands.
function weekendBands(byDay) {
  const wk = byDay
    .filter((d) => { const g = new Date(d.date + "T00:00:00").getDay(); return g === 0 || g === 6; })
    .map((d) => d.day);
  const ranges = [];
  for (const d of wk) {
    const last = ranges[ranges.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else ranges.push([d, d]);
  }
  return ranges;
}

const monthLabel = (ym) =>
  ym ? new Date(ym + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";

// Rich tooltip for the per-enhancement doughnut: ticket + title + hours.
function EnhTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-solid)",
                  boxShadow: "var(--shadow)", fontSize: 13, padding: "8px 12px", maxWidth: 260, color: "var(--text)" }}>
      <div style={{ fontWeight: 600 }}>{p.ticket}</div>
      {p.title && <div style={{ color: "var(--text-2)", fontSize: 12, margin: "2px 0 4px" }}>{p.title}</div>}
      <div style={{ color: "var(--text-3)" }}>{p.hours} h</div>
    </div>
  );
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState("");
  const [msum, setMsum] = useState(null);

  useEffect(() => {
    Promise.all([api.kpi(), api.byStatus(), api.byGroup(), api.hoursByMonth(), api.hoursByGroup()])
      .then(([kpi, byStatus, byGroup, byMonth, byGroupHours]) => setD({ kpi, byStatus, byGroup, byMonth, byGroupHours }));
    api.months().then((r) => { setMonths(r.months); setMonth(r.current); });
  }, []);

  useEffect(() => {
    if (!month) return;
    // Keep the current snapshot while the new month loads (no chart flicker).
    api.monthSummary(month).then(setMsum);
  }, [month]);

  if (!d) return <Spinner />;
  const util = d.kpi.total_approved_hrs ? Math.round((d.kpi.total_actual_hrs / d.kpi.total_approved_hrs) * 100) : 0;

  // Top enhancements by hours for the month doughnut (rest folded into "+N more").
  const topEnh = (() => {
    if (!msum || !msum.by_enhancement) return [];
    const arr = msum.by_enhancement;
    const top = arr.slice(0, 10).map((x) => ({ ...x }));
    const rest = arr.slice(10);
    if (rest.length) {
      top.push({ ticket: `+${rest.length} more`, title: `${rest.length} smaller tickets`,
                 hours: Math.round(rest.reduce((a, b) => a + b.hours, 0) * 10) / 10 });
    }
    return top;
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-sub">Live rollup across all enhancements and logged effort.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Enhancements" value={d.kpi.total_enhancements} foot={`${d.kpi.open_enhancements} open`} />
        <KpiCard label="Open" value={d.kpi.open_enhancements} foot="not completed / cancelled" />
        <KpiCard label="Actual hours" value={fmtHrs(d.kpi.total_actual_hrs)} unit="h" foot="logged to date" />
        <KpiCard label="Approved hours" value={fmtHrs(d.kpi.total_approved_hrs)} unit="h" foot={`${util}% utilised`} />
      </div>

      <div className="card chart-card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div className="chart-title" style={{ marginBottom: 0 }}>Monthly snapshot</div>
          <GlassSelect value={month} onChange={setMonth} align="right" minWidth={170}
            options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        </div>
        {!msum ? <Spinner /> : (
          <div className="ms-grid">
            {/* Enhancements by group */}
            <div>
              <div className="ms-sub">Enhancements by group · <b>{msum.enhancements}</b> worked</div>
              <div className="ms-chart">
                <div className="ms-donut">
                  {msum.by_group.length ? (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={msum.by_group} dataKey="count" nameKey="grp" cx="50%" cy="50%"
                               innerRadius={66} outerRadius={97} paddingAngle={2}>
                            {msum.by_group.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip {...tip} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="ms-center"><div><div className="n">{msum.enhancements}</div><div className="u">enhancements</div></div></div>
                    </>
                  ) : <div className="ms-empty">No activity</div>}
                </div>
                <div className="ms-legend">
                  {msum.by_group.map((e, i) => (
                    <div className="row" key={i}>
                      <span className="nm"><span className="ms-dot" style={{ background: COLORS[i % COLORS.length] }} />{e.grp}</span>
                      <span className="vl">{e.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Hours by enhancement */}
            <div>
              <div className="ms-sub">Hours by enhancement · <b>{fmtHrs(msum.hours)}</b> h</div>
              <div className="ms-chart">
                <div className="ms-donut">
                  {topEnh.length ? (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={topEnh} dataKey="hours" nameKey="ticket" cx="50%" cy="50%"
                               innerRadius={66} outerRadius={97} paddingAngle={2}>
                            {topEnh.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip content={<EnhTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="ms-center"><div><div className="n">{fmtHrs(msum.hours)}</div><div className="u">hours</div></div></div>
                    </>
                  ) : <div className="ms-empty">No activity</div>}
                </div>
                <div className="ms-legend">
                  {topEnh.map((e, i) => (
                    <div className="row" key={i} title={e.title}>
                      <span className="nm"><span className="ms-dot" style={{ background: COLORS[i % COLORS.length] }} />{e.ticket}</span>
                      <span className="vl">{e.hours}h</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {msum && msum.by_day && (
          <div style={{ marginTop: 18 }}>
            <div className="kpi-label" style={{ marginBottom: 8 }}>Hours per day</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={msum.by_day} margin={{ left: -20, right: 10, top: 4 }}>
                <defs>
                  <linearGradient id="dayln" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#0071e3" /><stop offset="100%" stopColor="#5e5ce6" />
                  </linearGradient>
                  <linearGradient id="wkband" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0a84ff" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#0a84ff" stopOpacity="0.03" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                {weekendBands(msum.by_day).map((r, i) => (
                  <ReferenceArea key={i} x1={r[0] - 0.5} x2={r[1] + 0.5} fill="url(#wkband)" fillOpacity={1} ifOverflow="hidden" />
                ))}
                <XAxis dataKey="day" type="number" domain={[0.5, msum.by_day.length + 0.5]}
                  ticks={msum.by_day.map((d) => d.day)} tick={{ ...axis, fontSize: 10 }}
                  tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tip} labelFormatter={(d) => `${monthLabel(month)} ${d}`} />
                <Line type="monotone" dataKey="hours" stroke="url(#dayln)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <div className="chart-title">Effort by month</div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.byMonth} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0071e3" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0071e3" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ ...axis, fontSize: 10.5 }} tickLine={false} axisLine={false} interval={0} angle={-35} textAnchor="end" height={50} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip {...tip} />
              <Area type="monotone" dataKey="hours" stroke="#0071e3" strokeWidth={2.5} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="chart-title">Enhancements by status</div>
          <div style={{ position: "relative", height: 240 }}>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={d.byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%"
                     innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {d.byStatus.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="ms-center">
              <div>
                <div className="n">{d.byStatus.reduce((a, b) => a + b.count, 0)}</div>
                <div className="u">enhancements</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8, fontSize: 12.5 }}>
            {d.byStatus.map((e, i) => (
              <span key={i} style={{ color: "var(--text-2)" }}>
                <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: COLORS[i % COLORS.length], marginRight: 6 }} />
                {e.status} ({e.count})
              </span>
            ))}
          </div>
        </div>

        <div className="card chart-card">
          <div className="chart-title">Enhancements by group</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={[...d.byGroup].sort((a, b) => b.count - a.count)} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="grp" tick={axis} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tip} cursor={{ fill: "var(--accent-soft)" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#0071e3" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="chart-title">Logged hours by group</div>
          {d.byGroupHours && d.byGroupHours.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.byGroupHours.slice(0, 10)} layout="vertical" margin={{ left: 20, right: 12, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="grp" tick={{ ...axis, fontSize: 12 }} width={76} interval={0} tickLine={false} axisLine={false} />
                <Tooltip {...tip} cursor={{ fill: "var(--accent-soft)" }} />
                <Bar dataKey="hours" radius={[0, 6, 6, 0]} fill="#30a46c" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 240, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13.5 }}>
              No hours logged yet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
