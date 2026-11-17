#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dest="$PWD/.local/engines/chromium"
mkdir -p "$dest"
name='cef_binary_156.0.30+g6028375+chromium-156.0.8078.96_linux64_minimal'
if [[ ! -f "$dest/cef.tar.bz2" ]]; then curl -fL "https://cef-builds.spotifycdn.com/${name//+/%2B}.tar.bz2" -o "$dest/cef.tar.bz2"; fi
printf '%s  %s\n' 0b4c2189e3b93033bbef13add1a86f66849c1e62 "$dest/cef.tar.bz2" | sha1sum -c -
sha256sum "$dest/cef.tar.bz2" > "$dest/SHA256SUMS"
if [[ ! -d "$dest/sdk" ]]; then mkdir "$dest/sdk"; tar -xjf "$dest/cef.tar.bz2" -C "$dest/sdk" --strip-components=1; fi
cmake -S engines/chromium -B "$dest/build" -DCEF_ROOT="$dest/sdk" -DCMAKE_BUILD_TYPE=Release
cmake --build "$dest/build" -j8
