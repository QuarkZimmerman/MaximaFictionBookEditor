#!/usr/bin/env python3
"""Third-party licence inventory and policy check (T156, Constitution VI).

Collects every component that ships with the editor or is needed to build it, resolves its
licence and the location of the full licence text, applies the project policy (the editor is
GPL-3.0-only: every distributed component must carry a licence that may be part of a GPL-3.0
work; licences that may not, and unknown licences, fail; a multi-licensed component is
recorded under a compatible option) and writes ``THIRD-PARTY-NOTICES.md``. The notices list
component names, versions, licence identifiers and the location of the licence texts; the
texts themselves, with the copyright notices they carry, are exported for the packages with
``--export-texts``.

Sources (all relative to the repository root):

* ``vcpkg.json`` + the installed tree ``build/vcpkg_installed/<triplet>/`` (``vcpkg/status`` for
  the installed ports and versions, ``share/<port>/vcpkg.spdx.json`` for the licence declared
  by the port, ``share/<port>/copyright`` for the text, classified again by heuristics as a
  cross-check). Ports pulled in only for building (``vcpkg-*`` helpers, ``libiconv`` on Linux)
  and for the test suite (``catch2``) are listed as "not distributed".
* ``ui/package-lock.json``: the production dependency closure of ``ui/package.json`` (the
  packages Vite can bundle into ``ui/dist``) with the ``license`` field recorded in the lock
  file; when ``ui/node_modules`` is present the installed ``package.json`` and ``LICENSE``
  files are verified as well.
* ``cmake/CefVersion.cmake``: the pinned Chromium Embedded Framework build (BSD-3-Clause) and
  Chromium version; ``LICENSE.txt`` of a downloaded distribution under ``third_party/downloads``
  is verified when present.
* ``resources/README.md`` (table of bundled data files), ``resources/schema/SOURCE.txt`` and
  ``resources/dictionaries/SOURCES.txt`` (versions): FB2 schema (BSD-2-Clause), Hunspell
  dictionaries (SCOWL / BSD-style), material derived from the original editor and the
  bundled user scripts converted from it (GPL-3.0-only, the original's licence; its notices
  are in ``CONTRIBUTORS.txt``).
* Aggregated data (Constitution VI, decision D16): run-time data files the editor only reads
  and never combines into the program - an aggregate in the sense of GPLv3 section 5, today
  the dict_uk Ukrainian dictionary ``resources/dictionaries/uk_UA.*`` (MPL-1.1). They are not
  judged for GPL-3.0 compatibility; their licence must allow free redistribution with the
  notice that ships next to them (``<tag>.txt``), and that notice file must exist.

Usage::

    tools/licence-check.py                      # regenerate THIRD-PARTY-NOTICES.md
    tools/licence-check.py --check              # CI: verify policy and that the committed
                                                #      notices are up to date (no write)
    tools/licence-check.py --export-texts DIR   # copy every licence text into DIR
                                                #      (<component>.txt) for packaging; the
                                                #      notices file is not rewritten
    tools/licence-check.py --json               # machine-readable inventory on stdout

Exit codes: 0 ok, 1 policy violation / missing licence text / stale notices, 2 usage error.
Without an installed vcpkg tree (a plain checkout, the CI lint job) the native rows of the
committed notices are checked against the policy and against ``vcpkg.json`` but their
versions and copyright files cannot be re-verified; the tool says so and still succeeds
when everything else matches. Full verification (byte-exact comparison of the regenerated
notices) happens wherever the core was built: developer machines and the Linux job of the
release workflow. The notices are written with a ``<triplet>`` placeholder and without
platform-specific wording so that the Linux build is the reference; the version set is the
same on every platform (pinned vcpkg baseline).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NOTICES = REPO / "THIRD-PARTY-NOTICES.md"

# Licence identifiers that may be distributed as part of a GPL-3.0 work (Constitution VI).
# Copyleft entries carry a note that is printed next to the component.
ALLOWED: dict[str, str] = {
    "MIT": "",
    "MIT-0": "",
    "BSD-2-Clause": "",
    "BSD-3-Clause": "",
    "BSD-style": "",
    "0BSD": "",
    "ISC": "",
    "Apache-2.0": "",
    "Zlib": "",
    "libpng-2.0": "",
    "libtiff": "",
    "IJG": "",
    "BSL-1.0": "",
    "ICU": "",
    "Unlicense": "",
    "CC-PDDC": "",
    "CC0-1.0": "",
    "public-domain": "",
    "SCOWL": "",
    "MPL-2.0": "weak copyleft: compatible with GPL-3.0 through its secondary-licence clause",
    "LGPL-2.1-only": "weak copyleft: compatible with GPL-3.0 (LGPL-2.1 section 3)",
    "LGPL-2.1-or-later": "weak copyleft: compatible with GPL-3.0",
    "LGPL-3.0-only": "weak copyleft: compatible with GPL-3.0",
    "LGPL-3.0-or-later": "weak copyleft: compatible with GPL-3.0",
    "GPL-2.0-or-later": "copyleft: used under GPL-3.0",
    "GPL-3.0-only": "copyleft: the project's own licence",
    "GPL-3.0-or-later": "copyleft: used under GPL-3.0",
}
# Licences that may not be part of a GPL-3.0 work (reported with a specific message; anything
# else outside ALLOWED is reported as "not in the allowed list").
INCOMPATIBLE = {"GPL-1.0-only", "GPL-2.0-only", "GPL-2.0", "MPL-1.0", "MPL-1.1", "EPL-1.0",
                "EPL-2.0", "CDDL-1.0", "CDDL-1.1", "AGPL-1.0", "AGPL-3.0-only",
                "AGPL-3.0-or-later", "AGPL", "GPL", "LGPL", "Proprietary"}
# Aggregated data (group "aggregate"): run-time data files that are not combined into the
# program need no GPL-3.0 compatibility, only a licence that allows free redistribution with
# their notice - every ALLOWED licence plus the ones below (Constitution VI, D16). Licences
# forbidding redistribution or commercial use (CC BY-NC-*, "no redistribution") are not here
# and fail like any other licence outside the lists.
AGGREGATE_ALLOWED = {"MPL-1.1"}

# The project's own licence (Constitution VI) and the SHA-256 of the FSF text of the GNU GPL
# version 3 (https://www.gnu.org/licenses/gpl-3.0.txt) that LICENSE must hold.
PROJECT_LICENCE = "GPL-3.0-only"
GPL3_TEXT_SHA256 = "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986"
NOTICE_FILES = ("CONTRIBUTORS.txt", "gpl-3.0.ru.txt", "gpl-3.0.ua.txt")
# A statement that names MIT as a licence (the editor's own licence statements must name
# GPL-3.0; AppStream's metadata_license licenses the metadata file itself and is exempt).
MIT_STATEMENT_RE = re.compile(r"(?i)\blicen[cs]e\b[^\n]{0,24}\bMIT\b|\bMIT\b[^\n]{0,12}\blicen[cs]e\b")

# Ports that are installed for the build only and never linked into or shipped with the editor.
BUILD_ONLY_PORTS = {
    "libiconv": (
        "pulled in by the hunspell port for its optional command-line tools; the hunspell "
        "library itself does not call iconv and the editor links hunspell only. On Linux and "
        "macOS the port installs no library (the C runtime's iconv satisfies it); on Windows it "
        "builds a static library that nothing in the editor links"
    ),
    "vcpkg-cmake": "vcpkg build helper",
    "vcpkg-cmake-config": "vcpkg build helper",
    "vcpkg-cmake-get-vars": "vcpkg build helper",
    "vcpkg-make": (
        "vcpkg build helper; its GNU Automake helper scripts are GPL-2.0-or-later and are used "
        "only while building"
    ),
}

# Licences of build-only ports whose vcpkg metadata declares none (LicenseRef-vcpkg-null).
KNOWN_LICENCES = {
    "libiconv": "LGPL-2.1-or-later",
    "vcpkg-make": "MIT AND GPL-2.0-or-later",
}


@dataclass
class Component:
    group: str  # native | engine | npm | data | aggregate | tooling
    name: str
    version: str
    licence: str  # effective SPDX-like identifier(s) as recorded in the notices
    text: str  # location of the full licence text (relative to the repository root)
    note: str = ""
    distributed: bool = True
    homepage: str = ""
    text_paths: list[Path] = field(default_factory=list)  # absolute paths for --export-texts
    problems: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------------------------
# Licence text heuristics


def detect_licence(text: str) -> list[str]:
    """Classifies a licence text into SPDX-like identifiers (several when the text concatenates
    licences). Returns [] when nothing matched."""
    t = re.sub(r"\s+", " ", text)
    low = t.lower()
    found: list[str] = []

    def add(identifier: str) -> None:
        if identifier not in found:
            found.append(identifier)

    if "mpl 1.1/gpl 2.0/lgpl 2.1" in low or "lgpl/gpl/mpl tri-license" in low:
        add("MPL-1.1 OR LGPL-2.1-or-later OR GPL-2.0-or-later")
        return found
    if "apache license" in low and "version 2.0" in low:
        add("Apache-2.0")
    if "boost software license - version 1.0" in low:
        add("BSL-1.0")
    if "png reference library license version 2" in low:
        add("libpng-2.0")
    if "mozilla public license" in low and "version 2.0" in low and "MPL-1.1" not in found:
        add("MPL-2.0")
    if "the origin of this software must not be misrepresented" in low and "as-is" in low:
        add("Zlib")
    if "independent jpeg group" in low or "readme.ijg" in low:
        add("IJG")
    if ("permission to use, copy, modify, distribute, and sell this software" in low
            and "without fee" in low and "advertising or publicity" in low):
        add("libtiff")
    if "alternative b - public domain" in low or "www.unlicense.org" in low:
        add("Unlicense")
    if ("permission is hereby granted, free of charge" in low
            and "the above copyright notice and this permission notice shall be included" in low):
        add("MIT")
    if "redistribution and use in source and binary forms" in low:
        if "neither the name" in low or "names of its contributors" in low:
            add("BSD-3-Clause")
        else:
            add("BSD-2-Clause")
    if "gnu lesser general public license" in low or "gnu library general public license" in low:
        add("LGPL-2.1-or-later" if "version 2.1" in low else "LGPL")
    if "gnu general public license" in low and "lesser" not in low[: low.find("gnu general public license")]:
        add("GPL")
    if "gnu affero general public license" in low:
        add("AGPL")
    return found


def split_expression(expression: str) -> list[str]:
    """Identifiers of an SPDX expression (`(MIT OR CC-PDDC)` -> ['MIT', 'CC-PDDC'])."""
    return [p for p in re.split(r"\s+(?:OR|AND|WITH)\s+|[()]", expression) if p.strip()]


def choose_licence(declared: str | None, detected: list[str]) -> tuple[str, str]:
    """Returns (identifier for the notices, note). Prefers the port's declaration; for OR
    expressions the most permissive option that may be part of a GPL-3.0 work is chosen
    explicitly (Hunspell's MPL-1.1/GPL/LGPL tri-licence: LGPL-2.1-or-later, because MPL-1.1
    alone is not compatible with GPL-3.0)."""
    expression = (declared or "").strip()
    if not expression or expression.startswith("LicenseRef-vcpkg-null"):
        expression = " AND ".join(detected)
    if not expression:
        return "unknown", ""
    if "MPL-1.1" in expression and "GPL" in expression:
        return ("LGPL-2.1-or-later",
                "MPL-1.1/GPL-2.0-or-later/LGPL-2.1-or-later tri-licence (LGPL-2.1-or-later used; "
                "MPL-1.1 alone is not compatible with GPL-3.0)")
    if " OR " in expression:
        options = split_expression(expression)
        compatible = sorted((o for o in options if o in ALLOWED), key=lambda o: bool(ALLOWED[o]))
        if compatible:
            others = " / ".join(o for o in options if o != compatible[0])
            return compatible[0], f"dual licence ({compatible[0]} chosen; alternative: {others})"
    # libjpeg-turbo: the port declares the TurboJPEG BSD licence; the libjpeg API code keeps
    # the IJG licence (both in the same copyright file).
    if "IJG" in detected and "IJG" not in expression:
        expression += " AND IJG"
    return expression.strip("()"), ""


def policy_problems(component: Component) -> list[str]:
    """Policy violations of one component (empty when it passes). Build/test-only components
    are recorded but not judged: nothing of them is distributed. Aggregated data is judged
    only for free redistribution with its notice, which must exist."""
    problems: list[str] = []
    if component.licence == "unknown":
        problems.append("licence could not be determined")
        return problems
    if not component.distributed:
        return problems
    if component.group == "aggregate":
        for identifier in split_expression(component.licence):
            identifier = identifier.strip()
            if identifier not in ALLOWED and identifier not in AGGREGATE_ALLOWED:
                problems.append(f"licence {identifier} does not allow free redistribution of aggregated data")
        if not component.text_paths:
            problems.append("aggregated data must ship with its notice file")
        return problems
    for identifier in split_expression(component.licence):
        identifier = identifier.strip()
        if identifier in INCOMPATIBLE:
            problems.append(f"licence {identifier} may not be part of a GPL-3.0 work")
            continue
        if identifier not in ALLOWED:
            problems.append(f"licence {identifier} is not in the allowed list")
    return problems


# --------------------------------------------------------------------------------------------
# vcpkg


def find_vcpkg_installed(explicit: str | None) -> Path | None:
    root = Path(explicit) if explicit else REPO / "build" / "vcpkg_installed"
    if not root.is_dir():
        return None
    return root


def vcpkg_triplets(installed: Path) -> list[Path]:
    return sorted(p for p in installed.iterdir() if p.is_dir() and (p / "share").is_dir())


def parse_status(installed: Path, triplet: str | None) -> dict[str, dict[str, str]]:
    """`vcpkg/status`: port -> fields (version, depends, architecture) of the target triplet;
    feature paragraphs are skipped. Where the host triplet differs (Windows: x64-windows next to
    x64-windows-static), ports installed for it are build tools; without `triplet` the target is
    the triplet of the editor's direct dependencies."""
    status = installed / "vcpkg" / "status"
    found: dict[str, list[dict[str, str]]] = {}
    if not status.is_file():
        return {}
    for paragraph in status.read_text(encoding="utf-8").split("\n\n"):
        fields: dict[str, str] = {}
        for line in paragraph.splitlines():
            if ":" in line and not line.startswith(" "):
                key, _, value = line.partition(":")
                fields[key.strip().lower()] = value.strip()
        if "package" not in fields or "feature" in fields:
            continue
        if "installed" not in fields.get("status", ""):
            continue
        found.setdefault(fields["package"], []).append(fields)
    if not triplet:
        runtime, _ = manifest_dependencies()
        counts = Counter(f.get("architecture") for name in runtime for f in found.get(name, []))
        triplet = counts.most_common(1)[0][0] if counts else None
    ports: dict[str, dict[str, str]] = {}
    for name, entries in found.items():
        target = [f for f in entries if f.get("architecture") == triplet]
        if target:
            ports[name] = target[0]
        elif not triplet or len({f.get("architecture") for f in found.get(name, [])}) == 1:
            ports[name] = entries[0]
    return ports


