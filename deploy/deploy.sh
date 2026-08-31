#!/usr/bin/env bash
# Build SimpleSOAP and push it to soap.weleber.net.
#
#   ./deploy/deploy.sh
#   SOAP_HOST=you@example.com ./deploy/deploy.sh
#
# Uses tar over ssh rather than rsync, which is not installed on the Windows
# side. Stale files are cleared first so old asset hashes cannot accumulate.
set -euo pipefail

HOST="${SOAP_HOST:-you@example.com}"
REMOTE_DIR="${SOAP_DIR:-/var/www/soap.weleber.net}"
KEY="${SOAP_KEY:-$HOME/.ssh/simplesoap_deploy}"

cd "$(dirname "$0")/.."

echo "==> Building"
npm run build

echo "==> Clearing ${HOST}:${REMOTE_DIR}"
# -mindepth 1 keeps the directory itself, whose ownership we do not control
ssh -i "$KEY" "$HOST" "find '${REMOTE_DIR}' -mindepth 1 -delete"

echo "==> Uploading"
tar -C dist -czf - . | ssh -i "$KEY" "$HOST" "tar -C '${REMOTE_DIR}' -xzf -"

echo "==> Verifying"
ssh -i "$KEY" "$HOST" "ls '${REMOTE_DIR}/index.html' '${REMOTE_DIR}/sw.js' >/dev/null && echo '    index.html and sw.js in place'"

echo "==> Done — https://soap.weleber.net"
