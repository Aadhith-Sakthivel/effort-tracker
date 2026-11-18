// Thin fetch wrapper around the FastAPI backend.
const BASE = "";

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      const d = body?.detail ?? body;
      if (Array.isArray(d)) detail = d.map((x) => x?.msg || x?.message || JSON.stringify(x)).join("; ");
      else if (typeof d === "string") detail = d;
      else if (d && typeof d === "object") detail = d.msg || d.message || JSON.stringify(d);
      else if (d) detail = String(d);
    } catch {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

const qs = (params) => {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return p.length ? "?" + new URLSearchParams(p).toString() : "";
};

export const api = {
  me: () => req("/api/me"),
  lookups: () => req("/api/lookups"),
  resources: (f) => req("/api/resources" + qs(f)),
  createResource: (b) => req("/api/resources", { method: "POST", body: JSON.stringify(b) }),
  updateResource: (id, b) => req(`/api/resources/${id}`, { method: "PUT", body: JSON.stringify(b) }),

  timesheet: (f) => req("/api/timesheet" + qs(f)),
  setCell: (b) => req("/api/timesheet/cell", { method: "PUT", body: JSON.stringify(b) }),
  cellDetail: (f) => req("/api/timesheet/cell-detail" + qs(f)),
  setCellGroups: (b) => req("/api/timesheet/cell-groups", { method: "PUT", body: JSON.stringify(b) }),
  setCellGroup: (b) => req("/api/timesheet/cell-group", { method: "PUT", body: JSON.stringify(b) }),

  settings: () => req("/api/settings"),
  setFreeze: (b) => req("/api/settings/freeze", { method: "PUT", body: JSON.stringify(b) }),
  createStatus: (b) => req("/api/settings/statuses", { method: "POST", body: JSON.stringify(b) }),
  updateStatus: (code, b) => req(`/api/settings/statuses/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(b) }),
  createSubStatus: (b) => req("/api/settings/sub-statuses", { method: "POST", body: JSON.stringify(b) }),
  updateSubStatus: (code, b) => req(`/api/settings/sub-statuses/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(b) }),

  enhancements: (f) => req("/api/enhancements" + qs(f)),
  enhancement: (id) => req(`/api/enhancements/${id}`),
  createEnhancement: (b) => req("/api/enhancements", { method: "POST", body: JSON.stringify(b) }),
  updateEnhancement: (id, b) => req(`/api/enhancements/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteEnhancement: (id) => req(`/api/enhancements/${id}`, { method: "DELETE" }),
  enhancementGroupDetail: (id) => req(`/api/enhancements/${id}/group-detail`),
  addEnhancementComment: (id, grp_code, body) => req(`/api/enhancements/${id}/comment`, { method: "POST", body: JSON.stringify({ grp_code, body }) }),
  setEnhancementGroupSubStatus: (id, grp_code, sub_status_code) => req(`/api/enhancements/${id}/group-substatus`, { method: "PUT", body: JSON.stringify({ grp_code, sub_status_code }) }),
  addEnhancementLink: (id, name, url) => req(`/api/enhancements/${id}/links`, { method: "POST", body: JSON.stringify({ name, url }) }),
  deleteEnhancementLink: (id, linkId) => req(`/api/enhancements/${id}/links/${linkId}`, { method: "DELETE" }),

  efforts: (f) => req("/api/efforts" + qs(f)),
  createEffort: (b) => req("/api/efforts", { method: "POST", body: JSON.stringify(b) }),
  updateEffort: (id, b) => req(`/api/efforts/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteEffort: (id) => req(`/api/efforts/${id}`, { method: "DELETE" }),

  kpi: () => req("/api/dashboard/kpi"),
  byStatus: () => req("/api/dashboard/by-status"),
  byGroup: () => req("/api/dashboard/by-group"),
  hoursByMonth: () => req("/api/dashboard/hours-by-month"),
  hoursByResource: () => req("/api/dashboard/hours-by-resource"),
  hoursByGroup: () => req("/api/dashboard/hours-by-group"),
  months: () => req("/api/dashboard/months"),
  monthSummary: (month) => req("/api/dashboard/month" + (month ? `?month=${month}` : "")),

  audit: (f) => req("/api/audit" + qs(f)),

  supportTickets: (f) => req("/api/support-tickets" + qs(f)),
  supportTicket: (id) => req(`/api/support-tickets/${id}`),
  createSupportTicket: (b) => req("/api/support-tickets", { method: "POST", body: JSON.stringify(b) }),
  updateSupportTicket: (id, b) => req(`/api/support-tickets/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  addSupportComment: (id, body) => req(`/api/support-tickets/${id}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
};

// Map a status/sub-status string to a semantic pill color class.
export function statusClass(s) {
  if (!s) return "pill-gray";
  const t = s.toLowerCase();
  if (t.includes("complet")) return "pill-green";
  if (t.includes("cancel")) return "pill-amber";   // cancelled = yellowish-orange
  if (t.includes("withdraw")) return "pill-red";
  if (t.includes("uat") || t.includes("test")) return "pill-purple";
  if (t.includes("hold") || t.includes("wait")) return "pill-amber";
  if (t.includes("progress") || t.includes("working")) return "pill-blue";
  return "pill-gray";
}
