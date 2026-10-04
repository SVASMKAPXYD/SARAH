#!/usr/bin/env bash
# Build the standalone bundle, sync app settings, zip, and deploy to Azure App Service.
# Env overrides: AZURE_RESOURCE_GROUP, AZURE_APP_NAME.
set -euo pipefail
cd "$(dirname "$0")/.."

RG="${AZURE_RESOURCE_GROUP:-girlhacks2026}"
APP="${AZURE_APP_NAME:-girlhacksbackend}"

# nvm is a shell function, so load it explicitly to pick up .nvmrc.
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use
fi

for cmd in zip az; do
  command -v "$cmd" >/dev/null || { echo "$cmd is required but not installed." >&2; exit 1; }
done

npm run build:azure
npm run sync:env

ZIP="$(mktemp -d)/deploy.zip"
trap 'rm -rf "$(dirname "$ZIP")"' EXIT
(cd .next/standalone && zip -qr "$ZIP" .)   # "." includes the hidden .next folder

az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --clean true --async true

echo
echo "Upload done. The site restarts in the background; watch the log stream, then check /api/health."
