import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRecentlyViewed, RecentItem } from "../lib/recently-viewed";
import { formatBytes, formatDate } from "../lib/utils";
import { getGreeting } from "../lib/user-format";
import {
  Folder,
  FileText,
  Clock,
  HardDrive,
  Plus,
  ArrowRight,
  Search,
  Sparkles,
  ShieldCheck,
  Upload,
  AlertTriangle,
  FolderPlus,
} from "lucide-react";

export const HomePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const driveConnected = searchParams.get("driveConnected") === "true" || searchParams.get("admin_drive_connected") === "true";
  const [showConnectedToast, setShowConnectedToast] = useState(driveConnected);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    if (driveConnected) {
      setShowConnectedToast(true);
      // Immediately invalidate drive queries so pre-connect stale error states are purged
      queryClient.invalidateQueries({ queryKey: ["admin-drive-status"] });
      queryClient.invalidateQueries({ queryKey: ["drive-categories"] });
      queryClient.invalidateQueries({ queryKey: ["drive-storage"] });

      const timer = setTimeout(() => {
        setShowConnectedToast(false);
        searchParams.delete("driveConnected");
        searchParams.delete("admin_drive_connected");
        setSearchParams(searchParams, { replace: true });
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [driveConnected, queryClient, searchParams, setSearchParams]);

  // Load recently viewed files (saved locally on this device)
  useEffect(() => {
    getRecentlyViewed(8).then(setRecentItems);
  }, []);

  // Fetch Admin Drive Status (Banner control: missing row or invalid_grant ONLY)
  const { data: driveStatus } = useQuery({
    queryKey: ["admin-drive-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/drive/status");
      if (!res.ok) return null;
      return res.json() as Promise<{ connected: boolean; reason: string | null }>;
    },
    enabled: user?.role === "admin",
    staleTime: 30000,
  });

  // Fetch top-level categories (folders in vault root only)
  const {
    data: driveData,
    isLoading,
    refetch: refetchDrive,
  } = useQuery({
    queryKey: ["drive-categories"],
    queryFn: async () => {
      const res = await fetch("/api/drive/list");
      const data = await res.json();
      return { status: res.status, ...data };
    },
  });

  // Fetch storage quota (from admin Drive token)
  const { data: storageData } = useQuery({
    queryKey: ["drive-storage"],
    queryFn: async () => {
      const res = await fetch("/api/drive/storage");
      const data = await res.json();
      return { status: res.status, ...data };
    },
  });

  // Show disconnected banner ONLY for missing row, invalid_grant, or decrypt failure.
  // Treat network, 5xx, and rate-limit errors as transient (no banner).
  // Never show success and disconnected banners simultaneously.
  const isDriveDisconnected =
    !showConnectedToast &&
    (user?.role === "admin"
      ? driveStatus?.connected === false &&
        (driveStatus.reason === "TOKEN_MISSING" ||
          driveStatus.reason === "GOOGLE_INVALID_GRANT" ||
          driveStatus.reason === "DECRYPT_FAILED" ||
          driveStatus.reason === "ADMIN_DRIVE_NOT_CONNECTED")
      : driveData?.code === "ADMIN_DRIVE_NOT_CONNECTED" ||
        storageData?.code === "ADMIN_DRIVE_NOT_CONNECTED");

  const categories = (driveData?.items || driveData?.files || []).filter(
    (item: any) => item.isFolder
  );

  const quota = storageData?.quota;
  const usageBytes = quota?.usage ? parseInt(quota.usage, 10) : 0;
  const isUnlimited = quota?.isUnlimited || !quota?.limit;
  const limitBytes = !isUnlimited && quota?.limit ? parseInt(quota.limit, 10) : 0;
  const usagePct =
    !isUnlimited && limitBytes > 0
      ? Math.min(Math.round((usageBytes / limitBytes) * 100), 100)
      : 0;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/docs?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleSeedDefaultCategories = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch("/api/drive/seed-categories", { method: "POST" });
      if (res.ok) {
        refetchDrive();
      }
    } catch (err) {
      console.error("Failed to seed categories:", err);
    } finally {
      setIsSeeding(false);
    }
  };

  const categoryThemes = [
    { gradient: "from-sky-500/20 to-blue-600/20", border: "border-sky-500/30", text: "text-sky-400" },
    { gradient: "from-indigo-500/20 to-purple-600/20", border: "border-indigo-500/30", text: "text-indigo-400" },
    { gradient: "from-emerald-500/20 to-teal-600/20", border: "border-emerald-500/30", text: "text-emerald-400" },
    { gradient: "from-amber-500/20 to-orange-600/20", border: "border-amber-500/30", text: "text-amber-400" },
    { gradient: "from-rose-500/20 to-pink-600/20", border: "border-rose-500/30", text: "text-rose-400" },
    { gradient: "from-violet-500/20 to-fuchsia-600/20", border: "border-violet-500/30", text: "text-violet-400" },
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Drive Connected Success Toast */}
      {showConnectedToast && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between gap-3 animate-slideDown shadow-lg shadow-emerald-500/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-white">Google Drive Connected Successfully!</p>
              <p className="text-[11px] text-emerald-200/90">Your documents are ready. Everything is up to date.</p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowConnectedToast(false);
              searchParams.delete("driveConnected");
              searchParams.delete("admin_drive_connected");
              setSearchParams(searchParams, { replace: true });
            }}
            className="text-emerald-400 hover:text-white p-1 text-sm font-semibold"
            aria-label="Dismiss toast"
          >
            ✕
          </button>
        </div>
      )}

      {/* Admin Drive Not Connected Banner */}
      {isDriveDisconnected && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-slideDown">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {user?.role === "admin" ? "Google Drive Disconnected" : "Vault Temporarily Unavailable"}
              </h3>
              <p className="text-xs text-amber-200/80">
                {user?.role === "admin"
                  ? "Google Drive is not connected. Reconnect to access your family documents."
                  : "Vault is temporarily unavailable, contact the admin."}
              </p>
            </div>
          </div>
          {user?.role === "admin" && (
            <a
              href="/api/admin/drive/connect"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition"
            >
              Reconnect Drive
            </a>
          )}
        </div>
      )}

      {/* Welcome Banner & Search Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Your documents are safe</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white font-['Outfit']">
            {getGreeting(user)}
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Your family documents are safe and accessible.
          </p>
        </div>

        {/* Global Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents, tags..."
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 focus:bg-[#0d1322] border border-white/10 focus:border-sky-500 text-xs md:text-sm text-white placeholder-muted-foreground transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
        </form>
      </div>

      {/* Storage & Quick Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Drive Storage Meter - Labeled "Vault storage (admin Drive)" */}
        <div className="md:col-span-2 glass-card p-5 rounded-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Storage used</h3>
                <p className="text-[11px] text-muted-foreground">Shared family storage</p>
              </div>
            </div>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-white/10 text-white">
              {isUnlimited ? "Unlimited" : `${usagePct}% used`}
            </span>
          </div>

          <div className="space-y-2 mt-2">
            <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 h-full rounded-full transition-all duration-500"
                style={{ width: isUnlimited ? "100%" : `${Math.max(usagePct, 4)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatBytes(usageBytes)} used</span>
              <span>{isUnlimited ? "Unlimited plan" : `${formatBytes(limitBytes)} total capacity`}</span>
            </div>
          </div>
        </div>

        {/* Quick Actions Card */}
        <div className="glass-card p-5 rounded-2xl flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quick Actions
            </span>
            <Sparkles className="w-4 h-4 text-sky-400" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate("/docs?action=upload")}
              className="flex items-center justify-center gap-2 p-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>Upload</span>
            </button>
            <button
              onClick={() => navigate("/docs?action=new-folder")}
              className="flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Folder</span>
            </button>
          </div>
        </div>
      </div>

      {/* Top-Level Categories (Folders directly under DRIVE_ROOT_FOLDER_ID only) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5 text-sky-400" />
            <h2 className="text-lg font-bold text-white font-['Outfit']">Categories</h2>
          </div>
          <button
            onClick={() => navigate("/docs")}
            className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-medium"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-white/10 text-center space-y-3">
            <Folder className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-xs text-muted-foreground">
              No category folders found in the vault root.
            </p>
            {user?.role === "admin" ? (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  onClick={() => navigate("/docs?action=new-folder")}
                  className="px-4 py-2 rounded-xl bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-medium hover:bg-sky-500/30 transition"
                >
                  <Plus className="w-3.5 h-3.5 inline mr-1" />
                  <span>Create Folder</span>
                </button>
                <button
                  onClick={handleSeedDefaultCategories}
                  disabled={isSeeding}
                  className="px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 transition"
                >
                  <FolderPlus className="w-3.5 h-3.5 inline mr-1" />
                  <span>{isSeeding ? "Creating..." : "Create Default Categories"}</span>
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Vault is empty. Ask an admin to organize folders.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {categories.map((cat: any, index: number) => {
              const theme = categoryThemes[index % categoryThemes.length];
              return (
                <div
                  key={cat.id}
                  onClick={() =>
                    navigate(`/docs?folderId=${cat.id}&folderName=${encodeURIComponent(cat.name)}`)
                  }
                  className={`glass-card p-4 rounded-2xl border ${theme.border} cursor-pointer group flex flex-col justify-between h-32 hover:scale-[1.02] transition-all`}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${theme.gradient} flex items-center justify-center ${theme.text}`}
                    >
                      <Folder className="w-5 h-5" />
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-sky-300 transition-colors">
                      {cat.name}
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {cat.modifiedTime ? `Updated ${formatDate(cat.modifiedTime)}` : "Folder"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recently Viewed Files (Device-Local) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white font-['Outfit']">Recently Viewed</h2>
          </div>
          {recentItems.length > 0 && (
            <span className="text-xs text-muted-foreground">Saved on this device</span>
          )}
        </div>

        {recentItems.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white/5 border border-white/5 text-center text-xs text-muted-foreground">
            No recently opened files on this device yet. Open any document in Docs to see it here instantly.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {recentItems.map((item) => (
              <div
                key={item.id}
                onClick={() => navigate(`/docs?fileId=${item.id}`)}
                className="glass-card p-3.5 rounded-xl flex items-center gap-3 cursor-pointer group hover:border-indigo-500/30"
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-xs font-medium text-white truncate group-hover:text-indigo-300 transition-colors">
                    {item.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {formatDate(item.viewedAt)} {item.size ? `• ${formatBytes(item.size)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
