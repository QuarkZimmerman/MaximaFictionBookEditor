#!/usr/bin/env bash
# Builds the Linux AppImage from an installed tree (T143).
#
#   packaging/appimage/build.sh --install-tree <dir> --output <file.AppImage> [options]
#
#   --install-tree <dir>   result of `cmake --install <build> --prefix <dir>` (or a CPack staging
#                          directory that already contains usr/); layout: cmake/InstallLayout.cmake
#   --output <file>        AppImage to write (its directory is created)
#   --tools-dir <dir>      where appimagetool and the type2 runtime are kept / downloaded
#                          (default: build/tools below the repository)
#   --update-info <str>    zsync update information embedded in the image, e.g.
#                          "gh-releases-zsync|QuarkZimmerman|MaximaFictionBookEditor|latest|MaximaFictionBookEditor-*-x86_64.AppImage.zsync"
#                          (a .zsync file is written next to the AppImage); "" = none
#   --no-download          fail instead of downloading missing tools
#   --keep-appdir          leave the AppDir next to the output for inspection
#
# Environment (alternatives to the options): MFBE_APPIMAGETOOL, MFBE_APPIMAGE_RUNTIME,
# MFBE_APPIMAGE_TOOLS_DIR, MFBE_APPIMAGE_UPDATE_INFO.
#
# What goes into the image (and what deliberately does not):
#   * usr/ = the install tree: usr/lib/mfbe (shell + CEF), usr/bin/mfbe-core, usr/share/mfbe
#     (resources, ui, scripts), desktop file, MIME definition, icons, licence.
#   * AppRun (packaging/appimage/AppRun), the desktop file, the icon, AppStream metadata.
#   * No system libraries. libcef.so links the GTK 3 stack (glib, gio, pango, cairo, atk,
#     at-spi, fontconfig, freetype, X11/xcb, xkbcommon, dbus, nss/nspr, cups, alsa, drm/gbm),
#     and Chromium additionally loads the host's libgtk-3 at run time for dialogs and theming.
#     Host GTK 3 only loads against the host's glib/pango/cairo, so bundling those libraries
#     breaks the editor on any distribution newer than the build machine; every library in
#     that list is a dependency of GTK 3 itself (or of every desktop session) and therefore
#     present wherever a desktop runs. linuxdeploy's automatic dependency bundling is not
#     used for exactly that reason.
#   * The static type2 runtime (no libfuse2 needed on the target; the image also runs with
#     --appimage-extract-and-run where FUSE is unavailable).
#
# Tools: appimagetool (continuous build, run with --appimage-extract-and-run so no FUSE is
# needed on the build machine) and the type2 runtime from github.com/AppImage/type2-runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

INSTALL_TREE=""
OUTPUT=""
TOOLS_DIR="${MFBE_APPIMAGE_TOOLS_DIR:-$REPO_ROOT/build/tools}"
UPDATE_INFO="${MFBE_APPIMAGE_UPDATE_INFO-}"
ALLOW_DOWNLOAD=1
KEEP_APPDIR=0

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-tree) INSTALL_TREE="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --tools-dir) TOOLS_DIR="$2"; shift 2 ;;
    --update-info) UPDATE_INFO="$2"; shift 2 ;;
    --no-download) ALLOW_DOWNLOAD=0; shift ;;
    --keep-appdir) KEEP_APPDIR=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build.sh: unknown option '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$INSTALL_TREE" || -z "$OUTPUT" ]]; then
  echo "build.sh: --install-tree and --output are required" >&2
  exit 2
fi
if [[ ! -d "$INSTALL_TREE" ]]; then
  echo "build.sh: install tree '$INSTALL_TREE' does not exist" >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64) ;;
  *) echo "build.sh: unsupported architecture '$ARCH'" >&2; exit 1 ;;
esac

# --- tools ------------------------------------------------------------------------------------
mkdir -p "$TOOLS_DIR"
APPIMAGETOOL="${MFBE_APPIMAGETOOL:-$TOOLS_DIR/appimagetool-$ARCH.AppImage}"
RUNTIME="${MFBE_APPIMAGE_RUNTIME:-$TOOLS_DIR/runtime-$ARCH}"

