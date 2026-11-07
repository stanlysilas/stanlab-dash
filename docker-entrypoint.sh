#!/bin/sh
set -eu

if [ "${1:-}" = "setup" ]; then
  shift
  exec node /app/scripts/setup-auth.mjs "$@"
fi

exec node /app/dist/server/index.js "$@"
