#!/bin/sh
# Builds the Chrome Web Store upload: dist/openparty-<version>.zip from extension/.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./extension/manifest.json").version')
out="dist/openparty-$version.zip"
mkdir -p dist
rm -f "$out"
(cd extension && zip -qrX "../$out" . -x '.*' -x '*/.*')
echo "$out"
unzip -l "$out" | tail -1
