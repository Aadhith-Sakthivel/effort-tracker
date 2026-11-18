import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import appLogo from "./assets/logo.svg";
import "./styles.css";
import "./styles-glass.css"; // Liquid Glass skin (remove this line to revert)

// Favicon from the bundled app logo.
const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/svg+xml";
favicon.href = appLogo;
document.head.appendChild(favicon);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
