import type { BrandIconData, BrandMimeRule } from "./types";

const OFFICE_ICONS = {
  ilovePdf: {
    title: "iLovePDF",
    hex: "#FF9F11",
    path: "M15.374 2.094c-1.347.65-2.356 1.744-3.094 2.985C11.095 3.087 9.21 1.47 6.356 1.47 3.501 1.47 0 3.894 0 7.987c0 4.145 3.458 6.109 5.171 7.218 1.831 1.185 4.955 3.339 7.11 7.325 2.154-3.986 5.278-6.14 7.109-7.325 1.287-.834 3.56-2.151 4.61-4.514Zm-.104 8.832V3.138l7.788 7.788H15.27z",
  },
  googleDocs: {
    title: "Google Docs",
    hex: "#4285F4",
    path: "M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zm-.545 10.455H7.09v-1.364h7.09v1.364zm2.727-3.273H7.091v-1.364h9.818v1.364zm0-3.273H7.091V9.273h9.818v1.363zM14.727 6h6l-6-6v6z",
  },
  googleSheets: {
    title: "Google Sheets",
    hex: "#34A853",
    path: "M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z",
  },
  googleSlides: {
    title: "Google Slides",
    hex: "#FBBC05",
    path: "M16.09 15.273H7.91v-4.637h8.18v4.637zm1.728-8.523h2.91v15.614c0 .904-.733 1.636-1.637 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.068v6.75h3.841zm-.363 2.523H6.545v7.363h10.91V9.273zm-2.728-5.979V6h6.001l-6-6v3.294z",
  },
} as const;

export const officeExtensionIconMap: Record<string, BrandIconData> = {
  pdf: OFFICE_ICONS.ilovePdf,
  doc: OFFICE_ICONS.googleDocs,
  docx: OFFICE_ICONS.googleDocs,
  xls: OFFICE_ICONS.googleSheets,
  xlsx: OFFICE_ICONS.googleSheets,
  ppt: OFFICE_ICONS.googleSlides,
  pptx: OFFICE_ICONS.googleSlides,
};

export const officeMimeRules: readonly BrandMimeRule[] = [
  { test: (ct) => ct === "application/pdf", icon: OFFICE_ICONS.ilovePdf },
  {
    test: (ct) => ct.includes("wordprocessingml") || ct === "application/msword",
    icon: OFFICE_ICONS.googleDocs,
  },
  {
    test: (ct) =>
      ct.includes("spreadsheetml") ||
      ct === "application/vnd.ms-excel" ||
      ct === "text/csv",
    icon: OFFICE_ICONS.googleSheets,
  },
  {
    test: (ct) =>
      ct.includes("presentationml") || ct === "application/vnd.ms-powerpoint",
    icon: OFFICE_ICONS.googleSlides,
  },
];
