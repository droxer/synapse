import {
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  FileJson,
  FileArchive,
  FileAudio,
  FileVideo,
  FileTerminal,
  File,
} from "lucide-react";

export function formatFileSize(
  bytes: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (bytes === 0) return t("artifacts.size.zero");
  const units = [
    "artifacts.size.b",
    "artifacts.size.kb",
    "artifacts.size.mb",
    "artifacts.size.gb",
  ];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return t(units[i], { size: i === 0 ? size.toFixed(0) : size.toFixed(1) });
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function fileIcon(contentType: string, name?: string) {
  if (name) {
    const ext = fileExtension(name);
    switch (ext) {
      case "json":
        return FileJson;
      case "zip":
      case "tar":
      case "gz":
      case "rar":
      case "7z":
        return FileArchive;
      case "mp3":
      case "wav":
      case "ogg":
      case "flac":
        return FileAudio;
      case "mp4":
      case "mkv":
      case "avi":
      case "mov":
        return FileVideo;
      case "sh":
      case "bash":
      case "zsh":
      case "bat":
      case "cmd":
        return FileTerminal;
      case "csv":
      case "xlsx":
      case "xls":
      case "ods":
        return FileSpreadsheet;
      case "js":
      case "jsx":
      case "ts":
      case "tsx":
      case "py":
      case "go":
      case "rs":
      case "java":
      case "c":
      case "cpp":
      case "h":
      case "html":
      case "css":
      case "sql":
      case "php":
      case "rb":
      case "swift":
        return FileCode;
      case "txt":
      case "md":
      case "log":
      case "pdf":
      case "doc":
      case "docx":
      case "rtf":
        return FileText;
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
      case "svg":
      case "webp":
      case "ico":
        return FileImage;
    }
  }

  if (contentType.startsWith("image/")) return FileImage;
  if (contentType === "application/pdf") return FileText;
  if (contentType.includes("wordprocessingml")) return FileText;
  if (contentType.includes("presentationml")) return FileText;
  if (
    contentType.startsWith("text/x-") ||
    contentType === "text/javascript" ||
    contentType === "application/json"
  )
    return FileCode;
  if (contentType === "text/csv" || contentType.includes("spreadsheet"))
    return FileSpreadsheet;
  if (contentType.startsWith("text/")) return FileText;
  return File;
}

import type { TFn } from "@/shared/types/i18n";

export function fileCategory(contentType: string, t: TFn): string {
  if (contentType.startsWith("image/")) return t("artifacts.categoryImage");
  if (contentType === "application/pdf") return t("artifacts.categoryPdf");
  if (contentType.includes("wordprocessingml")) return t("artifacts.categoryDocument");
  if (contentType.includes("spreadsheet")) return t("artifacts.categorySpreadsheet");
  if (contentType.includes("presentationml")) return t("artifacts.categoryPresentation");
  if (contentType.startsWith("text/x-") || contentType === "text/javascript" || contentType === "application/json")
    return t("artifacts.categoryCode");
  if (contentType === "text/csv") return t("artifacts.categoryData");
  if (contentType === "text/html") return t("artifacts.categoryHtml");
  if (contentType.startsWith("text/")) return t("artifacts.categoryText");
  return t("artifacts.categoryFile");
}

interface FileCategoryColor {
  readonly icon: string;
  readonly bg: string;
}

export function fileCategoryColor(contentType: string, name?: string): FileCategoryColor {
  if (name) {
    const ext = fileExtension(name);
    switch (ext) {
      case "json":
      case "js":
      case "jsx":
      case "ts":
      case "tsx":
      case "py":
      case "go":
      case "rs":
      case "java":
      case "c":
      case "cpp":
      case "h":
      case "html":
      case "css":
      case "sql":
      case "php":
      case "rb":
      case "swift":
        return { icon: "text-accent-emerald", bg: "bg-accent-emerald/10" };
      case "csv":
      case "xlsx":
      case "xls":
      case "ods":
        return { icon: "text-accent-amber", bg: "bg-accent-amber/10" };
      case "pdf":
      case "zip":
      case "tar":
      case "gz":
      case "rar":
      case "7z":
        return { icon: "text-accent-rose", bg: "bg-accent-rose/10" };
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
      case "svg":
      case "webp":
      case "ico":
      case "mp3":
      case "wav":
      case "mp4":
      case "mkv":
        return { icon: "text-accent-purple", bg: "bg-accent-purple/10" };
    }
  }

  if (contentType.startsWith("image/"))
    return { icon: "text-accent-purple", bg: "bg-accent-purple/10" };
  if (contentType === "application/pdf")
    return { icon: "text-accent-rose", bg: "bg-accent-rose/10" };
  if (
    contentType.startsWith("text/x-") ||
    contentType === "text/javascript" ||
    contentType === "application/json"
  )
    return { icon: "text-accent-emerald", bg: "bg-accent-emerald/10" };
  if (contentType === "text/html")
    return { icon: "text-accent-amber", bg: "bg-accent-amber/10" };
  if (contentType === "text/csv" || contentType.includes("spreadsheet"))
    return { icon: "text-accent-amber", bg: "bg-accent-amber/10" };
  if (
    contentType.startsWith("text/") ||
    contentType.includes("wordprocessingml") ||
    contentType.includes("presentationml")
  )
    return { icon: "text-user-accent", bg: "bg-user-accent/10" };
  return { icon: "text-muted-foreground", bg: "bg-muted" };
}

/** Border color CSS variable string for artifact file category accent. */
const BORDER_COLOR_MAP: Record<string, string> = {
  "text-accent-purple": "var(--color-accent-purple)",
  "text-accent-rose": "var(--color-accent-rose)",
  "text-accent-emerald": "var(--color-accent-emerald)",
  "text-accent-amber": "var(--color-accent-amber)",
  "text-user-accent": "var(--color-user-accent)",
  "text-muted-foreground": "var(--color-muted-foreground)",
};

export function fileCategoryBorderColor(contentType: string, name?: string): string {
  const { icon } = fileCategoryColor(contentType, name);
  return BORDER_COLOR_MAP[icon] ?? "var(--color-border)";
}

export function isPreviewable(contentType: string): boolean {
  return (
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType.includes("wordprocessingml") ||
    contentType.includes("spreadsheetml") ||
    contentType.includes("presentationml") ||
    contentType === "application/msword" ||
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/vnd.ms-powerpoint"
  );
}
