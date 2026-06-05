#!/usr/bin/env bash
# Print SHA-384 SRI hashes for the CDN dependencies pinned in index.html.
# Run this after bumping any pinned version, then paste the new hashes
# into the matching <script>/<link> integrity="..." attributes.
#
# Requires: curl, openssl.
set -euo pipefail

URLS=(
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js"
  "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.10.0/build/highlight.min.js"
  "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.10.0/build/styles/github-dark.min.css"
)

for url in "${URLS[@]}"; do
  hash=$(curl -sfL "$url" | openssl dgst -sha384 -binary | openssl base64 -A)
  printf '%s\n  integrity="sha384-%s"\n\n' "$url" "$hash"
done
