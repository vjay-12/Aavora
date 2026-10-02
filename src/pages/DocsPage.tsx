import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { formatBytes, formatDate } from "../lib/utils";
import {
  Folder,
  FileText,
  ChevronRight,
  User,
  Clock,
  FolderOpen,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  FolderPlus,
} from "lucide-react";

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size?: string;
  modifiedTime?: string;
  lastModifyingUser?: string;
  parents?: string[];
}

export const DocsPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get("folderId") || undefined;
  const folderName = searchParams.get("folderName") || "Vault Root";
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  // Breadcrumb path history
  const [breadcrumbHistory, setBreadcrumbHistory] = useState<Array<{ id?: string; name: string }>>(
    folderId ? [{ name: "Vault Root" }, { id: folderId, name: folderName }] : [{ name: "Vault Root" }]
  );

  // Fetch drive items with TanStack Query (stale-while-revalidate)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["drive-list", folderId],
    queryFn: async () => {
      const url = new URL("/api/drive/list", window.location.origin);
      if (folderId) url.searchParams.set("folderId", folderId);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to load Drive items");
      }
      return res.json();
    },
    staleTime: 0, // Stale-while-revalidate: display cache immediately, revalidate in background
  });

  const handleSeedCategories = async () => {
    setIsSeeding(true);
    setSeedMessage(null);
    try {
      const res = await fetch("/api/drive/seed-categories", { method: "POST" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to seed default categories");
      setSeedMessage(`Successfully created ${resData.createdCount} default categories!`);
      refetch();
    } catch (err: any) {
      setSeedMessage(`Error: ${err.message}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const items: DriveItem[] = data?.items || [];
  const isRoot = !folderId || folderId === data?.rootFolderId;

  const folders = items.filter((i) => i.isFolder);
  const files = items.filter((i) => !i.isFolder);

  const handleOpenFolder = (folder: DriveItem) => {
    setSearchParams({ folderId: folder.id, folderName: folder.name });
    setBreadcrumbHistory((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumbHistory[index];
    setBreadcrumbHistory(breadcrumbHistory.slice(0, index + 1));
    if (!target.id) {
      setSearchParams({});
    } else {
      setSearchParams({ folderId: target.id, folderName: target.name });
    }
  };

  // Handle back button navigation
  const handleBack = () => {
    if (breadcrumbHistory.length > 1) {
      handleBreadcrumbClick(breadcrumbHistory.length - 2);
    } else {
      setSearchParams({});
      setBreadcrumbHistory([{ name: "Vault Root" }]);
    }
  };

  // Sync breadcrumbs on browser back/forward navigation
  useEffect(() => {
    if (!folderId) {
      setBreadcrumbHistory([{ name: "Vault Root" }]);
    } else if (breadcrumbHistory.length <= 1) {
      setBreadcrumbHistory([{ name: "Vault Root" }, { id: folderId, name: folderName }]);
    }
  }, [folderId, folderName]);

  const categoryPalettes = [
    { bg: "from-sky-500/20 to-blue-600/10", border: "border-sky-500/30", icon: "text-sky-400" },
    { bg: "from-indigo-500/20 to-purple-600/10", border: "border-indigo-500/30", icon: "text-indigo-400" },
    { bg: "from-emerald-500/20 to-teal-600/10", border: "border-emerald-500/30", icon: "text-emerald-400" },
    { bg: "from-amber-500/20 to-orange-600/10", border: "border-amber-500/30", icon: "text-amber-400" },
    { bg: "from-rose-500/20 to-pink-600/10", border: "border-rose-500/30", icon: "text-rose-400" },
    { bg: "from-violet-500/20 to-fuchsia-600/10", border: "border-violet-500/30", icon: "text-violet-400" },
  ];

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes("image")) return FileImage;
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet;
    if (mimeType.includes("video")) return FileVideo;
    if (mimeType.includes("audio")) return FileAudio;
    if (mimeType.includes("pdf") || mimeType.includes("document")) return FileText;
    return FileText;
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation & Back Button */}
      <div className="flex items-center gap-3">
        {!isRoot && (
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-muted-foreground hover:text-white transition active:scale-95 border border-white/5 flex-shrink-0"
            aria-label="Back to previous folder"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
        )}

        <div className="flex items-center gap-1.5 text-xs md:text-sm overflow-x-auto py-1">
          {breadcrumbHistory.map((crumb, idx) => (
            <React.Fragment key={crumb.name + idx}>
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
              <button
                onClick={() => handleBreadcrumbClick(idx)}
                className={`hover:text-white transition-colors truncate max-w-[150px] ${
                  idx === breadcrumbHistory.length - 1
                    ? "font-semibold text-white pointer-events-none"
                    : "text-muted-foreground"
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-8 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-center space-y-4 max-w-lg mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Google Drive Error</h3>
            <p className="text-xs text-rose-300/90 mt-1 max-w-md mx-auto leading-relaxed">
              {(error as any)?.message}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold border border-rose-500/30 transition active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Request</span>
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="p-10 rounded-3xl border border-dashed border-white/10 text-center space-y-4 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto text-muted-foreground">
            <FolderOpen className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">This folder is empty</h3>
            <p className="text-xs text-muted-foreground mt-1">
              No files or subfolders found in this directory.
            </p>
          </div>

          {isRoot && (user?.role === "admin" || !user) && (
            <div className="pt-2 space-y-2">
              <button
                onClick={handleSeedCategories}
                disabled={isSeeding}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-sky-500/20 transition active:scale-95 disabled:opacity-50"
              >
                {isSeeding ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Creating Categories...</span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="w-4 h-4" />
                    <span>Create Default Categories</span>
                  </>
                )}
              </button>
              <p className="text-[11px] text-muted-foreground">
                Sets up Identity, Medical, Property, Finance, Education, and Vehicle folders.
              </p>
              {seedMessage && (
                <p className={`text-xs mt-2 font-medium ${seedMessage.startsWith("Error") ? "text-rose-400" : "text-emerald-400"}`}>
                  {seedMessage}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Top-Level Root Folders as Category Cards */}
          {folders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {isRoot ? "Categories" : "Subfolders"} ({folders.length})
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {folders.map((folder, index) => {
                  const palette = categoryPalettes[index % categoryPalettes.length];
                  return (
                    <div
                      key={folder.id}
                      onClick={() => handleOpenFolder(folder)}
                      className={`glass-card p-5 rounded-2xl border ${palette.border} bg-gradient-to-br ${palette.bg} cursor-pointer group flex flex-col justify-between h-32 hover:scale-[1.01] transition-all`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                          <Folder className={`w-5 h-5 ${palette.icon}`} />
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-white truncate group-hover:text-sky-300 transition-colors">
                          {folder.name}
                        </h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {folder.modifiedTime ? `Updated ${formatDate(folder.modifiedTime)}` : "Folder"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Files List / Grid */}
          {files.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Files ({files.length})
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.mimeType);

                  return (
                    <div
                      key={file.id}
                      className="glass-card p-4 rounded-2xl flex flex-col justify-between h-32 transition-all hover:border-sky-500/30"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center flex-shrink-0">
                          <FileIcon className="w-4 h-4" />
                        </div>
                        <div className="overflow-hidden">
                          <h4 className="text-xs font-semibold text-white truncate" title={file.name}>
                            {file.name}
                          </h4>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {file.size ? formatBytes(parseInt(file.size, 10)) : "Document"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-white/5">
                        <span className="flex items-center gap-1 truncate max-w-[120px]">
                          <User className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                          <span className="truncate">{file.lastModifyingUser}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-sky-400 flex-shrink-0" />
                          <span>{formatDate(file.modifiedTime)}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
