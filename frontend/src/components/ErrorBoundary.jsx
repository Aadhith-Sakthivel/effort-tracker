import React from "react";

/** Catches render/runtime errors in a page so one crash doesn't blank the whole app.
 *  Keyed by page in App so switching tabs always mounts a fresh boundary (auto-recovers). */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    // Surface for diagnosis.
    console.error("Page crashed:", err, info?.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: "48px 24px", textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Something went wrong on this page.</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 18, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {String(this.state.err?.message || this.state.err)}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn btn-ghost" onClick={() => this.setState({ err: null })}>Try again</button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
