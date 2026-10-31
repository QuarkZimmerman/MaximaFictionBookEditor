#!/usr/bin/env python3
"""The short list of changes of each release (feature 007, FR-075; constitution "Quality gates
per change", per release): every version's section of CHANGELOG.md starts with `### In short`,
one line per major change for users, naming the area changed or fixed, with no details. The
Release workflow puts the list at the top of the release text; the lint job checks the form.
One parser for both.

Usage::

    python3 tools/changelog-in-short.py 0.0.6        # print that version's items ("- ..." lines)
    python3 tools/changelog-in-short.py 0.0.6-rc.2   # the same: a pre-release reads X.Y.Z's list
    python3 tools/changelog-in-short.py --check      # every section has a list in form
    python3 tools/changelog-in-short.py --self-test

The form: `## X.Y.Z - ...` is followed, before anything else, by `### In short` and 1 to 8
items; each item is one line `- <text>` whose text is at most 100 characters, a short phrase
with no links and no code (no `[...](...)`, no URL, no backticks).

Exit codes: 0 ok, 1 a section out of form (or no such version), 2 usage errors.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CHANGELOG = Path(__file__).resolve().parents[1] / "CHANGELOG.md"
SECTION = re.compile(r"^## (\d+\.\d+\.\d+) - .+$")
MAX_ITEMS = 8
MAX_LENGTH = 100


def sections(text: str) -> list[tuple[str, int, list[str]]]:
    """(version, line number of the heading, the lines of the section)."""
    out: list[tuple[str, int, list[str]]] = []
    lines = text.splitlines()
    starts = [(i, m.group(1)) for i, line in enumerate(lines) if (m := SECTION.match(line))]
    for n, (start, version) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        out.append((version, start + 1, lines[start + 1 : end]))
    return out


def in_short(body: list[str]) -> tuple[list[str], list[str]]:
    """The items of a section's list, and the problems of its form."""
    problems: list[str] = []
    rest = [line for line in body]
    while rest and not rest[0].strip():
        rest.pop(0)
    if not rest or rest[0].strip() != "### In short":
        return [], ["does not start with '### In short'"]
    rest.pop(0)
    while rest and not rest[0].strip():
        rest.pop(0)
    items: list[str] = []
    while rest and rest[0].startswith("- "):
        items.append(rest.pop(0)[2:].strip())
    if rest and rest[0].strip() and not rest[0].startswith("#"):
        problems.append(f"the list is followed by '{rest[0].strip()[:40]}' - one line per item")
    if not 1 <= len(items) <= MAX_ITEMS:
        problems.append(f"{len(items)} items (1 to {MAX_ITEMS})")
    for item in items:
        if len(item) > MAX_LENGTH:
            problems.append(f"item longer than {MAX_LENGTH} characters: '{item[:50]}...'")
        if "`" in item or re.search(r"\]\(|https?://|www\.", item):
            problems.append(f"item with a link or code: '{item[:50]}'")
    return items, problems


def items_of(text: str, version: str) -> list[str] | None:
    plain = re.sub(r"-.*$", "", version.lstrip("v"))
    for name, _line, body in sections(text):
        if name == plain:
            return in_short(body)[0]
    return None


def check(text: str) -> list[str]:
    problems: list[str] = []
    found = sections(text)
    if not found:
        return ["no '## X.Y.Z - ...' section"]
    for version, line, body in found:
        for problem in in_short(body)[1]:
            problems.append(f"CHANGELOG.md:{line}: {version}: {problem}")
    return problems


def self_test() -> int:
    good = """# Changelog

## 0.0.2 - unreleased

### In short

- Ctrl+S saves the book
- Pictures at their natural size

### Added

- Details...

## 0.0.1 - first public build

### In short
- The first build
"""
    failures: list[str] = []
    if check(good):
        failures.append(f"a good changelog fails: {check(good)}")
    if items_of(good, "0.0.2") != ["Ctrl+S saves the book", "Pictures at their natural size"]:
        failures.append("items of 0.0.2")
    if items_of(good, "v0.0.2-rc.3") != items_of(good, "0.0.2"):
        failures.append("a pre-release tag reads X.Y.Z's list")
    if items_of(good, "0.0.9") is not None:
        failures.append("an unknown version has no list")
    bad = {
        "missing": "## 0.0.1 - x\n\n### Added\n\n- a\n",
        "empty": "## 0.0.1 - x\n\n### In short\n\n### Added\n",
        "nine": "## 0.0.1 - x\n\n### In short\n\n" + "".join(f"- item {i}\n" for i in range(9)),
        "long": "## 0.0.1 - x\n\n### In short\n\n- " + "x" * 101 + "\n",
        "code": "## 0.0.1 - x\n\n### In short\n\n- `scripts.run` added\n",
        "link": "## 0.0.1 - x\n\n### In short\n\n- See [the notes](docs/x.md)\n",
        "two lines": "## 0.0.1 - x\n\n### In short\n\n- an item\n  that goes on\n",
    }
    for name, text in bad.items():
        if not check(text):
            failures.append(f"'{name}' passes the check")
    for failure in failures:
        print(f"changelog-in-short: self-test FAILED: {failure}", file=sys.stderr)
    if failures:
        return 1
    print("changelog-in-short: self-test OK")
    return 0


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    if not CHANGELOG.is_file():
        print(f"changelog-in-short: {CHANGELOG} not found", file=sys.stderr)
        return 2
    text = CHANGELOG.read_text(encoding="utf-8")
    if argv == ["--check"]:
        problems = check(text)
        for problem in problems:
            print(f"changelog-in-short: {problem}", file=sys.stderr)
        if problems:
            return 1
        print(f"changelog-in-short: OK ({len(sections(text))} versions with their short list)")
        return 0
    if len(argv) == 1 and not argv[0].startswith("-"):
        items = items_of(text, argv[0])
        if not items:
            print(f"changelog-in-short: no '### In short' list for {argv[0]}", file=sys.stderr)
            return 1
        for item in items:
            print(f"- {item}")
        return 0
    print(__doc__.split("Usage::")[1].split("The form:")[0].rstrip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
