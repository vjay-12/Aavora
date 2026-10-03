import React, { useState, useRef } from "react";
import { Upload, X, File, AlertCircle, Loader2, Folder, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatBytes } from "../../lib/utils";

interface UploadModalProps {
  isOpen: boolean;
  parentId?: string;
  onClose: () => void;
  onUploadSuccess: (fileName?: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  parentId,
  onClose,
  onUploadSuccess,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [destinationFolderId, setDestinationFolderId] = useState<string>(parentId || "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: driveData } = useQuery({
    queryKey: ["drive-folders-select"],
    queryFn: async () => {
      const res = await fetch("/api/drive/list");
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: isOpen,
  });

  const availableFolders = (driveData?.items || []).filter(
    (item: any) => item.isFolder || item.mimeType === "application/vnd.google-apps.folder"
  );

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
    setIsComplete(false);
    setProgress(0);
    setErrorMsg(null);

    const targetParent = destinationFolderId || parentId;

    try {
      // 1. Request upload session from server
      const sessionRes = await fetch("/api/upload/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedFile.name,
          mimeType: selectedFile.type || "application/octet-stream",
          size: selectedFile.size,
          parentId: targetParent,
          tags,
          notes,
        }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start upload");
      }

      const { uploadUrl, fileName } = await sessionRes.json();

      // 2. Direct browser upload to session URL
      let driveId: string | undefined = undefined;
      let directUploadError: any = null;

      try {
        const uploaded = await new Promise<{ id?: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl, true);
          xhr.setRequestHeader("Content-Type", selectedFile.type || "application/octet-stream");

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100);
              setProgress(pct);
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
              try {
                const resData = JSON.parse(xhr.responseText);
                resolve(resData);
              } catch {
                resolve({});
              }
            } else {
              reject(new Error(`Direct upload returned status ${xhr.status}`));
            }
          };

          xhr.onerror = () => {
            reject(new Error("Network error during direct upload"));
          };

          xhr.send(selectedFile);
        });

        driveId = uploaded?.id;
      } catch (uploadErr: any) {
        directUploadError = uploadErr;
        console.warn("[Upload] PUT notice, verifying with server:", uploadErr);
      }

      // If direct PUT failed or was blocked by CORS, try querying session status from client
      if (!driveId) {
        try {
          const statusRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Range": `bytes */${selectedFile.size}`,
            },
          });
          if (statusRes.status === 200 || statusRes.status === 201) {
            const data = await statusRes.json().catch(() => null);
            if (data?.id) {
              driveId = data.id;
            }
          }
        } catch {
          // Ignore client query error
        }
      }

      // 3. Notify server of completion
      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveId,
          uploadUrl,
          name: fileName || selectedFile.name,
          parentId: targetParent,
          path: targetParent,
          size: selectedFile.size,
          mimeType: selectedFile.type || "application/octet-stream",
          tags,
          notes,
        }),
      });

      const completeData = await completeRes.json().catch(() => ({}));
      if (!completeRes.ok || !completeData.success) {
        throw new Error(
          completeData.error ||
          directUploadError?.message ||
          "Upload verification failed"
        );
      }

      setProgress(100);
      setIsComplete(true);
      setTimeout(() => {
        onUploadSuccess(fileName || selectedFile.name);
        onClose();
      }, 700);
    } catch (err: any) {
      console.error("[Upload Error Details]:", err);
      setErrorMsg("Upload didn't finish. Please check your internet and try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg bg-[#0d1322] border border-white/10 rounded-3xl p-6 shadow-2xl text-foreground animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Upload file</h2>
              <p className="text-xs text-muted-foreground">
                Save a document directly to your family vault
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            aria-label="Close"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center transition"
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
          disabled={isUploading || isComplete}
        />

        {!selectedFile ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/15 hover:border-sky-500/50 rounded-2xl p-8 text-center cursor-pointer bg-white/[0.02] hover:bg-white/5 transition-all group"
          >
            <Upload className="w-8 h-8 text-muted-foreground group-hover:text-sky-400 mx-auto mb-3 transition-colors" />
            <p className="text-sm font-semibold text-white">Click or drop a file here</p>
            <p className="text-xs text-muted-foreground mt-1">
              Photos, PDFs, and documents
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

        {/* Choose Destination Folder */}
        <div className="mt-4 space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">
            Folder
          </label>
          <div className="relative">
            <select
              value={destinationFolderId}
              onChange={(e) => setDestinationFolderId(e.target.value)}
              disabled={isUploading || isComplete}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 appearance-none min-h-[44px]"
            >
              <option value={parentId || ""}>Current Folder</option>
              {availableFolders.map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Folder className="w-4 h-4 text-sky-400 absolute right-3 top-3.5 pointer-events-none" />
          </div>
        </div>

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
              disabled={isUploading || isComplete}
              className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
            />
            <button
              type="button"
              onClick={handleAddTag}
              disabled={isUploading || isComplete || !tagInput.trim()}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white disabled:opacity-50 min-h-[44px]"
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
            Notes (Optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a short note or description..."
            rows={2}
            disabled={isUploading || isComplete}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Upload Progress Bar / Done Message */}
        {isUploading && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-sky-400 font-medium">Uploading file...</span>
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

        {isComplete && (
          <div className="mt-4 p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="font-semibold">Done! File uploaded successfully.</span>
          </div>
        )}

        {/* Error alert */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
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
            className="px-4 py-2.5 text-xs rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white min-h-[44px] transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || isComplete}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 min-h-[44px]"
          >
            {isComplete ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Uploaded</span>
              </>
            ) : isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading ({progress}%)</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
