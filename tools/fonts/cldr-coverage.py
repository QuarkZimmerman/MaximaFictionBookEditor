#!/usr/bin/env python3
"""Feature 014 (SC-018, research R5; tasks T031): the characters every language written in Latin,
Cyrillic, Greek, Georgian or Armenian needs, from Unicode's CLDR at a pinned release.

Reads CLDR's JSON packages from the npm registry (cldr-misc-full: each locale's exemplar
characters; cldr-core: the likely script of each language), checks their published sha512, and
writes tests/core/data/cldr-exemplars.json: for each locale, its script and every code point of its
main, auxiliary, punctuation and digit sets, with CLDR's licence beside it (cldr-LICENSE.txt).
tests/core/test_pdf_font_coverage.cpp checks the shipped fonts against that table. CLDR is test
data only; nothing of it ships.

    python3 tools/fonts/cldr-coverage.py
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import pathlib
import tarfile
import urllib.request

CLDR = "49.0.0"
# The packages' published integrity at that version (npm view <name>@49.0.0 dist.integrity).
PACKAGES = {
    "cldr-misc-full": "sha512-1B1O3pe4v0pbNEZdWbkBLtM3Lue7G9KN9LwV+yoAsFttk81DyQ7nCL6knddyBaSgKpF4+f0C4NHcZPwA6uoEwA==",
    "cldr-core": "sha512-2Z2dYeDO95AbKIG9dIUdZy6DD4f0hhHjTYnaHZj/9JTQ82pX5EsJlCs2BXPWi4vd1d98MwotOivh4Uthxwri4A==",
}
SCRIPTS = {"Latn", "Cyrl", "Grek", "Geor", "Armn"}
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "core" / "data" / "cldr-exemplars.json"
# The Unicode licence asks for its notice with every copy of the data: the package's own LICENSE.
LICENCE = ROOT / "tests" / "core" / "data" / "cldr-LICENSE.txt"


def fetch(name: str) -> tarfile.TarFile:
    url = f"https://registry.npmjs.org/{name}/-/{name}-{CLDR}.tgz"
    data = urllib.request.urlopen(url, timeout=300).read()
    digest = PACKAGES[name].split("-", 1)[1]
    if base64.b64decode(digest) != hashlib.sha512(data).digest():
        raise SystemExit(f"{name}@{CLDR}: the download does not match its pinned {PACKAGES[name]}")
    return tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")


def unicode_set(text: str) -> set[str]:
    """The code points of a CLDR exemplar UnicodeSet such as "[a-z ä {ch} \\u0301]"."""
    body = text.strip()
    if body.startswith("[") and body.endswith("]"):
        body = body[1:-1]
    points: set[str] = set()
    i = 0

    def char_at(j: int) -> tuple[str, int]:
        if body[j] == "\\":
            if body[j + 1] == "u":
                return chr(int(body[j + 2:j + 6], 16)), j + 6
            if body[j + 1] == "U":
                return chr(int(body[j + 2:j + 10], 16)), j + 10
            if body[j + 1] == "x" and body[j + 2] == "{":
                end = body.index("}", j)
                return chr(int(body[j + 3:end], 16)), end + 1
            return body[j + 1], j + 2
        return body[j], j + 1

    while i < len(body):
        c = body[i]
        if c.isspace():
            i += 1
            continue
        if c == "{":
            end = body.index("}", i)
            j = i + 1
            while j < end:
                ch, j = char_at(j)
                points.add(ch)
            i = end + 1
            continue
        first, i = char_at(i)
        if i < len(body) and body[i] == "-" and i + 1 < len(body) and not body[i + 1].isspace():
            last, i = char_at(i + 1)
            points.update(chr(p) for p in range(ord(first), ord(last) + 1))
        else:
            points.add(first)
    return {p for p in points if not p.isspace()}


def main() -> None:
    misc = fetch("cldr-misc-full")
    core = fetch("cldr-core")
    licence = misc.extractfile("package/LICENSE")
    if licence is None:
        raise SystemExit("cldr-misc-full has no LICENSE")
    likely = json.load(core.extractfile("package/supplemental/likelySubtags.json"))["supplemental"][
        "likelySubtags"]
    languages: dict[str, dict[str, str]] = {}
    for member in sorted(misc.getmembers(), key=lambda m: m.name):
        parts = member.name.split("/")
        if len(parts) != 4 or parts[1] != "main" or parts[3] != "characters.json":
            continue
        locale = parts[2]
        subtags = locale.split("-")
        script = next((s for s in subtags[1:] if len(s) == 4), None)
        if script is None:
            script = likely.get(subtags[0], "").split("-")[1] if "-" in likely.get(subtags[0], "") else None
        if script not in SCRIPTS:
            continue
        data = json.load(misc.extractfile(member))["main"][locale]["characters"]
        points: set[str] = set()
        for key in ("exemplarCharacters", "auxiliary", "punctuation", "numbers"):
            if key in data:
                points |= unicode_set(data[key])
        languages[locale] = {"script": script, "chars": "".join(sorted(points))}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    LICENCE.write_bytes(licence.read())
    OUT.write_text(json.dumps({"cldr": CLDR, "source": "npm cldr-misc-full and cldr-core",
                               "licence": "Unicode License v3, see cldr-LICENSE.txt",
                               "languages": languages}, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    counts = {s: sum(1 for v in languages.values() if v["script"] == s) for s in sorted(SCRIPTS)}
    print(f"wrote {OUT.relative_to(ROOT)}: {len(languages)} locales {counts}")


if __name__ == "__main__":
    main()
