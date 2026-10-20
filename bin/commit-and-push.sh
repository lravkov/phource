#!/bin/bash
# Usage: ./bin/commit-and-push.sh "commit message"
# Credentials stored in ~/.git-credentials (set up with PAT)
# Or push manually: git add -A && git commit -m "msg" && git push origin main

set -e
cd "$(dirname "$0")/.."

MSG="${1:-$(date '+%Y-%m-%d') changes}"

git add -A
git commit -m "$MSG" 2>&1 || true
git push origin main 2>&1
echo "Done. Pushed to https://github.com/lravkov/phource"