def manifest_dependencies() -> tuple[set[str], set[str]]:
    """Direct dependencies of vcpkg.json: (runtime, test-only)."""
    manifest = json.loads((REPO / "vcpkg.json").read_text(encoding="utf-8"))

    def names(entries: list) -> set[str]:
        out: set[str] = set()
        for entry in entries:
            out.add(entry if isinstance(entry, str) else entry["name"])
        return out

    runtime = names(manifest.get("dependencies", []))
    tests: set[str] = set()
    for feature in manifest.get("features", {}).values():
        tests |= names(feature.get("dependencies", []))
    return runtime, tests


def collect_vcpkg(installed: Path | None, triplet_name: str | None,
                  problems: list[str]) -> list[Component]:
    runtime_direct, test_only = manifest_dependencies()
    components: list[Component] = []
    if installed is None:
        return components
    triplets = vcpkg_triplets(installed)
    if not triplets:
        problems.append(f"{installed}: no installed triplet found")
        return components
    triplet = triplets[0]
    # The notices are committed, so paths are written with a <triplet> placeholder: the version
    # set is the same on every platform (pinned baseline) and only the folder name differs.
    rel_installed = installed.relative_to(REPO).as_posix() if installed.is_relative_to(REPO) else installed.as_posix()
    ports = parse_status(installed, triplet_name)
    for name in sorted(ports):
        version = ports[name].get("version", "")
        share = installed / ports[name].get("architecture", triplet.name) / "share" / name
        copyright_file = share / "copyright"
        spdx_file = share / "vcpkg.spdx.json"
        declared: str | None = None
        homepage = ""
        if spdx_file.is_file():
            try:
                spdx = json.loads(spdx_file.read_text(encoding="utf-8"))
                package = spdx.get("packages", [{}])[0]
                declared = package.get("licenseConcluded")
                homepage = package.get("homepage") or ""
                version = package.get("versionInfo", version).split("#")[0] or version
            except (json.JSONDecodeError, IndexError, AttributeError):
                declared = None
        detected: list[str] = []
        if copyright_file.is_file():
            detected = detect_licence(copyright_file.read_text(encoding="utf-8", errors="replace"))
        if name in KNOWN_LICENCES and (not declared or declared.startswith("LicenseRef")):
            declared = KNOWN_LICENCES[name]
        licence, note = choose_licence(declared, detected)

        tooling = name in BUILD_ONLY_PORTS or name in test_only
        component = Component(
            group="tooling" if tooling else "native",
            name=name,
            version=version,
            licence=licence,
            text=f"{rel_installed}/<triplet>/share/{name}/copyright",
            note=note,
            distributed=not tooling,
            homepage=homepage,
        )
        if name in BUILD_ONLY_PORTS:
            component.note = BUILD_ONLY_PORTS[name]
        elif name in test_only:
            component.note = "test suite only (vcpkg feature \"tests\")"
        if copyright_file.is_file():
            component.text_paths.append(copyright_file)
        elif component.distributed:
            component.problems.append("copyright file missing in the installed tree")
        else:
            component.text = "(the port installs no copyright file on this platform)"
        # Cross-check: a copyleft text that the declaration does not mention is suspicious.
        if detected and declared and not declared.startswith("LicenseRef"):
            for identifier in detected:
                if ("GPL" in identifier and "GPL" not in declared and "tri-licence" not in note
                        and component.distributed):
                    component.problems.append(
                        f"copyright text mentions {identifier} but the port declares {declared}")
        if component.distributed and name not in runtime_direct:
            component.note = (component.note + "; " if component.note else "") + "transitive dependency"
        components.append(component)
    missing = runtime_direct - set(ports)
    for name in sorted(missing):
        problems.append(f"vcpkg.json dependency {name} is not installed under {installed}")
    return components


