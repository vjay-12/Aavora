import React, { useState, useRef } from "react";
import { Upload, X, File, AlertCircle, Loader2 } from "lucide-react";
import { formatBytes } from "../../lib/utils";

interface UploadModalProps {
  isOpen: boolean;
  parentId?: string;
  onClose: () => void;
  onUploadSuccess: () => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  parentId,
  onClose,
  onUploadSuccess,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setErrorMsg(null);
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((tag) => tag !== t));
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setProgress(0);
    setErrorMsg(null);

    try {
      // 1. Request resumable upload session from server (owned by admin!)
      const sessionRes = await fetch("/api/upload/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedFile.name,
          mimeType: selectedFile.type || "application/octet-stream",
          size: selectedFile.size,
          parentId,
          tags,
          notes,
        }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.json();
        throw new Error(err.error || "Failed to create upload session");
      }

      const { uploadUrl } = await sessionRes.json();

      // 2. Direct browser upload to Google Drive resumable session URL (Bypasses Vercel 4.5MB limit!)
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", selectedFile.type || "application/octet-stream");

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setProgress(pct);
        }
      };

      const uploadPromise = new Promise<{ id: string; name: string }>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try {
              const resData = JSON.parse(xhr.responseText);
              resolve(resData);
            } catch {
              resolve({ id: "unknown", name: selectedFile.name });
            }
          } else {
            reject(new Error(`Direct upload failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during direct upload"));
      });

      xhr.send(selectedFile);
      const uploadedDriveItem = await uploadPromise;

      // 3. Notify server of completion to log in Neon activity table
      await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveId: uploadedDriveItem.id,
          name: selectedFile.name,
          path: parentId,
          size: selectedFile.size,
          mimeType: selectedFile.type,
          tags,
          notes,
        }),
      });

      onUploadSuccess();
      onClose();
    } catch (err: any) {
      console.error("Upload error:", err);
      setErrorMsg(err.message || "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-[#0d1322] border border-white/10 rounded-2xl p-6 shadow-2xl text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Direct Resumable Upload</h2>
              <p className="text-xs text-muted-foreground">
                High-speed upload straight to Google Drive (no size limit)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drop / Select zone */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading}
        />

        {!selectedFile ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/15 hover:border-sky-500/50 rounded-2xl p-8 text-center cursor-pointer bg-white/[0.02] hover:bg-white/5 transition-all group"
          >
            <Upload className="w-8 h-8 text-muted-foreground group-hover:text-sky-400 mx-auto mb-3 transition-colors" />
            <p className="text-sm font-semibold text-white">Click or drop file here</p>
            <p className="text-xs text-muted-foreground mt-1">
              PDF, Images, Documents, Videos — all sizes supported
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-9 h-9 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center flex-shrink-0">
                <File className="w-5 h-5" />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-white truncate">{selectedFile.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatBytes(selectedFile.size)}
                </p>
              </div>
            </div>
            {!isUploading && (
              <button
                onClick={() => setSelectedFile(null)}
                className="text-xs text-rose-400 hover:text-rose-300 ml-2"
              >
                Change
              </button>
            )}
          </div>
        )}

        {/* Tags input */}
        <div className="mt-4 space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Tags (Optional)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
              placeholder="e.g. Tax, Medical, Identity"
              disabled={isUploading}
              className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={handleAddTag}
              disabled={isUploading || !tagInput.trim()}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs flex items-center gap-1.5"
                >
                  #{t}
                  <button
                    onClick={() => handleRemoveTag(t)}
                    className="hover:text-rose-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Notes input */}
        <div className="mt-4 space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">
            Notes / Reference (Optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add relevant context or description..."
            rows={2}
            disabled={isUploading}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Upload Progress Bar */}
        {isUploading && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-sky-400 font-medium">Uploading directly to Google Drive...</span>
              <span className="font-mono text-white">{progress}%</span>
            </div>
            <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-sky-400 to-indigo-500 h-full rounded-full transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error alert */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 justify-end mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2 text-xs rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading ({progress}%)</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                <span>Start Direct Upload</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
