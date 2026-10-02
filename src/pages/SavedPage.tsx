import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listOfflineFiles, getOfflineFile, removeOfflineFile, OfflineFileMeta } from "../lib/offline-crypto";
import { formatBytes, formatDate } from "../lib/utils";
import { Star, Shield, Download, Trash2, FileText, ExternalLink, Bookmark } from "lucide-react";

export const SavedPage: React.FC = () => {
  const [offlineFiles, setOfflineFiles] = useState<OfflineFileMeta[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "starred" | "offline">("all");

  const loadOffline = async () => {
    const list = await listOfflineFiles();
    setOfflineFiles(list);
  };

  useEffect(() => {
    loadOffline();
  }, []);

  // Fetch Starred files from Neon + Drive
  const { data: starredData, isLoading: isStarredLoading } = useQuery({
    queryKey: ["starred-files"],
    queryFn: async () => {
      const res = await fetch("/api/stars?includeFiles=true");
      if (!res.ok) return { files: [] };
      return res.json();
    },
  });

  const starredFiles = starredData?.files || [];

  const handleOpenOffline = async (item: OfflineFileMeta) => {
    const result = await getOfflineFile(item.driveId);
    if (result) {
      const url = URL.createObjectURL(result.blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  const handleRemoveOffline = async (driveId: string) => {
    await removeOfflineFile(driveId);
    await loadOffline();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-2">
            <Bookmark className="w-3.5 h-3.5" />
            <span>Quick Access Vault</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white font-['Outfit']">
            Saved & Offline Vault
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Your starred favorites and AES-GCM encrypted offline copies on this device.
          </p>
        </div>

        {/* Tab switch for mobile */}
        <div className="flex sm:hidden bg-white/5 border border-white/10 rounded-xl p-1 text-xs">
          <button
            onClick={() => setActiveTab("all")}
            className={`flex-1 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === "all" ? "bg-white/10 text-white" : "text-muted-foreground"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setActiveTab("starred")}
            className={`flex-1 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === "starred" ? "bg-white/10 text-white" : "text-muted-foreground"
            }`}
          >
            Starred ({starredFiles.length})
          </button>
          <button
            onClick={() => setActiveTab("offline")}
            className={`flex-1 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === "offline" ? "bg-white/10 text-white" : "text-muted-foreground"
            }`}
          >
            Offline ({offlineFiles.length})
          </button>
        </div>
      </div>

      {/* Grid: Side-by-side on laptop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Starred Section */}
        {(activeTab === "all" || activeTab === "starred") && (
          <section className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <h2 className="text-base font-bold text-white font-['Outfit']">
                  Starred Documents ({starredFiles.length})
                </h2>
              </div>
            </div>

            {isStarredLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : starredFiles.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white/5 border border-white/5 text-center text-xs text-muted-foreground">
                No documents starred yet. Click the star icon on any document to add it here.
              </div>
            ) : (
              <div className="space-y-2.5">
                {starredFiles.map((file: any) => (
                  <div
                    key={file.id}
                    className="glass-card p-3.5 rounded-2xl flex items-center justify-between group hover:border-amber-500/30"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-xs font-semibold text-white truncate group-hover:text-amber-300 transition-colors">
                          {file.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {file.size ? formatBytes(parseInt(file.size, 10)) : "File"} • {formatDate(file.modifiedTime)}
                        </p>
                      </div>
                    </div>

                    <a
                      href={`/api/drive/download?id=${file.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Offline Encrypted Vault Section */}
        {(activeTab === "all" || activeTab === "offline") && (
          <section className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-bold text-white font-['Outfit']">
                  Local Encrypted Copies ({offlineFiles.length})
                </h2>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono">
                AES-GCM 256-bit
              </span>
            </div>

            {offlineFiles.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white/5 border border-white/5 text-center text-xs text-muted-foreground space-y-1">
                <p>No offline copies on this device.</p>
                <p className="text-[11px] text-muted-foreground/70">
                  Open any document detail panel and tap &ldquo;Save Offline&rdquo; to store encrypted copies for offline access.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {offlineFiles.map((item) => (
                  <div
                    key={item.driveId}
                    className="glass-card p-3.5 rounded-2xl flex items-center justify-between group hover:border-emerald-500/30"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-xs font-semibold text-white truncate group-hover:text-emerald-300 transition-colors">
                          {item.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatBytes(item.size)} • Saved {formatDate(item.savedAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleOpenOffline(item)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-medium flex items-center gap-1"
                        title="Decrypt and View"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open</span>
                      </button>
                      <button
                        onClick={() => handleRemoveOffline(item.driveId)}
                        className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400"
                        title="Remove from device"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

