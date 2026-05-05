#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");

function extractBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`).exec(css);
  if (!match || match.index == null) throw new Error(`Missing ${selector} block`);
  const open = css.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed ${selector} block`);
}

function parseVars(block) {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

function hexToRgb(value) {
  const hex = value.trim();
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected 6-digit hex color, got ${value}`);
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function luminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const themes = {
  light: parseVars(extractBlock(":root")),
  dark: parseVars(extractBlock(".dark")),
};

const checks = [
  ["foreground on background", "--color-foreground", "--color-background", 4.5],
  ["muted text on background", "--color-muted-foreground", "--color-background", 4.5],
  ["dim text on background", "--color-muted-foreground-dim", "--color-background", 4.5],
  ["primary button text", "--color-primary-foreground", "--color-primary", 4.5],
  ["destructive text on background", "--color-destructive", "--color-background", 4.5],
  ["success status text on background", "--color-accent-emerald", "--color-background", 4.5],
  ["warning status text on background", "--color-accent-amber", "--color-background", 4.5],
];

let failed = false;
console.log("Running WCAG contrast checks...");
console.log();

for (const [themeName, tokens] of Object.entries(themes)) {
  for (const [label, fgToken, bgToken, minimum] of checks) {
    const fg = tokens[fgToken];
    const bg = tokens[bgToken];
    if (!fg || !bg) {
      console.error(`Missing token for ${themeName} ${label}: ${fgToken} / ${bgToken}`);
      failed = true;
      continue;
    }
    const ratio = contrast(fg, bg);
    const formatted = ratio.toFixed(2);
    if (ratio < minimum) {
      console.error(`✗ ${themeName}: ${label} is ${formatted}:1, expected ${minimum}:1`);
      failed = true;
    } else {
      console.log(`✓ ${themeName}: ${label} is ${formatted}:1`);
    }
  }
}

if (failed) {
  console.error();
  console.error("WCAG contrast check failed.");
  process.exit(1);
}

console.log();
console.log("✓ WCAG contrast checks passed.");
