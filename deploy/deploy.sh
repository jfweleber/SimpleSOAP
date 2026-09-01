#!/usr/bin/env bash
# Build SimpleSOAP and push it to soap.weleber.net.
#
#   ./deploy/deploy.sh
#   SOAP_HOST=you@example.com ./deploy/deploy.sh
#
# Uses tar over ssh rather than rsync, which is not installed on the Windows
# side. Stale files are cleared first so old asset hashes cannot accumulate.
set -euo pipefail

# The target is not in the repo. This is a public repository, and an ssh user
# on a named host is half a credential pair for anyone who reads it. Put yours
# in deploy/target.env, which is gitignored — see target.env.example.
CONFIG="$(dirname "$0")/target.env"
# an explicit SOAP_HOST on the command line wins over the file
if [ -z "${SOAP_HOST:-}" ] && [ -f "$CONFIG" ]; then
  # shellcheck source=/dev/null
  . "$CONFIG"
fi

HOST="${SOAP_HOST:-}"
REMOTE_DIR="${SOAP_DIR:-/var/www/soap.weleber.net}"
KEY="${SOAP_KEY:-$HOME/.ssh/simplesoap_deploy}"

if [ -z "$HOST" ]; then
  echo "No deploy target." >&2
  echo "  cp deploy/target.env.example deploy/target.env  and fill it in," >&2
  echo "  or run:  SOAP_HOST=you@example.com $0" >&2
  exit 1
fi

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
