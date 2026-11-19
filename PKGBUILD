# Build from the DerpDesign checkout, like the sibling DerpBird package.
BUILDDIR="$startdir/artifacts/arch"
pkgname=derpdesign
pkgver=0.1.0
pkgrel=2
pkgdesc='Desktop demo canvas with Chromium and Ladybird renderers'
arch=('x86_64')
license=('custom')
depends=(alsa-lib at-spi2-core ca-certificates cairo cpptrace dbus expat gcc-libs
         glib2 glibc libcups libglvnd libpulse libx11 libxcb libxcomposite
         libxdamage libxext libxfixes libxkbcommon libxrandr mesa nspr nss pango
         qt6-base qt6-declarative qt6-wayland qt6-websockets systemd-libs vulkan-icd-loader)
makedepends=(autoconf-archive rustup cmake curl git nasm ninja patchelf python qt6-tools unzip zip)
options=('!strip' '!debug' '!lto')

build() {
  cd "$startdir"
  command -v bun >/dev/null || { error 'Bun is required on PATH'; return 1; }
  bun install --frozen-lockfile
  bun build --compile --minify --define 'window=undefined' packaging/main.ts --outfile "$srcdir/derpdesign"
  cmake -S apps/desktop -B "$srcdir/desktop" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
  cmake --build "$srcdir/desktop" --parallel 4
  if [[ ${DERPDESIGN_PACKAGE_REUSE_BUILD:-0} != 1 ]]; then
    scripts/setup-cef.sh
    scripts/setup-ladybird --build
  else
    cmake --build .local/engines/chromium/build --target derp-chromium
  fi
  export RUSTUP_TOOLCHAIN=1.98.0
  cmake --build .local/engines/ladybird/build-upstream --target derp-ladybird ladybird --parallel "${LADYBIRD_JOBS:-4}"
  python3 tests/ladybird/status
}

package() {
  cd "$startdir"
  local dest="$pkgdir/usr/lib/derpdesign" cef=.local/engines/chromium lb=.local/engines/ladybird
  install -Dm755 "$srcdir/derpdesign" "$dest/bin/derpdesign"
  install -d "$pkgdir/usr/bin"
  ln -s ../lib/derpdesign/bin/derpdesign "$pkgdir/usr/bin/derpdesign"
  install -Dm755 "$srcdir/desktop/derpdesign" "$dest/libexec/derpdesign"
  install -Dm755 "$cef/build/derp-chromium" "$dest/chromium/derp-chromium"
  patchelf --set-rpath '$ORIGIN' "$dest/chromium/derp-chromium"
  cp -aL "$cef/sdk/Release/." "$cef/sdk/Resources/." "$dest/chromium/"
  install -Dm755 "$lb/build-upstream/bin/derp-ladybird" "$dest/ladybird/bin/derp-ladybird"
  install -d "$dest/ladybird/libexec" "$dest/ladybird/share" "$dest/packages/harness"
  install -m755 "$lb/build-upstream/libexec/"{AudioServer,Compositor,Hub,ImageDecoder,MediaServer,RequestServer,SystemProbe,VideoDecoderServer,WebContent,WebRTCClient} "$dest/ladybird/libexec/"
  # Reused shared builds need their private engine and vcpkg libraries alongside the helpers.
  local file library
  local -a binaries=("$dest/ladybird/bin/derp-ladybird" "$dest"/ladybird/libexec/*)
  local private_libs
  local -a sources=("$lb/build-upstream/bin/derp-ladybird")
  for file in "$dest"/ladybird/libexec/*; do sources+=("$lb/build-upstream/libexec/${file##*/}"); done
  private_libs=$(ldd "${sources[@]}" | awk '$2 == "=>" && $3 ~ /^\// && $3 !~ /^\/(usr\/)?lib(64)?\// { print $3 }' | sort -u)
  if [[ -n $private_libs ]]; then
    install -d "$dest/ladybird/lib"
    while IFS= read -r library; do
      install -m755 "$library" "$dest/ladybird/lib/${library##*/}"
    done <<< "$private_libs"
    for file in "$dest"/ladybird/lib/*; do patchelf --set-rpath '$ORIGIN' "$file"; done
    for file in "${binaries[@]}"; do patchelf --set-rpath '$ORIGIN/../lib' "$file"; done
  fi
  cp -aL "$lb/build-upstream/share/Lagom" "$dest/ladybird/share/"
  cp -a packages/harness/{package.json,src} "$dest/packages/harness/"
  install -Dm644 "$cef/sdk/LICENSE.txt" "$pkgdir/usr/share/licenses/$pkgname/CEF"
  install -Dm644 "$cef/sdk/CREDITS.html" "$pkgdir/usr/share/licenses/$pkgname/CEF-CREDITS.html"
  install -Dm644 "$lb/ladybird-$(cat engines/ladybird/REVISION)/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/Ladybird"
  install -Dm644 packaging/derpdesign.desktop "$pkgdir/usr/share/applications/derpdesign.desktop"
}