# --------------------------------------------------------------------------------------------
# npm


def collect_npm(problems: list[str]) -> list[Component]:
    lock_file = REPO / "ui" / "package-lock.json"
    package_file = REPO / "ui" / "package.json"
    if not lock_file.is_file() or not package_file.is_file():
        problems.append("ui/package.json or ui/package-lock.json missing")
        return []
    lock = json.loads(lock_file.read_text(encoding="utf-8"))
    packages: dict[str, dict] = lock.get("packages", {})
    root = json.loads(package_file.read_text(encoding="utf-8"))
    node_modules = REPO / "ui" / "node_modules"
    have_modules = node_modules.is_dir()

    def resolve(from_path: str, dep: str) -> str | None:
        """Node resolution inside the lock file: nearest node_modules/<dep> walking up."""
        base = from_path
        while True:
            candidate = f"{base}/node_modules/{dep}" if base else f"node_modules/{dep}"
            if candidate in packages:
                return candidate
            if not base:
                return None
            index = base.rfind("/node_modules/")
            base = base[:index] if index >= 0 else ""

    visited: dict[str, dict] = {}
    queue: list[tuple[str, str]] = [("", dep) for dep in sorted(root.get("dependencies", {}))]
    while queue:
        from_path, dep = queue.pop()
        resolved = resolve(from_path, dep)
        if resolved is None:
            problems.append(f"npm: {dep} (required by {from_path or 'ui/package.json'}) is not in package-lock.json")
            continue
        if resolved in visited:
            continue
        entry = packages[resolved]
        visited[resolved] = entry
        for child in sorted({**entry.get("dependencies", {}), **entry.get("optionalDependencies", {})}):
            queue.append((resolved, child))

    components: list[Component] = []
    for path_key, entry in sorted(visited.items()):
        name = path_key[path_key.rfind("node_modules/") + len("node_modules/"):]
        version = entry.get("version", "")
        declared = entry.get("license")
        if isinstance(declared, dict):
            declared = declared.get("type")
        if isinstance(declared, list):
            declared = " OR ".join(d.get("type", "") if isinstance(d, dict) else str(d) for d in declared)
        licence, note = choose_licence(declared, [])
        component = Component(
            group="npm",
            name=name,
            version=version,
            licence=licence,
            text=f"ui/node_modules/{name}/LICENSE",
            note=note,
            homepage=f"https://www.npmjs.com/package/{name}",
        )
        if have_modules:
            package_dir = node_modules / name
            installed_json = package_dir / "package.json"
            if installed_json.is_file():
                installed = json.loads(installed_json.read_text(encoding="utf-8"))
                installed_licence = installed.get("license")
                if isinstance(installed_licence, dict):
                    installed_licence = installed_licence.get("type")
                if installed_licence and declared and installed_licence != declared:
                    component.problems.append(
                        f"installed package declares {installed_licence}, lock file says {declared}")
                if installed.get("version") and installed["version"] != version:
                    component.problems.append(
                        f"installed version {installed['version']} differs from the lock file ({version})")
            else:
                component.problems.append("not installed under ui/node_modules (run npm ci)")
            texts = sorted(
                p for p in package_dir.glob("*") if p.is_file() and re.match(r"(?i)^(licen[cs]e|copying)", p.name)
            ) if package_dir.is_dir() else []
            if texts:
                component.text = f"ui/node_modules/{name}/{texts[0].name}"
                component.text_paths.append(texts[0])
            elif package_dir.is_dir():
                component.problems.append("no LICENSE file in the installed package")
        components.append(component)
    return components


