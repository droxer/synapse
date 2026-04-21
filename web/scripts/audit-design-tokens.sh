#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/src"

has_errors=0

check() {
  local description="$1"
  local pattern="$2"
  shift 2
  local extra_args=("$@")

  local result
  if result="$(rg -n "$pattern" "$TARGET_DIR" "${extra_args[@]}" || true)"; then
    if [[ -n "$result" ]]; then
      echo "✗ $description"
      echo "$result"
      echo
      has_errors=1
    fi
  fi
}

echo "Running design-token guardrail checks..."
echo

# 1) Banned opacity modifiers on core semantic border token.
check \
  "No opacity-modified border token classes (border-border/*)." \
  "border-border/(40|50|60|70|80|90)"

# 2) Banned opacity modifiers on muted foreground text.
check \
  "No opacity-modified muted text token classes (text-muted-foreground/*)." \
  "text-muted-foreground/(40|50|60|70|80|90)"

# 3) Banned translucent nav shell surfaces.
check \
  "No translucent background shell classes (bg-background/*)." \
  "bg-background/(80|90|95)"

# 4) Raw Tailwind palette classes should not be used in product UI.
check \
  "No raw Tailwind palette classes for text/bg/border/ring." \
  "(text|bg|border|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}"

# 5) Hardcoded hex literals are disallowed outside approved exception files.
check \
  "No hardcoded hex literals outside approved exceptions." \
  "#[0-9A-Fa-f]{3,8}" \
  --glob "!**/app/globals.css" \
  --glob "!**/features/channels/components/ChannelProviderIcon.tsx" \
  --glob "!**/shared/components/FilePreview.tsx" \
  --glob "!**/shared/components/Logo.tsx" \
  --glob "!**/shared/components/file-type-icons/**" \
  --glob "!**/app/login/page.tsx"

# 6) Flat-system guardrails: no blur/glass/atmosphere utilities in product UI.
check \
  "No blur utilities in product UI." \
  "backdrop-blur(-[a-z0-9]+)?"

check \
  "No deprecated glass utility usage." \
  "glass-surface"

check \
  "No atmospheric workspace utility usage." \
  "workspace-atmosphere"

check \
  "No gradient heading utility usage." \
  "gradient-heading"

# 7) No diffuse non-overlay shadows in product UI.
check \
  "No custom card-lift shadow token usage in product UI." \
  "shadow-\\[var\\(--shadow-(card|card-hover|primary-glow)"

check \
  "No raw elevated shadow utility usage in product UI." \
  "\\bshadow-elevated\\b" \
  --glob "!**/app/globals.css"

check \
  "No diffuse Tailwind shadow utilities in product UI." \
  "\\bshadow-(sm|md|lg|xl|2xl)\\b"

if [[ "$has_errors" -eq 1 ]]; then
  echo "Design-token guardrail failed."
  exit 1
fi

echo "✓ Design-token guardrail passed."
