import React, { useState, useEffect } from "react";
import { formatBytes, formatDate } from "../../lib/utils";
import {
  saveFileOffline,
  removeOfflineFile,
  isFileOffline,
} from "../../lib/offline-crypto";
import { addRecentlyViewed } from "../../lib/recently-viewed";
import {
  X,
  Star,
  Download,
  Trash2,
  HardDriveDownload,
  CheckCircle,
  Tag,
  FileText,
  Clock,
  User,
  Shield,
  Loader2,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { canUserDelete, DELETE_RESTRICTED_MESSAGE } from "../../config/features";

export interface DocItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  starred?: boolean;
  isFolder?: boolean;
  appProperties?: Record<string, string>;
  thumbnailLink?: string;
  webViewLink?: string;
  parents?: string[];
}

interface DocDetailPanelProps {
  item: DocItem | null;
  onClose: () => void;
  onToggleStar: (item: DocItem) => Promise<void>;
  onTrash: (item: DocItem) => Promise<void>;
  onUpdateTagsNotes?: (driveId: string, tags: string[], notes: string) => Promise<void>;
  onShowRestrictedToast?: (message: string) => void;
}

export const DocDetailPanel: React.FC<DocDetailPanelProps> = ({
  item,
  onClose,
  onToggleStar,
  onTrash,
  onShowRestrictedToast,
}) => {
  const { user } = useAuth();
  const canDelete = canUserDelete(user?.role);
  const [restrictedToast, setRestrictedToast] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isEncryptingOffline, setIsEncryptingOffline] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (item && !item.isFolder) {
      isFileOffline(item.id).then(setIsOffline);
      addRecentlyViewed({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size ? parseInt(item.size, 10) : undefined,
        modifiedTime: item.modifiedTime,
        thumbnailLink: item.thumbnailLink,
      });
    }
  }, [item]);

  if (!item) return null;

  const handleDownload = () => {
    window.open(`/api/drive/download?id=${item.id}`, "_blank");
  };

  const handleToggleOffline = async () => {
    if (isOffline) {
      await removeOfflineFile(item.id);
      setIsOffline(false);
    } else {
      setIsEncryptingOffline(true);
      try {
        const res = await fetch(`/api/drive/download?id=${item.id}`);
        if (!res.ok) throw new Error("Download failed");
        const arrayBuf = await res.arrayBuffer();
        await saveFileOffline(item.id, item.name, item.mimeType, arrayBuf);
        setIsOffline(true);
      } catch (err) {
        console.error("Failed to save offline:", err);
      } finally {
        setIsEncryptingOffline(false);
      }
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + `/docs?fileId=${item.id}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const uploadedBy =
    item.appProperties?.uploadedByName || item.appProperties?.uploadedBy || "Vault Admin";
  const tags = item.appProperties?.tags ? item.appProperties.tags.split(",") : [];
  const notes = item.appProperties?.notes || "";

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#090d16] border-l border-white/10 shadow-2xl flex flex-col justify-between overflow-y-auto animate-slideIn">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#090d16]/95 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleStar(item)}
            className={`p-2 rounded-xl border transition-colors ${
              item.starred
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"
            }`}
            title={item.starred ? "Starred" : "Star"}
          >
            <Star className={`w-4 h-4 ${item.starred ? "fill-amber-400" : ""}`} />
          </button>
          <span className="text-xs font-semibold text-white">Document Details</span>
        </div>
        <button
          data-testid="doc-detail-close"
          onClick={onClose}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content */}
      <div className="p-5 space-y-6 flex-1">
        {/* Preview / Monogram Box */}
        <div className="h-44 rounded-2xl bg-gradient-to-b from-white/5 to-white/[0.02] border border-white/10 flex flex-col items-center justify-center relative overflow-hidden group">
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

          {isOffline && (
            <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] text-emerald-300 font-medium flex items-center gap-1 backdrop-blur-md">
              <Shield className="w-3 h-3 text-emerald-400" />
              <span>AES-GCM Offline</span>
            </div>
          )}
        </div>

        {/* Name */}
        <div>
          <h2 className="text-base font-bold text-white break-words">{item.name}</h2>
          <p className="text-xs text-muted-foreground font-mono mt-1 break-all">
            ID: {item.id}
          </p>
        </div>

        {/* Metadata Grid */}
        <div className="space-y-3 bg-white/5 p-4 rounded-2xl border border-white/5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              Modified
            </span>
            <span className="font-medium text-white">{formatDate(item.modifiedTime)}</span>
          </div>

          {item.size && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Size</span>
              <span className="font-medium text-white">{formatBytes(parseInt(item.size, 10))}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              Uploaded By
            </span>
            <span className="font-medium text-white">{uploadedBy}</span>
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
              {tags.map((t, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-medium"
                >
                  #{t.trim()}
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

        {/* Offline Vault Action */}
        {!item.isFolder && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 to-indigo-500/10 border border-sky-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-semibold text-white">Local Offline Vault</span>
              </div>
              {isOffline && (
                <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Encrypted & Ready
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isOffline
                ? "This document is encrypted with Web Crypto AES-GCM and stored locally in this device's IndexedDB."
                : "Save an encrypted copy on this phone/laptop to read without internet access."}
            </p>
            <button
              onClick={handleToggleOffline}
              disabled={isEncryptingOffline}
              className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                isOffline
                  ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30"
                  : "bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30"
              }`}
            >
              {isEncryptingOffline ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Encrypting to Vault...</span>
                </>
              ) : isOffline ? (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Offline Copy</span>
                </>
              ) : (
                <>
                  <HardDriveDownload className="w-3.5 h-3.5" />
                  <span>Save Offline (AES-GCM)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Footer Action Buttons */}
      <div className="p-4 border-t border-white/10 bg-[#090d16] space-y-2">
        {restrictedToast && (
          <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2 animate-fadeIn">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{DELETE_RESTRICTED_MESSAGE}</span>
          </div>
        )}
        <div className="flex gap-2">
          {!item.isFolder && (
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-sky-500/25 transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Download File</span>
            </button>
          )}
          <button
            onClick={handleCopyLink}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white border border-white/10 transition-colors"
            title="Copy Document Link"
          >
            {copiedLink ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            data-testid="doc-detail-trash"
            onClick={(e) => {
              e.stopPropagation();
              if (!canDelete) {
                setRestrictedToast(true);
                setTimeout(() => setRestrictedToast(false), 3500);
                onShowRestrictedToast?.(DELETE_RESTRICTED_MESSAGE);
                return;
              }
              onTrash(item);
            }}
            aria-disabled={!canDelete}
            title={canDelete ? "Move to Bin" : DELETE_RESTRICTED_MESSAGE}
            className={`p-2.5 rounded-xl border transition-colors ${
              canDelete
                ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20 cursor-pointer active:scale-95"
                : "bg-white/5 text-muted-foreground/40 border-white/5 opacity-50 cursor-not-allowed hover:bg-white/5"
            }`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