# --------------------------------------------------------------------------------------------
# CEF / Chromium


def collect_cef(problems: list[str]) -> list[Component]:
    cmake = REPO / "cmake" / "CefVersion.cmake"
    if not cmake.is_file():
        problems.append("cmake/CefVersion.cmake missing")
        return []
    text = cmake.read_text(encoding="utf-8")
    cef = re.search(r'set\(MFBE_CEF_VERSION\s+"([^"]+)"\)', text)
    chromium = re.search(r'set\(MFBE_CEF_CHROMIUM_VERSION\s+"([^"]+)"\)', text)
    cef_version = cef.group(1) if cef else "unknown"
    chromium_version = chromium.group(1) if chromium else "unknown"

    distributions = sorted((REPO / "third_party" / "downloads").glob("cef_binary_*/")) if (
        REPO / "third_party" / "downloads").is_dir() else []
    distributions = [d for d in distributions if d.is_dir()]
    licence_text = "third_party/downloads/cef_binary_<version>_<platform>_minimal/LICENSE.txt"
    credits_text = "third_party/downloads/cef_binary_<version>_<platform>_minimal/CREDITS.html"
    cef_component = Component(
        group="engine",
        name="Chromium Embedded Framework (CEF)",
        version=cef_version,
        licence="BSD-3-Clause",
        text=licence_text,
        homepage="https://github.com/chromiumembedded/cef",
        note="shared libraries, resources and locale packs installed next to the shell executable",
    )
    chromium_component = Component(
        group="engine",
        name="Chromium (inside libcef)",
        version=chromium_version,
        licence="BSD-3-Clause",
        text=credits_text,
        homepage="https://www.chromium.org/",
        note="the Chromium third-party components keep their own licences (permissive, LGPL and "
             "MPL; GPL texts only as alternatives of multi-licensed components), listed in CREDITS.html",
    )
    for distribution in distributions:
        licence_file = distribution / "LICENSE.txt"
        credits_file = distribution / "CREDITS.html"
        if licence_file.is_file():
            detected = detect_licence(licence_file.read_text(encoding="utf-8", errors="replace"))
            if "BSD-3-Clause" not in detected:
                cef_component.problems.append(f"{licence_file.relative_to(REPO)} is not the expected BSD-3-Clause text")
            cef_component.text_paths.append(licence_file)
        else:
            cef_component.problems.append(f"{distribution.relative_to(REPO)}/LICENSE.txt missing")
        if credits_file.is_file():
            chromium_component.text_paths.append(credits_file)
        else:
            chromium_component.problems.append(f"{distribution.relative_to(REPO)}/CREDITS.html missing")
    if not distributions:
        print("licence-check: no CEF distribution under third_party/downloads - its LICENSE.txt is "
              "verified where the application is built")
    return [cef_component, chromium_component]


