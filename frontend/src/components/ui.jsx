import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { statusClass } from "../api";

// Custom styled dropdown (native <select> can't be styled when open).
// The menu renders in a body portal with fixed positioning so it never gets
// clipped by a scrollable/blurred ancestor (e.g. the modal).
export function GlassSelect({ value, onChange, options, placeholder = "Select", minWidth = 160, align = "left", block = false, searchable = false }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [query, setQuery] = useState("");
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const reposition = () => triggerRef.current && setRect(triggerRef.current.getBoundingClientRect());
    // Capture phase: fires before a Modal (or anything) can stopPropagation on mousedown,
    // so clicking anywhere other than the trigger/options always closes the menu.
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open && triggerRef.current) { setRect(triggerRef.current.getBoundingClientRect()); setQuery(""); }
    setOpen((o) => !o);
  };
  const sel = options.find((o) => String(o.value) === String(value));
  const shown = searchable && query.trim()
    ? options.filter((o) => String(o.label).toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const menuStyle = rect ? {
    position: "fixed", top: rect.bottom + 6, width: "max-content",
    minWidth: Math.max(rect.width, 150), maxWidth: "min(360px, calc(100vw - 16px))",
    ...(align === "right"
      ? { right: Math.max(8, window.innerWidth - rect.right), left: "auto" }
      : { left: rect.left, right: "auto" }),
  } : {};

  return (
    <div className={`gsel ${block ? "block" : ""}`} style={block ? undefined : { width: minWidth }}>
      <button type="button" ref={triggerRef} className={`gsel-trigger ${open ? "open" : ""}`} onClick={toggle}>
        <span className="gsel-val">{sel ? sel.label : placeholder}</span>
        <svg className={`gsel-chev ${open ? "up" : ""}`} width="11" height="7" viewBox="0 0 11 7" aria-hidden="true">
          <path d="M1 1l4.5 4.5L10 1" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        <div className="gsel-menu" ref={menuRef} style={menuStyle}>
          {searchable && (
            <input className="gsel-search" autoFocus value={query} placeholder="Search…"
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          )}
          <div className="gsel-opts">
            {shown.map((o) => (
              <button type="button" key={String(o.value)}
                className={`gsel-opt ${String(o.value) === String(value) ? "sel" : ""}`}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span className="gsel-check">{String(o.value) === String(value) ? "✓" : ""}</span>
                {o.label}
              </button>
            ))}
            {shown.length === 0 && <div className="gsel-empty">No matches</div>}
          </div>
        </div>, document.body)}
    </div>
  );
}

export function Pill({ value, kind }) {
  if (!value) return <span className="muted">—</span>;
  return <span className={`pill ${kind || statusClass(value)}`}>{value}</span>;
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Empty({ icon = "📭", title, sub }) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <div style={{ fontWeight: 600, color: "var(--text-2)" }}>{title}</div>
      {sub && <div style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Error state for a page whose initial data load failed (infinite-spinner guard).
export function LoadError({ error, onRetry }) {
  return (
    <div className="empty">
      <div className="empty-ico">⚠️</div>
      <div style={{ fontWeight: 600, color: "var(--text-2)" }}>Couldn’t load this page</div>
      <div className="muted" style={{ marginTop: 4, maxWidth: 440 }}>
        {String(error?.message || error || "Something went wrong.")}
      </div>
      {onRetry && (
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, footer }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    // Entrance is a pure CSS keyframe (.modal, @keyframes modalIn), NOT framer-
    // motion: CSS applies the `from` state before the first paint, so there's no
    // flash-of-final-state that a JS-driven mount can cause (this was the flicker
    // on every popup). The blur/dim is a STATIC sibling layer behind the modal,
    // never an ancestor, so the entrance never re-rasterizes a backdrop filter.
    <div className="overlay" onMouseDown={onClose}>
      <div className="overlay-blur" aria-hidden="true" />
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="close-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const TOAST_META = {
  success: { title: "Success", cls: "tc-success", icon: "✓" },
  error:   { title: "Error",   cls: "tc-error",   icon: "✕" },
  info:    { title: "Info",    cls: "tc-info",    icon: "i" },
};

export function ToastStack({ toasts, onClose }) {
  return (
    <div className="toast-stack">
      <AnimatePresence initial={false}>
        {(toasts || []).map((t) => {
          const m = TOAST_META[t.type] || TOAST_META.info;
          return (
            <motion.div key={t.id} className={`toastc ${m.cls}`}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 500, damping: 34, mass: 0.8 }}>
              <span className="toastc-ico">{m.icon}</span>
              <div className="toastc-body">
                <div className="toastc-title">{t.title || m.title}</div>
                <div className="toastc-msg">{t.msg}</div>
              </div>
              <button className="toastc-x" onClick={() => onClose(t.id)} aria-label="Dismiss">✕</button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function Select({ value, onChange, options, placeholder = "—", labelKey = "label", valueKey = "code" }) {
  const opts = [{ value: "", label: placeholder }, ...options.map((o) => ({ value: o[valueKey], label: o[labelKey] }))];
  return (
    <GlassSelect block value={value == null ? "" : value} placeholder={placeholder}
      onChange={(v) => onChange(v === "" ? null : v)} options={opts} />
  );
}

// Toggleable chips for selecting several codes at once (e.g. groups).
export function ChipMultiSelect({ options, value, onChange, labelKey = "label", valueKey = "code" }) {
  const sel = value || [];
  const toggle = (code) => onChange(sel.includes(code) ? sel.filter((c) => c !== code) : [...sel, code]);
  return (
    <div className="chip-select">
      {options.map((o) => (
        <button type="button" key={o[valueKey]}
          className={`chip-opt ${sel.includes(o[valueKey]) ? "on" : ""}`}
          onClick={() => toggle(o[valueKey])}>
          {o[labelKey]}
        </button>
      ))}
    </div>
  );
}

export function fmtHrs(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
