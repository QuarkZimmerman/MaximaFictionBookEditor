#!/usr/bin/env python3
"""Checks that every bundled script keeps the notices of the original script it was converted
from (feature 002, FR-097: GPL-3.0 sections 4 and 5 - copyright and author notices stay intact).

The expected notices are recorded in ``tests/scripts/notices.json``, generated from the
original FictionBook Editor 2.7 scripts (``--update``; needs the reference checkout, default
``~/maxfbeditor/reference/fictionbookeditor/FBE/files``):

* ``header`` - the content lines of the original's leading comment block when that block carries
  a notice (author, copyright, "Engine by", version or date lines): each must appear in a source
  file of the package (comment markers and decoration lines are ignored when comparing);
* ``shown`` - the author/copyright parts of the texts the original showed the user (for example
  "Автор Sclex." in a message): each must appear in a source file of the package.

Usage::

    python3 tests/scripts/tools/check-notices.py            # CI: verify the packages
    python3 tests/scripts/tools/check-notices.py --update   # regenerate notices.json

Exit codes: 0 ok, 1 missing notices or a package/original that cannot be matched.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = REPO / "scripts"
NOTICES = REPO / "tests" / "scripts" / "notices.json"
DEFAULT_ORIGINALS = Path.home() / "maxfbeditor" / "reference" / "fictionbookeditor" / "FBE" / "files"

# A credit followed by a name: "Автор Sclex.", "Автор скрипта: Sclex", "Engine by ©Sclex",
# "modified by mkb" - not the FB2 element "text-author" or a word list's "автор — это".
NOTICE_RE = re.compile(
    r"©\s*[A-Za-zА-Яа-яЁё]|\(c\)\s*[A-Za-z]|copyright|автор(?:\s+скрипта)?\s*:?\s+[A-Za-z]"
    r"|(?<!text-)author\s*:?\s+[A-Za-z]|engine by|modified by|changed by|thx to|скрипт\s+\w+[’']а",
    re.IGNORECASE)
HEADER_HINT_RE = re.compile(r"©|\(c\)|copyright|автор|author|engine by|\bv\.?\s?\d|верси", re.IGNORECASE)
DECORATION_RE = re.compile(r"^[\s=~*_\-–—#/.]*$")
STRING_RE = re.compile(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'')


def read_original(path: Path) -> str:
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1251")


def normalise(line: str) -> str:
    """Comment line content without comment markers and surrounding spaces."""
    text = line.strip()
    text = re.sub(r"^(?://+|/\*+|\*+)", "", text)
    text = re.sub(r"\*+/$", "", text)
    return text.strip()


def header_notice(text: str) -> list[str]:
    """Content lines of the leading comment block when it carries a notice."""
    lines: list[str] = []
    in_block = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if in_block:
            lines.append(raw)
            if "*/" in stripped:
                in_block = False
            continue
        if not stripped:
            continue
        if stripped.startswith("//"):
            lines.append(raw)
            continue
        if stripped.startswith("/*"):
            lines.append(raw)
            in_block = "*/" not in stripped[2:]
            continue
        break
    if not any(HEADER_HINT_RE.search(line) for line in lines):
        return []
    content = [normalise(line) for line in lines]
    return [c for c in content if c and not DECORATION_RE.match(c)]


def shown_notices(text: str) -> list[str]:
    """Author/copyright parts of the string literals of the original (outside comments)."""
    code = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    code = "\n".join(re.sub(r"(^|[^:\\])//.*$", r"\1", line) for line in code.splitlines())
    found: list[str] = []
    for match in STRING_RE.finditer(code):
        literal = match.group(1) if match.group(1) is not None else match.group(2)
        for part in re.split(r"\\n|\\r", literal):
            part = part.replace('\\"', '"').replace("\\'", "'").strip()
            if part and NOTICE_RE.search(part) and part not in found:
                found.append(part)
    return found


def original_path(originals: Path, source: str) -> Path:
    return originals / source if source.startswith("TreeCmd/") else originals / "Scripts" / source


def package_text(package: Path) -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted(package.rglob("*.js")))


def update(originals: Path) -> int:
    problems: list[str] = []
    packages: dict[str, dict] = {}
    for manifest in sorted(SCRIPTS.rglob("script.json")):
        data = json.loads(manifest.read_text(encoding="utf-8"))
        source = (data.get("legacy") or {}).get("source")
        if not source:
            continue
        path = original_path(originals, source)
        if not path.is_file():
            problems.append(f"{manifest.parent.relative_to(REPO)}: original {source} not found")
            continue
        text = read_original(path)
        header = header_notice(text)
        shown = shown_notices(text)
        if header or shown:
            packages[manifest.parent.relative_to(REPO).as_posix()] = {
                "original": source, "header": header, "shown": shown}
    if problems:
        for problem in problems:
            print(f"check-notices: ERROR: {problem}", file=sys.stderr)
        return 1
    document = {
        "$comment": "Notices of the original scripts that the converted packages must keep "
                    "(GPL-3.0 sections 4 and 5). Generated by tests/scripts/tools/check-notices.py "
                    "--update from the original FictionBook Editor 2.7 scripts - do not edit by hand.",
        "packages": packages,
    }
    NOTICES.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"check-notices: wrote {NOTICES.relative_to(REPO)} ({len(packages)} packages with notices)")
    return 0


def check() -> int:
    if not NOTICES.is_file():
        print(f"check-notices: ERROR: {NOTICES.relative_to(REPO)} missing (run with --update)",
              file=sys.stderr)
        return 1
    expected = json.loads(NOTICES.read_text(encoding="utf-8"))["packages"]
    problems: list[str] = []
    for name, entry in expected.items():
        package = REPO / name
        if not package.is_dir():
            problems.append(f"{name}: package missing")
            continue
        text = package_text(package)
        content = {normalise(line) for line in text.splitlines()}
        for line in entry["header"]:
            if line not in content:
                problems.append(f"{name}: header notice line missing: {line}")
        for part in entry["shown"]:
            if part not in text:
                problems.append(f"{name}: shown notice missing: {part}")
    for problem in problems:
        print(f"check-notices: ERROR: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"check-notices: OK ({len(expected)} packages keep their original notices)")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--update", action="store_true", help="regenerate notices.json")
    parser.add_argument("--originals", type=Path, default=DEFAULT_ORIGINALS,
                        help="FBE/files folder of the original editor")
    args = parser.parse_args(argv)
    return update(args.originals) if args.update else check()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