# --------------------------------------------------------------------------------------------
# Bundled data


def read_commit(path: Path, pattern: str) -> str:
    if not path.is_file():
        return "unknown"
    match = re.search(pattern, path.read_text(encoding="utf-8", errors="replace"))
    return match.group(1)[:12] if match else "unknown"


def collect_data(problems: list[str]) -> list[Component]:
    readme = REPO / "resources" / "README.md"
    if not readme.is_file():
        problems.append("resources/README.md missing")
        return []
    rows: list[tuple[str, str]] = []  # (path cell, licence cell)
    for line in readme.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("Path", "---") or set(cells[0]) <= {"-"}:
            continue
        rows.append((cells[0], cells[2]))
    if not rows:
        problems.append("resources/README.md: no table rows found")

    schema_commit = read_commit(REPO / "resources" / "schema" / "SOURCE.txt", r"Git commit\s*:\s*([0-9a-f]{7,40})")
    dict_commit = read_commit(REPO / "resources" / "dictionaries" / "SOURCES.txt", r"Commit\s*:\s*([0-9a-f]{7,40})")
    en_version = read_commit(REPO / "resources" / "dictionaries" / "SOURCES.txt", r"version\s+(\d{4}\.\d{2}\.\d{2})")
    uk_release = read_commit(REPO / "resources" / "dictionaries" / "SOURCES.txt", r"Release\s*:\s*(v\d+(?:\.\d+)+)")

    def component(name: str, version: str, licence: str, text: Path | None, note: str,
                  group: str = "data") -> Component:
        rel = text.relative_to(REPO).as_posix() if text else "LICENSE"
        c = Component(group=group, name=name, version=version, licence=licence, text=rel, note=note)
        if text is not None:
            if text.is_file():
                c.text_paths.append(text)
            else:
                c.problems.append(f"licence text {rel} missing")
        return c

    schema = component(
        "FictionBook 2.1 XML schema (FictionBook.xsd and companions)",
        f"fb2 repository commit {schema_commit}",
        "BSD-2-Clause",
        REPO / "resources" / "schema" / "LICENSE.md",
        "installed as share/mfbe/resources/schema/LICENSE.md; the same text heads FictionBook.xsd",
    )
    en_us = component(
        "Hunspell dictionary en_US (SCOWL-derived)",
        f"{en_version}; LibreOffice dictionaries commit {dict_commit}",
        "SCOWL AND BSD-style AND public-domain",
        REPO / "resources" / "dictionaries" / "en_US.txt",
        "installed as share/mfbe/resources/dictionaries/en_US.txt (SCOWL permissive licence plus "
        "the Ispell BSD-style, WordNet and public-domain parts it incorporates)",
    )
    ru_ru = component(
        "Hunspell dictionary ru_RU",
        f"LibreOffice dictionaries commit {dict_commit}",
        "BSD-style",
        REPO / "resources" / "dictionaries" / "ru_RU.txt",
        "installed as share/mfbe/resources/dictionaries/ru_RU.txt",
    )
    uk_ua = component(
        "Hunspell dictionary uk_UA (dict_uk)",
        f"dict_uk release {uk_release}",
        "MPL-1.1",
        REPO / "resources" / "dictionaries" / "uk_UA.txt",
        "uk_UA.aff and uk_UA.dic are read at run time by Hunspell and not combined into the "
        "program (aggregate, GPLv3 section 5; decision D16); the upstream generator notice also "
        "names GPL-3.0-or-later and LGPL-2.1-or-later; notice installed as "
        "share/mfbe/resources/dictionaries/uk_UA.txt and shown in About",
        group="aggregate",
    )
    fbe = component(
        "Material derived from the original FictionBook Editor 2.7 (genre lists, symbols, blank "
        "template, icons) and the converted bundled scripts",
        "FBE 2.7",
        "GPL-3.0-only",
        REPO / "LICENSE",
        "the original editor's licence and the project's; its copyright notices and contributor "
        "list are in CONTRIBUTORS.txt, the scripts keep their authors' notices; installed as "
        "share/doc/mfbe/LICENSE and CONTRIBUTORS.txt",
    )
    contributors = REPO / "CONTRIBUTORS.txt"
    if contributors.is_file():
        fbe.text_paths.append(contributors)
    else:
        fbe.problems.append("CONTRIBUTORS.txt missing")
    components = [schema, en_us, ru_ru, uk_ua, fbe]

    # Every README row with a licence must be covered by one of the components above.
    covered = {
        "BSD 2-clause": schema, "SCOWL": en_us, "BSD-style": ru_ru, "MPL": uk_ua,
        "GPL-3.0-only (original editor)": fbe, "project licence": fbe,
    }
    for path_cell, licence_cell in rows:
        if licence_cell in ("-", ""):
            continue
        if not any(key in licence_cell for key in covered):
            problems.append(f"resources/README.md: unclassified licence '{licence_cell}' for {path_cell}")
    return components


