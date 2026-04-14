import type { BrandIconData, BrandMimeRule } from "./types";

const WEB_ICONS = {
  html5: {
    title: "HTML5",
    hex: "#E34F26",
    path: "M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.23-2.622L5.412 4.41l.698 8.01h9.126l-.326 3.426-2.91.804-2.955-.81-.188-2.11H6.248l.33 4.171L12 19.351l5.379-1.443.744-8.157H8.531z",
  },
  css3: {
    title: "CSS3",
    hex: "#1572B6",
    path: "M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm17.09 4.413L5.41 4.41l.213 2.622 10.125.002-.255 2.716h-6.64l.24 2.573h6.182l-.366 3.523-2.91.804-2.956-.81-.188-2.11h-2.61l.29 3.855L12 19.288l5.373-1.53L18.59 4.414z",
  },
  markdown: {
    title: "Markdown",
    hex: "#000000",
    path: "M22.27 19.385H1.73A1.73 1.73 0 010 17.655V6.345a1.73 1.73 0 011.73-1.73h20.54A1.73 1.73 0 0124 6.345v11.308a1.73 1.73 0 01-1.73 1.731zM5.769 15.923v-4.5l2.308 2.885 2.307-2.885v4.5h2.308V8.078h-2.308l-2.307 2.885-2.308-2.885H3.46v7.847zM21.232 12h-2.309V8.077h-2.307V12h-2.308l3.461 4.039z",
  },
} as const;

export const webExtensionIconMap: Record<string, BrandIconData> = {
  html: WEB_ICONS.html5,
  css: WEB_ICONS.css3,
  md: WEB_ICONS.markdown,
  markdown: WEB_ICONS.markdown,
};

export const webMimeRules: readonly BrandMimeRule[] = [
  { test: (ct) => ct === "text/html", icon: WEB_ICONS.html5 },
  { test: (ct) => ct === "text/css", icon: WEB_ICONS.css3 },
  { test: (ct) => ct === "text/markdown", icon: WEB_ICONS.markdown },
];
