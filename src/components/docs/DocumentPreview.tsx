import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { formatBytes, formatDate } from "../../lib/utils";
import { addRecentlyViewed } from "../../lib/recently-viewed";
import {
  X,
  ArrowLeft,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileArchive,
  FileSpreadsheet,
  File,
  AlertCircle,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type { DocItem } from "./DocDetailPanel";

// Set bundled worker file (no external CDN)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;


export interface DocumentPreviewProps {
  item: DocItem | null;
  onClose: () => void;
  onDownloadOriginal?: (item: DocItem) => void;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  item,
  onClose,
  onDownloadOriginal,
}) => {
  // Common states
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // Image states
  const [imgScale, setImgScale] = useState<number>(1);
  const [imgRotation, setImgRotation] = useState<number>(0);
  const [imgOffset, setImgOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartDistRef = useRef<number | null>(null);

  // PDF states
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [pdfScale, setPdfScale] = useState<number>(1.2);
  const [isPdfRendering, setIsPdfRendering] = useState<boolean>(false);
  const renderTaskRef = useRef<any>(null);

  // Type classification
  const fileName = (item?.name || "").toLowerCase();
  const mimeType = (item?.mimeType || "").toLowerCase();

  const isImage =
    mimeType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName);

  const isPdf =
    mimeType === "application/pdf" ||
    fileName.endsWith(".pdf");

  const isGoogleDoc = mimeType === "application/vnd.google-apps.document";
  const isWord =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    /\.(docx|doc)$/i.test(fileName) ||
    isGoogleDoc;

  // Add to Recently Viewed on open
  useEffect(() => {
    if (item && !item.isFolder) {
      addRecentlyViewed({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size ? parseInt(item.size, 10) : undefined,
        modifiedTime: item.modifiedTime,
        thumbnailLink: item.thumbnailLink,
      }).catch(() => {});
    }
  }, [item]);

  // Keyboard Escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Reset viewer parameters when active item changes
  const resetViewerState = useCallback(() => {
    setErrorStatus(null);
    setErrorMessage(null);
    setIsLoading(true);
    setImgScale(1);
    setImgRotation(0);
    setImgOffset({ x: 0, y: 0 });
    setCurrentPage(1);
    setTotalPages(0);
    setPdfDoc(null);
    setPdfScale(1.2);
  }, []);

  useEffect(() => {
    resetViewerState();
  }, [item?.id, resetViewerState]);

  // Load PDF or Word-converted PDF
  useEffect(() => {
    if (!item || (!isPdf && !isWord)) return;

    let isMounted = true;
    const loadPdfDocument = async () => {
      setIsLoading(true);
      setErrorStatus(null);
      setErrorMessage(null);

      const url = `/api/drive/file?id=${encodeURIComponent(item.id)}&mode=view`;

      try {
        const loadingTask = pdfjsLib.getDocument({
          url,
          withCredentials: true,
        });

        const doc = await loadingTask.promise;
        if (!isMounted) return;

        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        setIsLoading(false);
      } catch (err: any) {
        if (!isMounted) return;
        console.error("[PDF Preview Error]:", err);

        // Check if server returned 415 or other HTTP status
        if (err.status) {
          setErrorStatus(err.status);
          if (err.status === 415) {
            setErrorMessage("Word preview conversion unavailable. Please download the original file to view.");
          } else if (err.status === 403) {
            setErrorMessage("Access denied: You do not have permission to view this file.");
          } else if (err.status === 404) {
            setErrorMessage("Document not found in Google Drive.");
          } else {
            setErrorMessage(err.message || "Failed to load document preview.");
          }
        } else if (err.name === "PasswordException") {
          setErrorStatus(422);
          setErrorMessage("This PDF is password-protected. Please download the original file to view.");
        } else if (err.name === "InvalidPDFException") {
          setErrorStatus(422);
          setErrorMessage("This document is corrupted or invalid. Please download the original file.");
        } else {
          setErrorStatus(500);
          setErrorMessage(
            isWord
              ? "Word preview conversion unavailable. Please download the original file to view."
              : "Failed to load document preview."
          );
        }
        setIsLoading(false);
      }
    };

    loadPdfDocument();

    return () => {
      isMounted = false;
    };
  }, [item, isPdf, isWord]);

  // Render active PDF page to canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isCancelled = false;
    const renderPage = async () => {
      try {
        setIsPdfRendering(true);
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const viewport = page.getViewport({ scale: pdfScale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderContext = {
          canvasContext: ctx,
          viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;
      } catch (renderErr: any) {
        if (renderErr?.name !== "RenderingCancelledException") {
          console.error("[PDF Canvas Render Error]:", renderErr);
        }
      } finally {
        if (!isCancelled) {
          setIsPdfRendering(false);
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, currentPage, pdfScale]);

  if (!item) return null;

  const fileUrl = `/api/drive/file?id=${encodeURIComponent(item.id)}&mode=view`;
  const downloadUrl = `/api/drive/file?id=${encodeURIComponent(item.id)}&mode=download`;

  const handleDownloadClick = () => {
    if (onDownloadOriginal) {
      onDownloadOriginal(item);
    } else {
      window.open(downloadUrl, "_blank");
    }
  };

  // Image zoom click toggle (Desktop)
  const handleImageClick = () => {
    setImgScale((prev) => {
      if (prev === 1) return 2;
      if (prev === 2) return 3;
      return 1;
    });
    if (imgScale >= 2) {
      setImgOffset({ x: 0, y: 0 });
    }
  };

  // Mouse pan handlers for zoomed image
  const handleMouseDown = (e: React.MouseEvent) => {
    if (imgScale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - imgOffset.x, y: e.clientY - imgOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && imgScale > 1) {
      setImgOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Mobile pinch-zoom handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = currentDist / touchStartDistRef.current;
      setImgScale((prev) => Math.min(Math.max(prev * ratio, 1), 5));
      touchStartDistRef.current = currentDist;
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
  };

  return (
    <>
      {/* Backdrop for Desktop */}
      <div
        className="hidden md:block fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Main Container: Full screen on mobile, right-side panel on desktop */}
      <div
        data-testid="document-preview-container"
        className={`fixed inset-0 md:inset-y-0 md:right-0 md:left-auto z-50 bg-[#070b12] md:bg-[#090d16] border-l border-white/10 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 animate-slideIn ${
          isFullScreen
            ? "md:w-screen md:max-w-none md:left-0"
            : "md:w-[60vw] lg:w-[50vw] xl:w-[45vw] md:min-w-[420px] md:max-w-4xl"
        }`}
      >
        {/* Header Bar */}
        <div className="px-4 py-3 border-b border-white/10 bg-[#090d16]/95 backdrop-blur-md flex items-center justify-between gap-3 flex-shrink-0 z-20">
          <div className="flex items-center gap-2.5 overflow-hidden">
            {/* Mobile Back Button */}
            <button
              data-testid="doc-preview-back"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white md:hidden"
              title="Back to vault"
              aria-label="Back to vault"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="overflow-hidden text-left">
              <div className="flex items-center gap-2">
                <h3 className="text-xs md:text-sm font-bold text-white truncate max-w-[220px] sm:max-w-[320px]">
                  {item.name}
                </h3>
                {isWord && !errorStatus && (
                  <span
                    data-testid="converted-preview-badge"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-medium"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>Converted preview</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                {item.size ? formatBytes(parseInt(item.size, 10)) : "Document"}{" "}
                {item.modifiedTime ? `• ${formatDate(item.modifiedTime)}` : ""}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isWord && (
              <button
                data-testid="download-original-btn"
                onClick={handleDownloadClick}
                className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium border border-white/10 flex items-center gap-1.5 transition-colors"
                title="Download original document"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">Download Original</span>
              </button>
            )}

            {!isWord && (
              <button
                data-testid="preview-download-btn"
                onClick={handleDownloadClick}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                title="Download file"
                aria-label="Download file"
              >
                <Download className="w-4 h-4" />
              </button>
            )}

            {/* Desktop Fullscreen Toggle */}
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="hidden md:inline-flex p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
              aria-label="Toggle Fullscreen"
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Desktop Close Button */}
            <button
              data-testid="doc-preview-close"
              onClick={onClose}
              className="hidden md:inline-flex p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              title="Close (Esc)"
              aria-label="Close document preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Floating Controls Bar for PDF and Images */}
        {(isImage || ((isPdf || isWord) && !errorStatus && totalPages > 0)) && (
          <div className="px-4 py-2 bg-[#0d131f]/90 border-b border-white/5 backdrop-blur-md flex items-center justify-between text-xs flex-shrink-0">
            {/* PDF Page Navigation */}
            {(isPdf || isWord) && totalPages > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  data-testid="pdf-prev-page"
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage <= 1}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white transition-colors"
                  aria-label="Previous Page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span data-testid="pdf-page-counter" className="text-xs text-muted-foreground font-mono">
                  Page <strong className="text-white">{currentPage}</strong> of {totalPages}
                </span>
                <button
                  data-testid="pdf-next-page"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white transition-colors"
                  aria-label="Next Page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {imgScale > 1 ? `${Math.round(imgScale * 100)}% (Drag to pan)` : "Tap / Click to zoom"}
                </span>
              </div>
            )}

            {/* Zoom & Rotation Controls */}
            <div className="flex items-center gap-1.5">
              {isImage && (
                <button
                  onClick={() => setImgRotation((r) => (r + 90) % 360)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
                  title="Rotate 90°"
                  aria-label="Rotate image"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                data-testid="zoom-out-btn"
                onClick={() => {
                  if (isImage) {
                    setImgScale((s) => Math.max(s - 0.5, 1));
                  } else {
                    setPdfScale((s) => Math.max(s - 0.25, 0.5));
                  }
                }}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
                title="Zoom Out"
                aria-label="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <button
                data-testid="zoom-reset-btn"
                onClick={() => {
                  if (isImage) {
                    setImgScale(1);
                    setImgOffset({ x: 0, y: 0 });
                    setImgRotation(0);
                  } else {
                    setPdfScale(1.2);
                  }
                }}
                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-muted-foreground hover:text-white"
                title="Reset Zoom"
              >
                {Math.round((isImage ? imgScale : pdfScale) * 100)}%
              </button>

              <button
                data-testid="zoom-in-btn"
                onClick={() => {
                  if (isImage) {
                    setImgScale((s) => Math.min(s + 0.5, 4));
                  } else {
                    setPdfScale((s) => Math.min(s + 0.25, 3));
                  }
                }}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
                title="Zoom In"
                aria-label="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Viewer Viewport Content */}
        <div className="flex-1 relative overflow-auto flex items-center justify-center p-4 bg-[#05080e] select-none">
          {/* 1. ERROR STATE */}
          {errorStatus && (
            <div data-testid="doc-preview-error" className="max-w-md p-6 text-center space-y-4 animate-scaleUp">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/15 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/25">
                {errorStatus === 403 ? (
                  <ShieldAlert className="w-7 h-7" />
                ) : (
                  <AlertCircle className="w-7 h-7" />
                )}
              </div>

              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white">Preview Unavailable</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {errorMessage || "Unable to display document preview."}
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  data-testid="error-retry-btn"
                  onClick={resetViewerState}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium border border-white/10 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>

                <button
                  data-testid="error-download-btn"
                  onClick={handleDownloadClick}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Original</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. LOADING SKELETON */}
          {!errorStatus && isLoading && (
            <div
              data-testid="doc-preview-loading"
              className="flex flex-col items-center justify-center gap-3 text-muted-foreground animate-fadeIn"
            >
              <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
              <p className="text-xs font-medium">Loading document preview...</p>
            </div>
          )}

          {/* 3. IMAGE VIEWER */}
          {!errorStatus && isImage && (
            <div
              className="w-full h-full flex items-center justify-center overflow-hidden touch-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <img
                data-testid="preview-image-img"
                src={fileUrl}
                alt={item.name}
                onLoad={() => setIsLoading(false)}
                onError={() => {
                  setIsLoading(false);
                  setErrorStatus(500);
                  setErrorMessage("Failed to load image preview.");
                }}
                onClick={handleImageClick}
                style={{
                  transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${imgScale}) rotate(${imgRotation}deg)`,
                  cursor: imgScale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in",
                  imageOrientation: "from-image",
                }}
                className={`max-w-full max-h-full object-contain rounded-lg transition-transform duration-75 select-none shadow-2xl ${
                  isLoading ? "opacity-0" : "opacity-100"
                }`}
              />
            </div>
          )}

          {/* 4. PDF & WORD CONVERTED VIEWER (CANVAS) */}
          {!errorStatus && (isPdf || isWord) && (
            <div
              data-testid="preview-pdf-wrapper"
              className={`w-full h-full flex flex-col items-center justify-start overflow-auto p-2 ${
                isLoading ? "hidden" : "flex"
              }`}
            >
              {isPdfRendering && (
                <div className="absolute top-16 right-6 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md text-[11px] text-sky-300 font-medium flex items-center gap-1.5 z-10">
                  <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                  <span>Rendering page...</span>
                </div>
              )}
              <canvas
                ref={canvasRef}
                data-testid="preview-pdf-canvas"
                className="rounded-lg shadow-2xl bg-white max-w-full my-auto transition-transform"
              />
            </div>
          )}

          {/* 5. GENERIC FILE INFO CARD (ZIP, XLSX, BINARY) */}
          {!errorStatus && !isImage && !isPdf && !isWord && (
            <div data-testid="doc-preview-generic" className="max-w-sm w-full p-6 glass-card rounded-2xl text-center space-y-4 animate-scaleUp">
              <div className="w-16 h-16 rounded-2xl bg-sky-500/10 text-sky-400 flex items-center justify-center mx-auto border border-sky-500/20">
                {/\.(zip|tar|gz|rar|7z)$/i.test(fileName) ? (
                  <FileArchive className="w-8 h-8" />
                ) : /\.(xlsx?|csv|numbers)$/i.test(fileName) ? (
                  <FileSpreadsheet className="w-8 h-8" />
                ) : (
                  <File className="w-8 h-8" />
                )}
              </div>

              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white break-words">{item.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {item.size ? formatBytes(parseInt(item.size, 10)) : "Binary File"} •{" "}
                  {item.mimeType.split("/")[1]?.toUpperCase() || "FILE"}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-[11px] text-muted-foreground">
                In-app preview is not available for this file type. Download the file to open it in your system application.
              </div>

              <button
                data-testid="generic-download-btn"
                onClick={handleDownloadClick}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Download File</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
