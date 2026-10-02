import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { getRecentlyViewed, RecentItem } from "../lib/recently-viewed";
import { formatBytes, formatDate } from "../lib/utils";
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
} from "lucide-react";

export const HomePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Load recently viewed from IndexedDB
  useEffect(() => {
    getRecentlyViewed(8).then(setRecentItems);
  }, []);

  // Fetch top-level categories (folders in root)
  const { data: driveData, isLoading } = useQuery({
    queryKey: ["drive-categories"],
    queryFn: async () => {
      const res = await fetch("/api/drive/list");
      if (!res.ok) return { files: [] };
      return res.json();
    },
  });

  // Fetch storage
  const { data: storageData } = useQuery({
    queryKey: ["drive-storage"],
    queryFn: async () => {
      const res = await fetch("/api/drive/storage");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const categories = (driveData?.items || driveData?.files || []).filter(
    (item: any) => item.isFolder
  );

  const quota = storageData?.quota;
  const usageBytes = quota?.usageInDrive ? parseInt(quota.usageInDrive, 10) : 0;
  const limitBytes = quota?.limit ? parseInt(quota.limit, 10) : 15 * 1024 * 1024 * 1024;
  const usagePct = limitBytes > 0 ? Math.min(Math.round((usageBytes / limitBytes) * 100), 100) : 0;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/docs?q=${encodeURIComponent(searchQuery.trim())}`);
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
      {/* Welcome Banner & Search Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Vault Encrypted & Synced</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white font-['Outfit']">
            Good day, {user?.name?.split(" ")[0] || "User"}
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
        {/* Drive Storage Meter */}
        <div className="md:col-span-2 glass-card p-5 rounded-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Google Drive Quota</h3>
                <p className="text-[11px] text-muted-foreground">Admin Shared Storage</p>
              </div>
            </div>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-white/10 text-white">
              {usagePct}% used
            </span>
          </div>

          <div className="space-y-2 mt-2">
            <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(usagePct, 4)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatBytes(usageBytes)} used</span>
              <span>{formatBytes(limitBytes)} total capacity</span>
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

      {/* Top-Level Categories */}
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
              No category folders created yet in your Google Drive root.
            </p>
            <button
              onClick={() => navigate("/docs?action=new-folder")}
              className="px-4 py-2 rounded-xl bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-medium hover:bg-sky-500/30"
            >
              Create First Category
            </button>
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

      {/* Recently Viewed Files (Instant from IndexedDB) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white font-['Outfit']">Recently Viewed</h2>
          </div>
          {recentItems.length > 0 && (
            <span className="text-xs text-muted-foreground">Cached Locally</span>
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