# --------------------------------------------------------------------------------------------
# Notices document


def notice_table(components: list[Component], columns: list[str]) -> list[str]:
    lines = ["| " + " | ".join(columns) + " |", "|" + "|".join("---" for _ in columns) + "|"]
    for c in components:
        cells = {
            "Component": c.name,
            "Version": c.version,
            "Licence": c.licence,
            "Full text": f"`{c.text}`" if not c.text.startswith("(") else c.text,
            "Notes": c.note,
        }
        lines.append("| " + " | ".join(cells[col].replace("|", "\\|") for col in columns) + " |")
    return lines


def render(components: list[Component], vcpkg_available: bool) -> str:
    by_group: dict[str, list[Component]] = {}
    for c in components:
        by_group.setdefault(c.group, []).append(c)
    for group in by_group.values():
        group.sort(key=lambda c: c.name.lower())

    counts: dict[str, int] = {}
    for c in components:
        if c.distributed:
            counts[c.licence] = counts.get(c.licence, 0) + 1

    out: list[str] = []
    out.append("# Third-party notices")
    out.append("")
    out.append("Generated by `tools/licence-check.py` - do not edit by hand. Maxima Fiction Book Editor")
    out.append("is distributed under the GNU General Public License version 3 only (`LICENSE`), the")
    out.append("licence of FictionBook Editor 2.7, whose material it includes; the original's copyright")
    out.append("notices and contributor list are in `CONTRIBUTORS.txt`. The components below ship with")
    out.append("the editor or are embedded in its binaries; each keeps its own licence, and every one of")
    out.append("them may be distributed as part of a GPL-3.0 work (project policy: licences that may not,")
    out.append("and unknown licences, fail the check; a multi-licensed component is listed under a")
    out.append("compatible option) - except the aggregated data files of their own section: data the")
    out.append("editor only reads at run time and never combines into the program (GPLv3 section 5),")
    out.append("which needs a licence that allows free redistribution with its notice. This file names")
    out.append("components, versions and licence identifiers; the")
    out.append("complete licence texts, including the copyright notices they require, are the files")
    out.append("listed in the \"Full text\" column, exported with")
    out.append("`python3 tools/licence-check.py --export-texts <dir>` and installed with the packages")
    out.append("under `share/doc/mfbe/licenses/`.")
    out.append("Upstream locations are recorded in the vcpkg port metadata (`vcpkg.spdx.json` next to")
    out.append("each copyright file) and in the npm registry; they are not repeated here.")
    out.append("")
    out.append("## Native libraries (vcpkg, statically linked into `mfbe-core` and `mfbe`)")
    out.append("")
    if by_group.get("native"):
        out.extend(notice_table(by_group["native"], ["Component", "Version", "Licence", "Full text", "Notes"]))
    else:
        out.append("(no installed vcpkg tree was available when this file was generated)")
    out.append("")
    out.append("Paths of the licence texts are those of the vcpkg installed tree of a build; the version")
    out.append("set is pinned by `builtin-baseline` in `vcpkg.json`, so every platform builds the same")
    out.append("versions. The Hunspell tri-licence is used under its LGPL-2.1-or-later option. libxml2 is built")
    out.append("without its iconv feature (the editor carries its own encoding tables), so GNU libiconv is")
    out.append("never linked.")
    out.append("")
    out.append("## Embedded browser engine")
    out.append("")
    out.extend(notice_table(by_group.get("engine", []), ["Component", "Version", "Licence", "Full text", "Notes"]))
    out.append("")
    out.append("## User interface packages (npm, production dependency closure bundled into `ui/dist`)")
    out.append("")
    out.extend(notice_table(by_group.get("npm", []), ["Component", "Version", "Licence", "Full text"]))
    out.append("")
    out.append("Development-only packages (bundler, test runners, linters, type definitions) are not")
    out.append("distributed and are therefore not listed.")
    out.append("")
    out.append("## Bundled data")
    out.append("")
    out.extend(notice_table(by_group.get("data", []), ["Component", "Version", "Licence", "Full text", "Notes"]))
    out.append("")
    out.append("## Aggregated data files")
    out.append("")
    out.extend(notice_table(by_group.get("aggregate", []), ["Component", "Version", "Licence", "Full text", "Notes"]))
    out.append("")
    out.append("Data files the editor's libraries read at run time and that are never combined into the")
    out.append("program: aggregates in the sense of GPLv3 section 5 (constitution principle VI, decision")
    out.append("D16). Their licences need not be GPL-3.0-compatible; they must allow free redistribution")
    out.append("with the notice that ships next to each file (MPL-1.1 qualifies; licences forbidding")
    out.append("redistribution or commercial use do not). The notice is installed with the file and shown")
    out.append("in Help > About like the other dictionaries' notices.")
    out.append("")
    out.append("## Build and test tooling (not distributed)")
    out.append("")
    if by_group.get("tooling"):
        out.extend(notice_table(by_group["tooling"], ["Component", "Version", "Licence", "Full text", "Notes"]))
    else:
        out.append("(no installed vcpkg tree was available when this file was generated)")
    out.append("")
    out.append("## Licences in the distributed product")
    out.append("")
    out.append("| Licence | Components |")
    out.append("|---|---|")
    for licence in sorted(counts, key=lambda k: (-counts[k], k)):
        out.append(f"| {licence} | {counts[licence]} |")
    out.append("")
    if not vcpkg_available:
        out.append("(native library rows could not be regenerated: no vcpkg installed tree)")
        out.append("")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------------------------
