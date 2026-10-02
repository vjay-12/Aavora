import React, { useState, useEffect } from "react";
import { RefreshCw, WifiOff, X } from "lucide-react";
import { Workbox } from "workbox-window";

export const PwaUpdatePrompt: React.FC = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [wb, setWb] = useState<Workbox | null>(null);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);

  useEffect(() => {
    // Monitor online / offline network state
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Register PWA service worker via workbox-window
    if (typeof window !== "undefined" && "serviceWorker" in navigator && import.meta.env.PROD) {
      const workbox = new Workbox("/sw.js");

      workbox.addEventListener("waiting", () => {
        setNeedRefresh(true);
      });

      workbox.register().catch((err) => {
        console.warn("[PWA]: SW registration error:", err);
      });

      setWb(workbox);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleUpdate = () => {
    if (wb) {
      wb.addEventListener("controlling", () => {
        window.location.reload();
      });
      wb.messageSkipWaiting();
    } else {
      window.location.reload();
    }
  };

  return (
    <>
      {/* Offline Status Banner */}
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-50 bg-amber-500/90 backdrop-blur-md text-amber-950 px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 shadow-lg"
        >
          <WifiOff className="w-4 h-4 text-amber-950" />
          <span>You are offline. Showing cached vault documents.</span>
        </div>
      )}

      {/* New Version Available Update Prompt */}
      {needRefresh && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 max-w-sm w-[calc(100vw-2rem)] p-4 rounded-2xl bg-[#0e1526]/95 border border-sky-500/30 shadow-2xl backdrop-blur-xl text-white flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-5"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center flex-shrink-0 text-sky-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">New Version Available</p>
              <p className="text-[11px] text-muted-foreground truncate">Update now for latest features.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleUpdate}
              className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 text-xs font-semibold transition"
            >
              Update
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-white transition"
              aria-label="Dismiss update notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
