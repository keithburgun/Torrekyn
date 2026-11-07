#!/usr/bin/env bash
# Upload one build to itch.io with butler.   Usage: itch_push.sh <file-or-folder> <channel> <version>
# Channels: html5 (browser version), android, windows.
# Needs the repo secret BUTLER_API_KEY and the repo variable ITCH_GAME ("user/game", e.g. keithburgun/torrekin).
# Until both are set it skips with a notice instead of failing the build.
set -u
SRC="$1"; CH="$2"; VERSION="$3"
summary(){ echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
if [ -z "${BUTLER_API_KEY:-}" ] || [ -z "${ITCH_GAME:-}" ]; then
  echo "::notice title=itch.io::Not uploading $CH: add the BUTLER_API_KEY secret and the ITCH_GAME variable in the repo settings."
  summary "- ⏭ itch.io **$CH**: not set up yet (BUTLER_API_KEY secret / ITCH_GAME variable)"
  exit 0
fi
if [ ! -x ./butler/butler ]; then
  curl -sSL -o butler.zip https://broth.itch.zone/butler/linux-amd64/LATEST/archive/default \
    && unzip -qo butler.zip -d butler && chmod +x butler/butler || { echo "::error title=itch.io::Couldn't download butler"; exit 1; }
fi
out=$(./butler/butler push "$SRC" "$ITCH_GAME:$CH" --userversion "$VERSION" 2>&1); rc=$?; echo "$out"
if [ $rc -ne 0 ]; then
  msg=$(echo "$out" | grep -v '^\s*$' | tail -4 | tr '\n' ' ' | cut -c1-600)
  echo "::error title=itch.io upload failed: $CH::$msg"; summary "- ❌ itch.io **$CH**: \`$msg\`"; exit 1
fi
summary "- ✅ itch.io **$CH** uploaded as $VERSION ($ITCH_GAME)"