# --check without an installed tree: validate the committed native rows


def parse_native_rows(notices_text: str) -> list[tuple[str, str, str, bool]]:
    """(component, version, licence, distributed) of the native and tooling tables of a notices
    file; tooling rows are the "not distributed" ones."""
    rows: list[tuple[str, str, str, bool]] = []
    section = None
    for line in notices_text.splitlines():
        if line.startswith("## "):
            section = line
            continue
        if section and ("Native libraries" in section or "Build and test tooling" in section) and line.startswith("| "):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 3 and cells[0] not in ("Component",):
                rows.append((cells[0], cells[1], cells[2], "Native libraries" in section))
    return rows


def check_committed_native_rows(problems: list[str]) -> None:
    if not NOTICES.is_file():
        problems.append("THIRD-PARTY-NOTICES.md is missing (run tools/licence-check.py on a machine with a build)")
        return
    runtime_direct, _ = manifest_dependencies()
    rows = parse_native_rows(NOTICES.read_text(encoding="utf-8"))
    listed = {name for name, _, _, distributed in rows if distributed}
    for name in sorted(runtime_direct - listed):
        problems.append(f"THIRD-PARTY-NOTICES.md has no row for vcpkg.json dependency {name}")
    for name, _, licence, distributed in rows:
        fake = Component(group="native" if distributed else "tooling", name=name, version="",
                         licence=licence, text="", distributed=distributed)
        for problem in policy_problems(fake):
            problems.append(f"THIRD-PARTY-NOTICES.md: {name}: {problem}")


# --------------------------------------------------------------------------------------------
# The project's own licence statements


def check_project_licence(problems: list[str]) -> None:
    """LICENSE is the GPL-3.0 text, the original's notices ship next to it, and every licence
    statement of the editor (package metadata, About dialog, documentation) names GPL-3.0."""
    licence = REPO / "LICENSE"
    # Line ends aside: a Windows checkout gives the file CRLF.
    text = licence.read_bytes().replace(b"\r\n", b"\n") if licence.is_file() else b""
    if hashlib.sha256(text).hexdigest() != GPL3_TEXT_SHA256:
        problems.append("LICENSE is not the FSF text of the GNU General Public License version 3")
    for name in NOTICE_FILES:
        if not (REPO / name).is_file():
            problems.append(f"{name} is missing")

    package = json.loads((REPO / "ui" / "package.json").read_text(encoding="utf-8"))
    if package.get("license") != PROJECT_LICENCE:
        problems.append(f"ui/package.json: license is not {PROJECT_LICENCE}")
    lock = json.loads((REPO / "ui" / "package-lock.json").read_text(encoding="utf-8"))
    if lock.get("packages", {}).get("", {}).get("license") != PROJECT_LICENCE:
        problems.append(f"ui/package-lock.json: the root package's license is not {PROJECT_LICENCE}")
    for relative, needle in (
        ("packaging/CPackConfig.cmake", f'CPACK_RPM_PACKAGE_LICENSE "{PROJECT_LICENCE}"'),
        ("packaging/appimage/mfbe.appdata.xml", f"<project_license>{PROJECT_LICENCE}</project_license>"),
    ):
        if needle not in (REPO / relative).read_text(encoding="utf-8"):
            problems.append(f"{relative}: the editor's licence is not given as {PROJECT_LICENCE}")
    for lang in ("en", "ru"):
        about = json.loads((REPO / "ui" / "src" / "i18n" / f"about.{lang}.json").read_text(encoding="utf-8"))
        if PROJECT_LICENCE not in about.get("dialog", {}).get("about", {}).get("licence", ""):
            problems.append(f"ui/src/i18n/about.{lang}.json: the About dialog does not name {PROJECT_LICENCE}")

    statements = [REPO / "README.md", REPO / "AGENTS.md"]  # CHANGELOG.md is history
    statements += sorted((REPO / "docs").rglob("*.md"))
    statements += sorted(p for p in (REPO / "packaging").rglob("*") if p.is_file())
    statements += sorted((REPO / "ui" / "src" / "i18n").glob("*.json"))
    for path in statements:
        if not path.is_file():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if "metadata_license" in line:
                continue
            if MIT_STATEMENT_RE.search(line):
                problems.append(f"{path.relative_to(REPO).as_posix()}:{number}: names MIT as a licence "
                                f"(the editor is {PROJECT_LICENCE}): {line.strip()[:90]}")


