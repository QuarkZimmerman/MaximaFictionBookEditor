#!/usr/bin/env bash
# Feature 014 (D21, FR-040, SC-001, SC-015): every PDF the editor writes must pass veraPDF, the
# PDF Association's PDF/A validator, against the PDF/A-2 level U profile, with no failed rule.
#
# veraPDF is a test tool and never shipped. Its versioned installers live at
# https://software.verapdf.org/rel/<major.minor>/ (the install documentation,
# https://docs.verapdf.org/install/, links only the latest one). 1.30.3 (2026-10-07) is pinned:
# 1.30.4 was less than seven days old when this was written. veraPDF publishes PGP signatures,
# not digests; the SHA-256 below is the one of the file fetched on 2026-11-12. It needs a Java
# runtime (11 or newer; CI uses Temurin 21, as for EPUBCheck).
#
# Usage: tools/ci/verapdf.sh --fetch           download, verify and install the pinned release only
#        tools/ci/verapdf.sh <file.pdf> [...]  check each file; exit 1 when any fails a rule
# The download and the installation are kept in ${MFBE_VERAPDF_CACHE:-~/.cache/mfbe-verapdf},
# outside the repository.
set -euo pipefail

version="1.30.3"
sha256="b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59"
url="https://software.verapdf.org/rel/${version%.*}/verapdf-greenfield-${version}-installer.zip"
cache="${MFBE_VERAPDF_CACHE:-${HOME}/.cache/mfbe-verapdf}"
zip="${cache}/verapdf-greenfield-${version}-installer.zip"
home="${cache}/verapdf-${version}"
cli="${home}/verapdf"

fetch() {
  mkdir -p "$cache"
  if [ ! -f "$zip" ]; then
    curl -sSfL --retry 3 -o "${zip}.part" "$url"
    mv "${zip}.part" "$zip"
  fi
  if ! echo "${sha256}  ${zip}" | sha256sum -c --status; then
    echo "verapdf: ${zip} does not match the pinned SHA-256; removed" >&2
    rm -f "$zip"
    exit 1
  fi
  if [ ! -x "$cli" ]; then
    local work
    work="$(mktemp -d)"
    (cd "$work" && unzip -q -o "$zip")
    # The installer's unattended mode (IzPack), with the command-line pack only.
    cat > "${work}/auto-install.xml" <<EOF
<AutomatedInstallation langpack="eng">
    <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
    <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
        <installpath>${home}</installpath>
    </com.izforge.izpack.panels.target.TargetPanel>
    <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
        <pack index="0" name="veraPDF GUI" selected="false"/>
        <pack index="1" name="veraPDF CLI" selected="true"/>
        <pack index="2" name="veraPDF Documentation" selected="false"/>
        <pack index="3" name="veraPDF Sample Plugins" selected="false"/>
    </com.izforge.izpack.panels.packs.PacksPanel>
    <com.izforge.izpack.panels.install.InstallPanel id="install"/>
    <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
EOF
    if ! java -jar "${work}/verapdf-greenfield-${version}/verapdf-izpack-installer-${version}.jar" \
      "${work}/auto-install.xml" >"${work}/install.log" 2>&1 || [ ! -x "$cli" ]; then
      cat "${work}/install.log" >&2
      echo "verapdf: the installation failed" >&2
      rm -rf "$work"
      exit 1
    fi
    rm -rf "$work"
  fi
}

fetch
[ "${1:-}" = "--fetch" ] && exit 0
if [ "$#" -eq 0 ]; then
  echo "usage: tools/ci/verapdf.sh --fetch | <file.pdf> [...]" >&2
  exit 2
fi

report="$(mktemp)"
trap 'rm -f "$report"' EXIT
# The JSON report names every failed rule; veraPDF's exit code does not tell compliance apart.
"$cli" --flavour 2u --format json "$@" 2>/dev/null > "$report" || true
python3 - "$report" "$@" <<'PY'
import json, sys
path, files = sys.argv[1], sys.argv[2:]
try:
    jobs = json.load(open(path, encoding="utf-8"))["report"]["jobs"]
except (OSError, ValueError, KeyError) as error:
    print(f"verapdf: no report ({error})")
    sys.exit(1)
status = 0
seen = set()
for job in jobs:
    name = job.get("itemDetails", {}).get("name", "?")
    seen.add(name)
    results = job.get("validationResult") or []
    if not results or job.get("taskException"):
        print(f"verapdf: {name}: not validated ({job.get('taskException')})")
        status = 1
        continue
    for result in results:
        if result.get("compliant"):
            print(f"verapdf: {name}: PDF/A-2u, no failed rule")
            continue
        status = 1
        for rule in result.get("details", {}).get("ruleSummaries", []):
            if rule.get("ruleStatus") == "FAILED":
                print(f"verapdf: {name}: FAILED {rule.get('specification')} {rule.get('clause')}-"
                      f"{rule.get('testNumber')} ({rule.get('failedChecks')} checks): "
                      f"{(rule.get('description') or '').strip()}")
missing = [f for f in files if f not in seen and not any(s.endswith(f) for s in seen)]
for f in missing:
    print(f"verapdf: {f}: missing from the report")
    status = 1
sys.exit(status)
PY