fetch() {
  local url="$1" dest="$2"
  if [[ -s "$dest" ]]; then
    return 0
  fi
  if [[ "$ALLOW_DOWNLOAD" != "1" ]]; then
    echo "build.sh: $dest is missing and downloads are disabled (--no-download)" >&2
    exit 1
  fi
  echo "build.sh: downloading $url"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

if [[ ! -x "$APPIMAGETOOL" ]]; then
  if command -v appimagetool >/dev/null 2>&1 && [[ -z "${MFBE_APPIMAGETOOL:-}" ]]; then
    APPIMAGETOOL="$(command -v appimagetool)"
  else
    fetch "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$ARCH.AppImage" "$APPIMAGETOOL"
    chmod +x "$APPIMAGETOOL"
  fi
fi
fetch "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$ARCH" "$RUNTIME"

APPIMAGETOOL_ARGS=()
if [[ "$APPIMAGETOOL" == *.AppImage ]]; then
  # No FUSE required on the build machine (containers, CI runners).
  APPIMAGETOOL_ARGS+=(--appimage-extract-and-run)
fi

# --- AppDir -----------------------------------------------------------------------------------
mkdir -p "$(dirname "$OUTPUT")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT")" && pwd)"
OUTPUT_NAME="$(basename "$OUTPUT")"
APPDIR="$OUTPUT_DIR/${OUTPUT_NAME%.AppImage}.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr"

if [[ -d "$INSTALL_TREE/usr/lib/mfbe" ]]; then
  SRC="$INSTALL_TREE/usr"      # CPack staging dir with CPACK_PACKAGING_INSTALL_PREFIX=/usr
else
  SRC="$INSTALL_TREE"          # plain --prefix install
fi
for required in lib/mfbe/mfbe lib/mfbe/libcef.so share/mfbe/resources share/mfbe/ui/index.html \
                share/applications/mfbe.desktop share/icons/hicolor/256x256/apps/mfbe.png; do
  if [[ ! -e "$SRC/$required" ]]; then
    echo "build.sh: $SRC/$required is missing - install the app, resources, ui and scripts components first" >&2
    exit 1
  fi
done
cp -a "$SRC/." "$APPDIR/usr/"

# chrome-sandbox cannot be SUID inside a squashfs image; drop it so nothing can pick it up
# half-configured (the shell detects the missing helper and uses user namespaces or, failing
# that, --no-sandbox with a logged warning).
rm -f "$APPDIR/usr/lib/mfbe/chrome-sandbox"

install -m 755 "$SCRIPT_DIR/AppRun" "$APPDIR/AppRun"
cp "$SRC/share/applications/mfbe.desktop" "$APPDIR/mfbe.desktop"
cp "$SRC/share/icons/hicolor/256x256/apps/mfbe.png" "$APPDIR/mfbe.png"
ln -sf mfbe.png "$APPDIR/.DirIcon"
mkdir -p "$APPDIR/usr/share/metainfo"
cp "$SCRIPT_DIR/mfbe.appdata.xml" "$APPDIR/usr/share/metainfo/mfbe.appdata.xml"

# Sanity check of the loader paths: the shell must find libcef.so through its RPATH alone.
if command -v ldd >/dev/null 2>&1; then
  if ldd "$APPDIR/usr/lib/mfbe/mfbe" | grep -q "libcef.so => not found"; then
    echo "build.sh: usr/lib/mfbe/mfbe does not resolve libcef.so via RPATH" >&2
    exit 1
  fi
fi

# --- AppImage ---------------------------------------------------------------------------------
rm -f "$OUTPUT_DIR/$OUTPUT_NAME" "$OUTPUT_DIR/$OUTPUT_NAME.zsync"
# --no-appstream: appstreamcli validation needs network access (URL checks) and is not part
# of the build; the metadata file is still embedded.
ARGS=("${APPIMAGETOOL_ARGS[@]}" --runtime-file "$RUNTIME" --comp zstd --no-appstream)
if [[ -n "$UPDATE_INFO" ]]; then
  ARGS+=(-u "$UPDATE_INFO")
fi
echo "build.sh: appimagetool ${ARGS[*]} $APPDIR $OUTPUT_DIR/$OUTPUT_NAME"
# ARCH is read by appimagetool; VERSION ends up in the embedded desktop file (X-AppImage-Version).
# Run inside the output directory: the .zsync file is written to the current directory.
(cd "$OUTPUT_DIR" && ARCH="$ARCH" VERSION="${MFBE_APPIMAGE_VERSION:-}" \
  "$APPIMAGETOOL" "${ARGS[@]}" "$APPDIR" "$OUTPUT_DIR/$OUTPUT_NAME")
chmod +x "$OUTPUT_DIR/$OUTPUT_NAME"

if [[ "$KEEP_APPDIR" != "1" ]]; then
  rm -rf "$APPDIR"
fi

echo "build.sh: wrote $OUTPUT_DIR/$OUTPUT_NAME ($(du -h "$OUTPUT_DIR/$OUTPUT_NAME" | cut -f1))"
if [[ -f "$OUTPUT_DIR/$OUTPUT_NAME.zsync" ]]; then
  echo "build.sh: wrote $OUTPUT_DIR/$OUTPUT_NAME.zsync"
fi