# --------------------------------------------------------------------------------------------


def export_texts(components: list[Component], target: Path) -> int:
    target.mkdir(parents=True, exist_ok=True)
    count = 0
    for c in components:
        if not c.distributed and c.group != "data":
            continue
        for index, source in enumerate(c.text_paths):
            stem = re.sub(r"[^A-Za-z0-9._-]+", "-", c.name.split("(")[0].strip()).strip("-") or "component"
            suffix = source.suffix if source.suffix in (".html", ".md") else ".txt"
            name = f"{stem}{'' if index == 0 else f'-{index + 1}'}{suffix}"
            shutil.copyfile(source, target / name)
            count += 1
    return count


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="verify only; fail when the notices are stale")
    parser.add_argument("--vcpkg-installed", help="vcpkg installed tree (default build/vcpkg_installed)")
    parser.add_argument("--vcpkg-triplet", help="target triplet of the installed tree (default: the "
                        "triplet of the editor's direct dependencies)")
    parser.add_argument("--export-texts", metavar="DIR", help="copy the licence texts into DIR")
    parser.add_argument("--json", action="store_true", help="print the inventory as JSON")
    parser.add_argument("--output", default=str(NOTICES), help="notices file to write/compare")
    args = parser.parse_args(argv)

    problems: list[str] = []
    installed = find_vcpkg_installed(args.vcpkg_installed)
    components: list[Component] = []
    components += collect_vcpkg(installed, args.vcpkg_triplet or None, problems)
    components += collect_cef(problems)
    components += collect_npm(problems)
    components += collect_data(problems)

    check_project_licence(problems)
    for c in components:
        c.problems.extend(policy_problems(c))
        for problem in c.problems:
            problems.append(f"{c.name} {c.version}: {problem}")
        if c.distributed and c.licence in ALLOWED and ALLOWED[c.licence] and not c.note:
            c.note = ALLOWED[c.licence]

    output = Path(args.output)
    if args.json:
        print(json.dumps([c.__dict__ | {"text_paths": [str(p) for p in c.text_paths]} for c in components],
                         indent=2, ensure_ascii=False, default=str))

    vcpkg_available = installed is not None and any(c.group == "native" for c in components)
    rendered = render(components, vcpkg_available)

    if args.check:
        if not vcpkg_available:
            print("licence-check: no vcpkg installed tree - native library rows of the committed notices are "
                  "checked against vcpkg.json and the policy only (versions and copyright files are verified "
                  "where the core is built)")
            check_committed_native_rows(problems)
            if output.is_file():
                committed = output.read_text(encoding="utf-8")
                # Compare everything except the native/tooling tables, which need the installed tree.
                def strip_native(text: str) -> str:
                    kept: list[str] = []
                    skip = False
                    for line in text.splitlines():
                        if line.startswith("## "):
                            skip = "Native libraries" in line or "Build and test tooling" in line or "Licences in the distributed product" in line
                        if not skip and not line.startswith("(native library rows could not"):
                            # Without node_modules the exact LICENSE file name is unknown.
                            kept.append(re.sub(r"/(?i:licen[cs]e|copying)[^`|]*`", "/LICENSE`", line))
                    return "\n".join(kept)
                if strip_native(committed) != strip_native(rendered):
                    problems.append(f"{output.relative_to(REPO)} is out of date (npm, engine or data sections differ); "
                                    "run tools/licence-check.py and commit the result")
            else:
                problems.append(f"{output} is missing")
        else:
            if not output.is_file() or output.read_text(encoding="utf-8") != rendered:
                problems.append(f"{output.relative_to(REPO) if output.is_relative_to(REPO) else output} is out of date; "
                                "run tools/licence-check.py and commit the result")
    elif args.export_texts:
        pass  # export-only run (the packaging build): the committed notices are left alone
    else:
        if not vcpkg_available:
            problems.append("cannot regenerate the notices without a vcpkg installed tree (build the core first "
                            "or pass --vcpkg-installed)")
        elif not problems:
            output.write_text(rendered, encoding="utf-8")
            print(f"wrote {output.relative_to(REPO) if output.is_relative_to(REPO) else output}")

    if args.export_texts and not problems:
        count = export_texts(components, Path(args.export_texts))
        print(f"exported {count} licence texts to {args.export_texts}")

    distributed = [c for c in components if c.distributed]
    counts: dict[str, int] = {}
    for c in distributed:
        counts[c.licence] = counts.get(c.licence, 0) + 1
    summary = ", ".join(f"{licence}: {n}" for licence, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
    print(f"licence-check: {len(distributed)} distributed components ({summary}); "
          f"{len(components) - len(distributed)} build/test-only")
    if problems:
        for problem in problems:
            print(f"licence-check: ERROR: {problem}", file=sys.stderr)
        return 1
    print("licence-check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
