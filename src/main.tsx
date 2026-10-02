import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { restoreQueryCache, persistQueryCache } from "./lib/query-client";
// Clean up any stale Service Workers on localhost
if (typeof navigator !== "undefined" && "serviceWorker" in navigator && window.location.hostname === "localhost") {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
  });
}

// Initialize app with restored offline cache
async function initApp() {
  try {
    await restoreQueryCache();
  } catch (err) {
    console.warn("Could not restore query cache:", err);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

initApp();
