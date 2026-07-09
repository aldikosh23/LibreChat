#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${LIBRECHAT_PUBLIC_URL:-https://chat.aigate.shop}"
host="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^https?://([^/]+).*#\1#')"

if ! getent hosts "$host" >/dev/null 2>&1; then
  echo "smoke: $host has no DNS yet, skipping public smoke"
  exit 0
fi

curl -fsS --retry 3 --retry-delay 2 --max-time 20 "$PUBLIC_URL/health" >/dev/null
echo "smoke: ok"
