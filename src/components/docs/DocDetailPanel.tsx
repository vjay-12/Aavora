import React, { useState, useEffect } from "react";
import { formatBytes, formatDate } from "../../lib/utils";
import { getUserFullName } from "../../lib/user-format";
import { addRecentlyViewed } from "../../lib/recently-viewed";
import {
  X,
  Star,
  Tag,
  FileText,
  Clock,
  User,
  Folder,
  Edit3,
  Check,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export interface DocItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  starred?: boolean;
  isFolder?: boolean;
  uploadedByName?: string;
  appProperties?: Record<string, string>;
  thumbnailLink?: string;
  webViewLink?: string;
  parents?: string[];
  folderName?: string;
}

interface DocDetailPanelProps {
  item: DocItem | null;
  onClose: () => void;
  onToggleStar: (item: DocItem) => Promise<void>;
  onOpenPreview?: (item: DocItem) => void;
}

export const DocDetailPanel: React.FC<DocDetailPanelProps> = ({
  item,
  onClose,
  onToggleStar,
  onOpenPreview,
}) => {
  const { user, isAdmin } = useAuth();
  const canDelete = Boolean(isAdmin ?? user?.isAdmin);

  // Admin edit uploader state
  const [isEditingUploader, setIsEditingUploader] = useState(false);
  const [uploaderInput, setUploaderInput] = useState("");
  const [isSavingUploader, setIsSavingUploader] = useState(false);
  const [overrideUploaderName, setOverrideUploaderName] = useState<string | null>(null);

  useEffect(() => {
    if (item && !item.isFolder) {
      addRecentlyViewed({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size ? parseInt(item.size, 10) : undefined,
        modifiedTime: item.modifiedTime,
        thumbnailLink: item.thumbnailLink,
      });
    }
    setOverrideUploaderName(null);
    setIsEditingUploader(false);
  }, [item]);

  if (!item) return null;

  const handleSaveUploader = async () => {
    if (!uploaderInput.trim()) return;
    setIsSavingUploader(true);
    try {
      const res = await fetch("/api/drive/edit-uploader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveId: item.id,
          uploaderName: uploaderInput.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to update uploader");
      const data = await res.json();
      setOverrideUploaderName(data.uploadedByName || uploaderInput.trim());
      setIsEditingUploader(false);
    } catch (err) {
      console.error("Failed to update uploader:", err);
    } finally {
      setIsSavingUploader(false);
    }
  };

  // Uploader resolution: never default to Vault Admin; fall back to Unknown
  const resolvedUploader =
    overrideUploaderName ||
    item.uploadedByName ||
    item.appProperties?.uploadedByName ||
    (item.appProperties?.uploadedBy && item.appProperties.uploadedBy !== "Vault Admin"
      ? getUserFullName({ email: item.appProperties.uploadedBy })
      : "Unknown");

  const tags = item.appProperties?.tags
    ? typeof item.appProperties.tags === "string" && item.appProperties.tags.startsWith("[")
      ? JSON.parse(item.appProperties.tags)
      : typeof item.appProperties.tags === "string"
      ? item.appProperties.tags.split(",")
      : []
    : [];
  const notes = item.appProperties?.notes || "";

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#090d16] border-l border-white/10 shadow-2xl flex flex-col justify-between overflow-y-auto animate-slideIn">
      {/* Header - Contains Star and Close */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#090d16]/95 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="doc-detail-star-btn"
            onClick={() => onToggleStar(item)}
            aria-pressed={Boolean(item.starred)}
            aria-label={item.starred ? "Remove star" : "Star"}
            title={item.starred ? "Remove star" : "Star"}
            className={`p-2 rounded-xl border transition-colors flex items-center justify-center min-h-[44px] min-w-[44px] ${
              item.starred
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"
            }`}
          >
            <Star
              className={`w-4 h-4 transition-transform active:scale-125 ${
                item.starred
                  ? "fill-amber-400 stroke-amber-400 text-amber-400"
                  : "fill-transparent stroke-current"
              }`}
            />
          </button>
          <span className="text-xs font-semibold text-white">Document Details</span>
        </div>
        <button
          type="button"
          data-testid="doc-detail-close"
          onClick={onClose}
          aria-label="Close details"
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content */}
      <div className="p-5 space-y-6 flex-1">
        {/* Preview / Monogram Box */}
        <div
          data-testid="doc-detail-preview-box"
          onClick={() => onOpenPreview?.(item)}
          className="h-44 rounded-2xl bg-gradient-to-b from-white/5 to-white/[0.02] border border-white/10 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer hover:border-sky-500/50 transition-colors"
          title="Click to preview document"
        >
          {item.thumbnailLink ? (
            <img
              src={item.thumbnailLink}
              alt={item.name}
              className="w-full h-full object-cover rounded-2xl"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="w-12 h-12 rounded-2xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-mono uppercase">
                {item.mimeType.split("/")[1] || "File"}
              </span>
            </div>
          )}
        </div>

        {/* Name and ID */}
        <div>
          <h2 className="text-base font-bold text-white break-words">{item.name}</h2>
          <p className="text-xs text-muted-foreground font-mono mt-1 break-all">
            ID: {item.id}
          </p>
        </div>

        {/* Metadata Information */}
        <div className="space-y-3 bg-white/5 p-4 rounded-2xl border border-white/5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              Modified
            </span>
            <span className="font-medium text-white">{formatDate(item.modifiedTime)}</span>
          </div>

          {item.folderName && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-purple-400" />
                Folder
              </span>
              <span className="font-medium text-white truncate max-w-[180px]">
                {item.folderName}
              </span>
            </div>
          )}

          {item.size && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Size</span>
              <span className="font-medium text-white">{formatBytes(parseInt(item.size, 10))}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              Uploaded By
            </span>

            {isEditingUploader ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={uploaderInput}
                  onChange={(e) => setUploaderInput(e.target.value)}
                  placeholder="Enter name"
                  className="px-2 py-1 bg-black/50 border border-white/20 rounded text-xs text-white w-28 focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={handleSaveUploader}
                  disabled={isSavingUploader || !uploaderInput.trim()}
                  className="p-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 disabled:opacity-50 min-h-[30px] min-w-[30px] flex items-center justify-center"
                  title="Save uploader"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingUploader(false)}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-white min-h-[30px] min-w-[30px] flex items-center justify-center"
                  title="Cancel"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{resolvedUploader}</span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploaderInput(resolvedUploader === "Unknown" ? "" : resolvedUploader);
                      setIsEditingUploader(true);
                    }}
                    className="p-1 rounded-md text-muted-foreground hover:text-sky-400 transition min-h-[30px] min-w-[30px] flex items-center justify-center"
                    title="Edit uploader name"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-purple-400" />
              Tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t: string, idx: number) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-medium"
                >
                  #{String(t).trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {notes && (
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Notes</span>
            <p className="text-xs text-foreground bg-white/5 p-3 rounded-xl border border-white/5 whitespace-pre-wrap leading-relaxed">
              {notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
