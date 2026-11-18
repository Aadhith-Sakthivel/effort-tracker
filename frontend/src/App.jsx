import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import appLogo from "./assets/logo.svg";
import { api } from "./api";
import { Spinner, ToastStack } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Dashboard from "./pages/Dashboard.jsx";
import Enhancements from "./pages/Enhancements.jsx";
import Timesheet from "./pages/Timesheet.jsx";
import Board from "./pages/Board.jsx";
import Resources from "./pages/Resources.jsx";
import SupportTickets from "./pages/SupportTickets.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";

const NAV = [
  { key: "dashboard", label: "Overview", ico: "◎" },
  { key: "enhancements", label: "Enhancements", ico: "▤" },
  { key: "board", label: "Board", ico: "▦" },
  { key: "timesheet", label: "Timesheet", ico: "🗓" },
  { key: "support", label: "Support tickets", ico: "🎫" },
  { key: "resources", label: "Team", ico: "👥" },
  { key: "audit", label: "Audit log", ico: "↻" },
  { key: "settings", label: "Settings", ico: "⚙" },
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [lookups, setLookups] = useState(null);
  const [resources, setResources] = useState([]);
  const [me, setMe] = useState(null);
  const [toasts, setToasts] = useState([]);     // { id, type, msg }
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("theme") || "dark"; } catch { return "dark"; } });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);
  const canEditAll = !!me?.can_edit_all;        // lead → enhancements + team
  const canEdit = !!me?.can_edit;               // lead or member → board + timesheet
  // The logged-in person's own resource row (match by SSO email) — used to default
  // the Timesheet to "log my own time" instead of a combined team total.
  const myResourceId = me?.email
    ? (resources.find((r) => r.email && r.email.toLowerCase() === me.email.toLowerCase())?.id ?? "")
    : "";

  const dismissToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = (m, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, msg: m }]);
    setTimeout(() => dismissToast(id), type === "error" ? 5000 : 3000);
  };
  const loadResources = () => api.resources().then(setResources);

  // Sliding "liquid" nav indicator — tracks the active tab's position.
  const navRefs = useRef({});
  const [ind, setInd] = useState({ left: 0, width: 0, ready: false });
  useLayoutEffect(() => {
    const el = navRefs.current[page];
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  }, [page]);

  useEffect(() => {
    Promise.all([api.lookups(), api.resources(), api.me()]).then(([lk, rs, m]) => {
      setLookups(lk); setResources(rs); setMe(m);
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo"><img src={appLogo} alt="Effort Tracker" /></div>
          <div>
            <div className="brand-name">Effort Tracker</div>
            <div className="brand-sub">Enhancements</div>
          </div>
        </div>
        <nav className="nav-wrap">
          <motion.div className="nav-indicator"
            initial={false}
            animate={{ left: ind.left, width: ind.width, opacity: ind.ready ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.9 }} />
          {NAV.filter((n) => !n.leadOnly || canEditAll).map((n) => (
            <button key={n.key} ref={(el) => (navRefs.current[n.key] = el)}
                    className={`nav-item ${page === n.key ? "active" : ""}`} onClick={() => setPage(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {me && (
            <div className="whoami">
              <span className="whoami-email" title={me.email}>{me.email}</span>
              <span className={`pill ${canEditAll ? "pill-purple" : canEdit ? "pill-green" : "pill-gray"}`} style={{ fontSize: 10 }}>
                {canEditAll ? "Lead" : canEdit ? "Member" : "Viewer"}
              </span>
            </div>
          )}
          <button className="theme-toggle" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle dark mode" title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <main className="main">
        {!lookups ? <Spinner /> : (
          <ErrorBoundary key={page}>
            <div className="page-fade">
              {page === "dashboard" && <Dashboard />}
              {page === "enhancements" && <Enhancements lookups={lookups} resources={resources} toast={toast} canEdit={canEditAll} />}
              {page === "board" && <Board lookups={lookups} resources={resources} toast={toast} canEdit={canEdit} />}
              {page === "timesheet" && <Timesheet lookups={lookups} resources={resources} toast={toast} canEdit={canEdit} meResourceId={myResourceId} />}
              {page === "support" && <SupportTickets toast={toast} resources={resources} canEditAll={canEditAll} canEdit={canEdit} />}
              {page === "resources" && <Resources toast={toast} onChanged={loadResources} canEdit={canEditAll} canContact={canEdit} meEmail={me?.email} />}
              {page === "audit" && <Audit />}
              {page === "settings" && <Settings toast={toast} canEdit={canEditAll} onChanged={() => api.lookups().then(setLookups)} />}
            </div>
          </ErrorBoundary>
        )}
      </main>

      <ToastStack toasts={toasts} onClose={dismissToast} />
    </div>
  );
}
