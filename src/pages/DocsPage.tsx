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
  AlertTriangle,
  RefreshCw,
  FolderPlus,
  Plus,
  Upload,
  CheckCircle2,
  Trash2,
  MoreVertical,
  LayoutGrid,
  List as ListIcon,
  CheckSquare,
  Square,
  RotateCcw,
  X,
  Download,
} from "lucide-react";
import { canUserDelete, DELETE_RESTRICTED_MESSAGE } from "../config/features";

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder?: boolean;
  size?: string;
  modifiedTime?: string;
  lastModifyingUser?: string;
  parents?: string[];
}

import { UploadModal } from "../components/docs/UploadModal";
import { NewFolderModal } from "../components/docs/NewFolderModal";
import { DocDetailPanel, DocItem } from "../components/docs/DocDetailPanel";
import { DocumentPreview } from "../components/docs/DocumentPreview";

export const DocsPage: React.FC = () => {
  const { user } = useAuth();
  const canDelete = canUserDelete(user?.role);

  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get("folderId") || undefined;
  const folderName = searchParams.get("folderName") || "Vault Root";
  const urlMsg = searchParams.get("msg");

  const [uploadToast, setUploadToast] = useState<{ show: boolean; fileName: string }>({
    show: false,
    fileName: "",
  });

  // Restricted toast for mobile tap and desktop tooltip feedback
  const [restrictedToast, setRestrictedToast] = useState<string | null>(urlMsg || null);

  // View mode: Grid vs List/Row
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Active open card menu (file id)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Admin Confirm Modal
  const [confirmTrashModal, setConfirmTrashModal] = useState<{
    isOpen: boolean;
    items: DriveItem[];
  } | null>(null);

  // Admin Undo Toast
  const [undoToast, setUndoToast] = useState<{
    show: boolean;
    items: DriveItem[];
    message: string;
  } | null>(null);

  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  // Modals & detail panel state
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocItem | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocItem | null>(null);

  // Clear msg search param once read
  useEffect(() => {
    if (urlMsg) {
      setRestrictedToast(urlMsg);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("msg");
      setSearchParams(newParams, { replace: true });
    }
  }, [urlMsg, searchParams, setSearchParams]);

  // Handle URL actions like /docs?action=upload or action=new-folder
  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "upload") {
      setShowUploadModal(true);
    } else if (action === "new-folder") {
      setShowNewFolderModal(true);
    }
  }, [searchParams]);

  // Auto-dismiss upload toast
  useEffect(() => {
    if (uploadToast.show) {
      const timer = setTimeout(() => {
        setUploadToast({ show: false, fileName: "" });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [uploadToast.show]);

  // Auto-dismiss restricted toast
  useEffect(() => {
    if (restrictedToast) {
      const timer = setTimeout(() => {
        setRestrictedToast(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [restrictedToast]);

  // Auto-dismiss undo toast
  useEffect(() => {
    if (undoToast?.show) {
      const timer = setTimeout(() => {
        setUndoToast(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [undoToast]);

  // Close menus on outside click
  useEffect(() => {
    const closeMenu = () => setOpenMenuId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  // Breadcrumb path history
  const [breadcrumbHistory, setBreadcrumbHistory] = useState<Array<{ id?: string; name: string }>>(
    folderId ? [{ name: "Vault Root" }, { id: folderId, name: folderName }] : [{ name: "Vault Root" }]
  );

  // Fetch drive items with TanStack Query
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["drive-list", folderId],
    queryFn: async () => {
      const url = new URL("/api/drive/list", window.location.origin);
      if (folderId) url.searchParams.set("folderId", folderId);

      const res = await fetch(url.toString());
      const resData = await res.json();
      if (!res.ok) {
        const err: any = new Error(resData.error || "Failed to load Drive items");
        err.code = resData.code;
        err.status = res.status;
        throw err;
      }
      return resData;
    },
    staleTime: 0,
  });

  // Handle URL fileId like /docs?fileId=xyz
  useEffect(() => {
    const fileIdParam = searchParams.get("fileId");
    if (fileIdParam) {
      const found = (data?.items || data?.files || []).find((f: any) => f.id === fileIdParam);
      if (found) {
        setPreviewDoc(found);
      }
    }
  }, [searchParams, data]);

  const isDriveDisconnected =
    (error as any)?.code === "ADMIN_DRIVE_NOT_CONNECTED" ||
    data?.code === "ADMIN_DRIVE_NOT_CONNECTED";

  const handleSeedCategories = async () => {
    setIsSeeding(true);
    setSeedMessage(null);
    try {
      const res = await fetch("/api/drive/seed-categories", { method: "POST" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to seed default categories");
      setSeedMessage(resData.message || "Default categories created successfully!");
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
    setSelectedIds([]);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumbHistory[index];
    setBreadcrumbHistory(breadcrumbHistory.slice(0, index + 1));
    setSelectedIds([]);
    if (!target.id) {
      setSearchParams({});
    } else {
      setSearchParams({ folderId: target.id, folderName: target.name });
    }
  };

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

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllFiles = () => {
    if (selectedIds.length === files.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(files.map((f) => f.id));
    }
  };

  const showDeleteRestricted = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setRestrictedToast(DELETE_RESTRICTED_MESSAGE);
  };

  const handleInitiateTrash = (itemsToTrash: DriveItem[]) => {
    if (!canDelete) {
      showDeleteRestricted();
      return;
    }
    setConfirmTrashModal({
      isOpen: true,
      items: itemsToTrash,
    });
  };

  const handleConfirmTrash = async () => {
    if (!confirmTrashModal || confirmTrashModal.items.length === 0) return;
    const itemsToTrash = confirmTrashModal.items;
    const fileIds = itemsToTrash.map((i) => i.id);

    try {
      const res = await fetch("/api/drive/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds,
          fileId: fileIds[0],
          name: itemsToTrash[0].name,
        }),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || "Failed to move items to Bin");
      }

      setConfirmTrashModal(null);
      setSelectedIds((prev) => prev.filter((id) => !fileIds.includes(id)));
      if (selectedDoc && fileIds.includes(selectedDoc.id)) {
        setSelectedDoc(null);
      }
      refetch();

      setUndoToast({
        show: true,
        items: itemsToTrash,
        message:
          itemsToTrash.length > 1
            ? `Moved ${itemsToTrash.length} items to Bin.`
            : `Moved "${itemsToTrash[0].name}" to Bin.`,
      });
    } catch (err: any) {
      alert(err.message || "Failed to move to Bin");
    }
  };

  const handleUndo = async () => {
    if (!undoToast || undoToast.items.length === 0) return;
    const itemsToRestore = undoToast.items;
    const fileIds = itemsToRestore.map((i) => i.id);

    try {
      const res = await fetch("/api/drive/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds,
          fileId: fileIds[0],
          name: itemsToRestore[0].name,
        }),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || "Failed to undo delete");
      }

      setUndoToast(null);
      refetch();
    } catch (err: any) {
      console.error("Failed to undo delete:", err);
    }
  };

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
    <div className="space-y-6 relative">
      {/* Upload Success Toast */}
      {uploadToast.show && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between gap-3 animate-slideDown shadow-lg shadow-emerald-500/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-white">Upload Successful</p>
              <p className="text-[11px] text-emerald-200/90">
                <strong>{uploadToast.fileName}</strong> has been saved directly to Google Drive.
              </p>
            </div>
          </div>
          <button
            onClick={() => setUploadToast({ show: false, fileName: "" })}
            className="text-emerald-400 hover:text-white p-1 text-sm font-semibold"
            aria-label="Dismiss toast"
          >
            ✕
          </button>
        </div>
      )}

      {/* Restricted Action Toast (Mobile tap & Laptop feedback) */}
      {restrictedToast && (
        <div
          data-testid="delete-restricted-toast"
          className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs flex items-center justify-between gap-3 animate-slideDown shadow-lg shadow-amber-500/10 z-40"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-white">Action Restricted</p>
              <p className="text-[11px] text-amber-200/90">{restrictedToast}</p>
            </div>
          </div>
          <button
            onClick={() => setRestrictedToast(null)}
            className="text-amber-400 hover:text-white p-1 text-sm font-semibold"
            aria-label="Dismiss toast"
          >
            ✕
          </button>
        </div>
      )}

      {/* Admin Drive Disconnected Banner */}
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
                  ? "Admin Google Drive is not connected. Reconnect Drive to access the family vault."
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

      {/* Top Header: Breadcrumbs & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

        {/* Action Controls & View Switcher */}
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "grid" ? "bg-white/15 text-white" : "text-muted-foreground hover:text-white"
              }`}
              title="Grid View"
              aria-label="Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "list" ? "bg-white/15 text-white" : "text-muted-foreground hover:text-white"
              }`}
              title="List View"
              aria-label="List View"
            >
              <ListIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-xs font-semibold text-sky-300 border border-sky-500/30 transition shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload</span>
          </button>
          <button
            onClick={() => setShowNewFolderModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-white border border-white/10 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Folder</span>
          </button>
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div
          data-testid="bulk-action-bar"
          className="sticky top-16 md:top-4 z-30 p-3 rounded-2xl bg-[#090d16]/95 border border-sky-500/30 backdrop-blur-xl shadow-xl flex items-center justify-between gap-3 animate-slideDown"
        >
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 font-mono text-xs font-semibold">
              {selectedIds.length} selected
            </span>
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs text-muted-foreground hover:text-white px-2 py-1 rounded-lg hover:bg-white/5 transition"
            >
              Clear
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              data-testid="bulk-delete-button"
              onClick={(e) => {
                e.stopPropagation();
                if (!canDelete) {
                  showDeleteRestricted(e);
                  return;
                }
                const selectedItems = files.filter((f) => selectedIds.includes(f.id));
                handleInitiateTrash(selectedItems);
              }}
              aria-disabled={!canDelete}
              title={canDelete ? "Move selected to Bin" : DELETE_RESTRICTED_MESSAGE}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                canDelete
                  ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/30 cursor-pointer active:scale-95"
                  : "bg-white/5 text-muted-foreground/40 border-white/5 opacity-50 cursor-not-allowed hover:bg-white/5"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected</span>
            </button>
          </div>
        </div>
      )}

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
            {isDriveDisconnected && user?.role === "admin" ? (
              <a
                href="/api/admin/drive/connect"
                className="px-4 py-2 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition"
              >
                Reconnect Drive
              </a>
            ) : (
              <button
                onClick={() => refetch()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold border border-rose-500/30 transition active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Request</span>
              </button>
            )}
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

          <div className="pt-2 flex flex-col items-center gap-2">
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Folder</span>
            </button>

            {isRoot && user?.role === "admin" && (
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
                  <p
                    className={`text-xs mt-2 font-medium ${
                      seedMessage.startsWith("Error") ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {seedMessage}
                  </p>
                )}
              </div>
            )}
          </div>
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Files ({files.length})
                  </h2>
                </div>

                <button
                  onClick={selectAllFiles}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition"
                >
                  {selectedIds.length === files.length ? (
                    <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  <span>{selectedIds.length === files.length ? "Deselect All" : "Select All"}</span>
                </button>
              </div>

              {/* GRID VIEW */}
              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {files.map((file) => {
                    const FileIcon = getFileIcon(file.mimeType);
                    const isSelected = selectedIds.includes(file.id);
                    const isMenuOpen = openMenuId === file.id;

                    return (
                      <div
                        key={file.id}
                        data-testid={`file-card-${file.id}`}
                        onClick={() => setPreviewDoc(file)}
                        className={`glass-card p-4 rounded-2xl flex flex-col justify-between h-36 transition-all cursor-pointer group hover:scale-[1.01] relative ${
                          isSelected ? "border-sky-500 bg-sky-500/5" : "hover:border-sky-500/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 overflow-hidden">
                            <button
                              type="button"
                              onClick={(e) => toggleSelect(file.id, e)}
                              className="p-1 rounded-md text-muted-foreground hover:text-sky-400 transition"
                              aria-label="Select file"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-sky-400" />
                              ) : (
                                <Square className="w-4 h-4 opacity-50 group-hover:opacity-100" />
                              )}
                            </button>

                            <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center flex-shrink-0 group-hover:bg-sky-500/20 transition-colors">
                              <FileIcon className="w-4 h-4" />
                            </div>

                            <div className="overflow-hidden">
                              <h4
                                className="text-xs font-semibold text-white truncate group-hover:text-sky-300 transition-colors"
                                title={file.name}
                              >
                                {file.name}
                              </h4>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {file.size ? formatBytes(parseInt(file.size, 10)) : "Document"}
                              </p>
                            </div>
                          </div>

                          {/* 3-dots Card Menu Button */}
                          <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              data-testid={`card-menu-trigger-${file.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(isMenuOpen ? null : file.id);
                              }}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition"
                              title="File actions"
                              aria-label="File actions"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>

                            {/* Dropdown Menu */}
                            {isMenuOpen && (
                              <div
                                data-testid={`card-menu-dropdown-${file.id}`}
                                className="absolute right-0 top-8 z-40 w-44 rounded-xl bg-[#0d131f] border border-white/10 shadow-2xl p-1.5 space-y-1 text-xs animate-scaleUp"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setPreviewDoc(file);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-sky-400 hover:text-sky-300 transition font-medium"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>Preview File</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setSelectedDoc(file);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition"
                                >
                                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span>View Details</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    window.open(`/api/drive/download?id=${file.id}`, "_blank");
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition"
                                >
                                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Download</span>
                                </button>
                                <div className="border-t border-white/5 my-1" />
                                <button
                                  type="button"
                                  data-testid={`card-menu-delete-${file.id}`}
                                  onClick={(e) => {
                                    setOpenMenuId(null);
                                    if (!canDelete) {
                                      showDeleteRestricted(e);
                                      return;
                                    }
                                    handleInitiateTrash([file]);
                                  }}
                                  aria-disabled={!canDelete}
                                  title={canDelete ? "Move to Bin" : DELETE_RESTRICTED_MESSAGE}
                                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition ${
                                    canDelete
                                      ? "hover:bg-rose-500/10 text-rose-400 cursor-pointer"
                                      : "opacity-50 cursor-not-allowed text-muted-foreground/50 hover:bg-transparent"
                                  }`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Move to Bin</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-white/5">
                          <span className="flex items-center gap-1 truncate max-w-[120px]">
                            <User className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            <span className="truncate">{file.lastModifyingUser || "Vault User"}</span>
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
              ) : (
                /* LIST / ROW VIEW */
                <div className="glass-card rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/5">
                  {files.map((file) => {
                    const FileIcon = getFileIcon(file.mimeType);
                    const isSelected = selectedIds.includes(file.id);

                    return (
                      <div
                        key={file.id}
                        data-testid={`file-row-${file.id}`}
                        onClick={() => setPreviewDoc(file)}
                        className={`p-3.5 flex items-center justify-between gap-3 hover:bg-white/5 cursor-pointer transition ${
                          isSelected ? "bg-sky-500/5" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={(e) => toggleSelect(file.id, e)}
                            className="p-1 rounded-md text-muted-foreground hover:text-sky-400 transition flex-shrink-0"
                            aria-label="Select file"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-sky-400" />
                            ) : (
                              <Square className="w-4 h-4 opacity-50" />
                            )}
                          </button>

                          <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center flex-shrink-0">
                            <FileIcon className="w-4 h-4" />
                          </div>

                          <div className="min-w-0">
                            <h4 className="text-xs font-semibold text-white truncate" title={file.name}>
                              {file.name}
                            </h4>
                            <p className="text-[11px] text-muted-foreground">
                              {file.size ? formatBytes(parseInt(file.size, 10)) : "Document"} •{" "}
                              {formatDate(file.modifiedTime)}
                            </p>
                          </div>
                        </div>

                        {/* Row Action Buttons */}
                        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => window.open(`/api/drive/download?id=${file.id}`, "_blank")}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition"
                            title="Download"
                            aria-label="Download"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          {/* Row Delete Button */}
                          <button
                            type="button"
                            data-testid={`file-row-delete-${file.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canDelete) {
                                showDeleteRestricted(e);
                                return;
                              }
                              handleInitiateTrash([file]);
                            }}
                            aria-disabled={!canDelete}
                            title={canDelete ? "Move to Bin" : DELETE_RESTRICTED_MESSAGE}
                            className={`p-1.5 rounded-lg border transition ${
                              canDelete
                                ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20 cursor-pointer active:scale-95"
                                : "bg-white/5 text-muted-foreground/40 border-white/5 opacity-50 cursor-not-allowed hover:bg-white/5"
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Admin Confirm Delete Modal */}
      {confirmTrashModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#090d16] border border-white/10 p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl animate-scaleUp">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-white">Move to Drive Bin?</h3>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                {confirmTrashModal.items.length === 1
                  ? `Are you sure you want to move "${confirmTrashModal.items[0].name}" to the Bin?`
                  : `Are you sure you want to move ${confirmTrashModal.items.length} items to the Bin?`}
                {" "}You can restore them at any time from the Drive Bin.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmTrashModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium border border-white/10 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmTrash}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold shadow-lg shadow-rose-500/20 transition active:scale-95"
              >
                Move to Bin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Undo Toast */}
      {undoToast?.show && (
        <div
          data-testid="undo-toast"
          className="fixed bottom-20 md:bottom-8 right-4 md:right-8 z-50 p-4 rounded-2xl bg-[#090d16]/95 border border-white/10 shadow-2xl backdrop-blur-xl flex items-center gap-4 text-xs animate-slideUp"
        >
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span className="text-white font-medium">{undoToast.message}</span>
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-semibold border border-sky-500/30 transition active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
          <button
            onClick={() => setUndoToast(null)}
            className="text-muted-foreground hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* New Folder Modal */}
      <NewFolderModal
        isOpen={showNewFolderModal}
        parentId={folderId || data?.rootFolderId}
        onClose={() => setShowNewFolderModal(false)}
        onSuccess={() => refetch()}
      />

      {/* Upload Modal */}
      <UploadModal
        isOpen={showUploadModal}
        parentId={folderId || data?.rootFolderId}
        onClose={() => setShowUploadModal(false)}
        onUploadSuccess={(uploadedName) => {
          refetch();
          setShowUploadModal(false);
          setUploadToast({
            show: true,
            fileName: uploadedName || "Document",
          });
        }}
      />

      {/* Document Detail & Action Panel */}
      <DocDetailPanel
        item={selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onOpenPreview={(item) => setPreviewDoc(item)}
        onShowRestrictedToast={(msg) => setRestrictedToast(msg)}
        onToggleStar={async (item) => {
          await fetch("/api/stars", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              driveId: item.id,
              name: item.name,
              isStarred: !item.starred,
            }),
          });
          refetch();
        }}
        onTrash={async (item) => {
          handleInitiateTrash([item]);
        }}
      />

      {/* Interactive In-App Document Preview */}
      <DocumentPreview
        item={previewDoc}
        onClose={() => {
          setPreviewDoc(null);
          if (searchParams.has("fileId")) {
            const next = new URLSearchParams(searchParams);
            next.delete("fileId");
            setSearchParams(next, { replace: true });
          }
        }}
        onDownloadOriginal={(item) => {
          window.open(`/api/drive/file?id=${encodeURIComponent(item.id)}&mode=download`, "_blank");
        }}
      />
    </div>
  );
};
