import {
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  File,
} from "lucide-react";

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fileIcon(contentType: string) {
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

type TFn = (key: string) => string;

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

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toUpperCase();
}

interface FileCategoryColor {
  readonly icon: string;
  readonly bg: string;
}

export function fileCategoryColor(contentType: string): FileCategoryColor {
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

export function isPreviewable(contentType: string): boolean {
  return (
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    contentType.startsWith("text/") ||
    contentType === "application/json"
  );
}
