#!/usr/bin/env python3
"""Renders the scripts section of the release notes from the inventory of the classic scripts
(feature 007, T070; spec FR-022, FR-023, FR-024; data-model §7.4).

The single record is ``tests/scripts/audit/inventory-279.json``: one entry per script of
FictionBook Editor 2.7.9 and per package converted from 2.7beta1 without a 2.7.9 successor. This
tool turns it into Markdown for people: the scripts added, those brought up to their 2.7.9
version, the defects fixed, the scripts kept as converted before, those without a 2.7.9
counterpart, and the scripts not converted with their reasons and what they would need. The
names are the menu's (the package manifest's Russian name, then its English one).

Usage::

    python3 tools/release-notes-scripts.py              # print the section
    python3 tools/release-notes-scripts.py --write      # put it into conversion-notes-279.md
                                                        # under "## Summary"
    python3 tools/release-notes-scripts.py --check      # exit 1 when that section is stale
    python3 tools/release-notes-scripts.py --self-test

Exit codes: 0 ok, 1 stale summary or a failed self-test, 2 usage or input errors.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INVENTORY = REPO / "tests" / "scripts" / "audit" / "inventory-279.json"
NOTES = REPO / "docs" / "scripting" / "conversion-notes-279.md"
SUMMARY_HEADING = "## Summary"
SUMMARY_INTRO = (
    "The release notes' scripts section, written by `tools/release-notes-scripts.py` from the "
    "inventory; do not edit it by hand (`--write` regenerates it, `--check` runs in CI)."
)

NUMBER = re.compile(r"^(\d+)_")


def order_key(path: str) -> tuple:
    """Menu order: the group's number, then the script's number, then the name (natural)."""
    parts = path.split("/")
    key: list = []
    for part in parts:
        match = NUMBER.match(part)
        key.append((0, int(match.group(1)), part) if match else (1, 0, part))
    return tuple(key)


def group_title(entry: dict) -> str:
    group = entry.get("group") or ""
    if not group:
        return "top level"
    match = NUMBER.match(group)
    return f"{match.group(1)} {group[match.end():]}" if match else group


def script_name(entry: dict, repo: Path) -> str:
    """The menu's names: the manifest's when the entry has a package. Without one the Russian
    name of the inventory, and the English one only when a conversion reviewed it
    (`namesReviewed`; the audit tool's own English names are transliterations)."""
    names = dict(entry.get("names") or {})
    package = entry.get("package")
    manifest = repo / package / "script.json" if package else None
    if manifest is not None and manifest.is_file():
        names.update(json.loads(manifest.read_text(encoding="utf-8")).get("name") or {})
    elif not entry.get("namesReviewed"):
        names.pop("en", None)
    ru = names.get("ru") or NUMBER.sub("", Path(entry["source"]).stem)
    en = names.get("en")
    return f"*{ru}* ({en})" if en and en != ru else f"*{ru}*"


def by_group(entries: list[dict], repo: Path) -> list[str]:
    """One line per group: `*NN group*: name, name, ...`."""
    groups: dict[str, list[dict]] = {}
    for entry in sorted(entries, key=lambda e: order_key(e["source"])):
        groups.setdefault(group_title(entry), []).append(entry)
    return [f"  - {title} ({len(items)}): " + "; ".join(script_name(e, repo) for e in items) + "."
            for title, items in groups.items()]


def with_text(entries: list[dict], repo: Path, render) -> list[str]:
    lines = []
    for entry in sorted(entries, key=lambda e: order_key(e["source"])):
        lines.append(f"  - {script_name(entry, repo)}, {group_title(entry)}: {render(entry)}")
    return lines


def sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith((".", "!", "?")) else text + "."


def render(inventory: dict, repo: Path) -> str:
    entries = inventory["entries"]
    of_279 = [e for e in entries if e.get("fbeVersion") == "2.7.9"]
    status = lambda name: [e for e in entries if e.get("status") == name]  # noqa: E731
    added = [e for e in status("new") if e.get("package")]
    pending = [e for e in status("new") if not e.get("package")]
    updated = status("updated")
    unchanged = status("unchanged")
    kept = status("kept")
    no_counterpart = status("noCounterpart")
    not_converted = status("notConverted")
    dropped = status("dropped")
    recheck = status("recheck")
    fixed = [e for e in entries if e.get("fixes")]

    out: list[str] = []
    out.append("### Scripts of FictionBook Editor 2.7.9")
    out.append("")
    in_menu = sum(1 for e in entries if e.get("package"))
    out.append(f"The bundled scripts follow FictionBook Editor 2.7.9 ({len(of_279)} scripts); "
               f"the Scripts menu holds {in_menu} scripts of the classic editor.")
    out.append("")
    out.append("| Outcome | Scripts |")
    out.append("|---------|--------:|")
    for label, items in (("New in the Scripts menu", added),
                         ("Brought up to their 2.7.9 version", updated),
                         ("Already as in 2.7.9", unchanged),
                         ("Kept as converted before", kept),
                         ("Converted before, no 2.7.9 counterpart (kept)", no_counterpart),
                         ("Not converted", not_converted),
                         ("Left out by the requester's decision", dropped)):
        out.append(f"| {label} | {len(items)} |")
    out.append("")
    if pending or recheck:
        out.append(
            f"- **Not finished yet**: {len(pending)} new scripts not converted and "
            f"{len(recheck)} converted scripts not compared with their 2.7.9 version."
        )
    if added:
        out.append(f"- **Added** ({len(added)}), by group:")
        out.extend(by_group(added, repo))
    if updated:
        out.append(f"- **Brought up to their 2.7.9 version** ({len(updated)}), by group:")
        out.extend(by_group(updated, repo))
    if fixed:
        count = sum(len(e["fixes"]) for e in fixed)
        out.append(f"- **Defects fixed** ({count}, where both the intent and the defect were "
                   "clear):")
        for entry in sorted(fixed, key=lambda e: order_key(e["source"])):
            for fix in entry["fixes"]:
                out.append(f"  - {script_name(entry, repo)}, {group_title(entry)}: "
                           f"{sentence(fix if isinstance(fix, str) else json.dumps(fix, ensure_ascii=False))}")
    if kept:
        out.append(f"- **Kept as converted before** ({len(kept)}):")
        out.extend(with_text(kept, repo, lambda e: sentence(
            "; ".join(str(d) for d in e.get("differences") or []) or "our version is kept")))
    if no_counterpart:
        out.append(f"- **Without a 2.7.9 counterpart, kept in their groups** "
                   f"({len(no_counterpart)}):")
        out.extend(by_group(no_counterpart, repo))
    if not_converted:
        out.append(f"- **Not converted** ({len(not_converted)}): each needs more than the "
                   "script API allows.")

        def reason(entry: dict) -> str:
            text = sentence(entry.get("reason") or "no reason recorded")
            needs = entry.get("needs")
            return f"{text} It would need {sentence(needs[0].lower() + needs[1:])}" if needs else text

        out.extend(with_text(not_converted, repo, reason))
    if dropped:
        out.append(f"- **Left out by the requester's decision** ({len(dropped)}): scripts that have "
                   "nothing to do with editing the book.")
        out.extend(with_text(dropped, repo, lambda e: sentence(e.get("reason") or "left out")))
    return "\n".join(out) + "\n"


def summary_section(text: str) -> tuple[int, int]:
    """The span of the summary's body: after its heading line to the next level-2 heading."""
    start = text.find(f"\n{SUMMARY_HEADING}\n")
    if start < 0:
        raise SystemExit(f"release-notes-scripts: {NOTES.relative_to(REPO)} has no "
                         f"'{SUMMARY_HEADING}' section")
    body = start + len(SUMMARY_HEADING) + 2
    following = re.search(r"\n## ", text[body:])
    end = body + following.start() + 1 if following else len(text)
    return body, end


def summary_text(rendered: str) -> str:
    return f"\n{SUMMARY_INTRO}\n\n{rendered}"


def write(notes: Path, rendered: str) -> None:
    text = notes.read_text(encoding="utf-8")
    body, end = summary_section(text)
    tail = text[end:]
    new = text[:body] + summary_text(rendered) + ("\n" + tail if tail else "")
    notes.write_text(new, encoding="utf-8")


def check(notes: Path, rendered: str) -> int:
    text = notes.read_text(encoding="utf-8")
    body, end = summary_section(text)
    current = text[body:end].rstrip("\n") + "\n"
    if current == summary_text(rendered):
        print("release-notes-scripts: the summary is current")
        return 0
    print(f"release-notes-scripts: {notes.relative_to(REPO)} § Summary is stale; run "
          "python3 tools/release-notes-scripts.py --write", file=sys.stderr)
    return 1


def self_test() -> int:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        package = repo / "scripts" / "10_statistics" / "05_general"
        package.mkdir(parents=True)
        (package / "script.json").write_text(json.dumps(
            {"name": {"ru": "Общая статистика", "en": "General statistics"}}), encoding="utf-8")
        words = repo / "scripts" / "10_statistics" / "01_words"
        words.mkdir(parents=True)
        (words / "script.json").write_text(json.dumps(
            {"name": {"ru": "Слова", "en": "Words"}}), encoding="utf-8")
        inventory = {"entries": [
            {"source": "10_Статистика/05_Общая статистика.js", "fbeVersion": "2.7.9",
             "group": "10_Статистика", "status": "new", "package": "scripts/10_statistics/05_general",
             "fixes": ["the count of words skipped the last paragraph"]},
            {"source": "10_Статистика/1_Слова.js", "fbeVersion": "2.7.9", "group": "10_Статистика",
             "status": "updated", "package": "scripts/10_statistics/01_words"},
            {"source": "05_Иллюстрации/03_Обновить иллюстрации.js", "fbeVersion": "2.7.9",
             "group": "05_Иллюстрации", "status": "notConverted", "package": None,
             "names": {"ru": "Обновить иллюстрации", "en": "Obnovit illustrations"},
             "reason": "it reads picture files",
             "needs": "Reading files the user picks"},
            {"source": "29_Режим чтения.js", "fbeVersion": "2.7.9", "group": "",
             "status": "notConverted", "package": None, "reason": "the editor's page",
             "names": {"ru": "Режим чтения", "en": "Reading mode"}, "namesReviewed": True},
            {"source": "01_Регистр/Предложение_alxs.js", "fbeVersion": "2.7",
             "group": "01_Регистр", "status": "noCounterpart", "package": None,
             "names": {"ru": "Предложение_alxs"}},
            {"source": "99_Прочее/10_Игра.js", "fbeVersion": "2.7.9", "group": "99_Прочее",
             "status": "dropped", "package": None, "reason": "a game",
             "names": {"ru": "Игра", "en": "A game"}, "namesReviewed": True},
        ]}
        text = render(inventory, repo)
        expected = [
            "### Scripts of FictionBook Editor 2.7.9",
            "| New in the Scripts menu | 1 |",
            "| Not converted | 2 |",
            "- **Added** (1), by group:",
            "  - 10 Статистика (1): *Общая статистика* (General statistics).",
            "- **Brought up to their 2.7.9 version** (1), by group:",
            "  - 10 Статистика (1): *Слова* (Words).",
            "- **Defects fixed** (1,",
            "  - *Общая статистика* (General statistics), 10 Статистика: the count of words "
            "skipped the last paragraph.",
            "- **Without a 2.7.9 counterpart, kept in their groups** (1):",
            "  - 01 Регистр (1): *Предложение_alxs*.",
            "- **Not converted** (2):",
            "  - *Обновить иллюстрации*, 05 Иллюстрации: it reads picture files. It would need "
            "reading files the user picks.",
            "  - *Режим чтения* (Reading mode), top level: the editor's page.",
            "| Left out by the requester's decision | 1 |",
            "- **Left out by the requester's decision** (1): scripts that have nothing to do with "
            "editing the book.",
            "  - *Игра* (A game), 99 Прочее: a game.",
        ]
        failures = [line for line in expected if line not in text]
        # Menu order: group 05 before the top-level script, numbers compared as numbers.
        if text.find("Обновить иллюстрации") > text.find("*Режим чтения*"):
            failures.append("not-converted order")
        if order_key("16_x/154_a.js") < order_key("16_x/52_b.js"):
            failures.append("numeric order")
        notes = repo / "notes.md"
        notes.write_text("# Notes\n\n## Summary\n\nold\n\n## Later\n\nkept\n", encoding="utf-8")
        write(notes, text)
        written = notes.read_text(encoding="utf-8")
        if "\nold\n" in written or "## Later\n\nkept\n" not in written or check(notes, text) != 0:
            failures.append("write/check")
    for failure in failures:
        print(f"release-notes-scripts: self-test FAILED: {failure}", file=sys.stderr)
    if failures:
        print(text, file=sys.stderr)
        return 1
    print("release-notes-scripts: self-test OK")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--write", action="store_true", help="update conversion-notes-279.md")
    action.add_argument("--check", action="store_true", help="fail when that section is stale")
    action.add_argument("--self-test", action="store_true")
    parser.add_argument("--inventory", type=Path, default=INVENTORY)
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.inventory.is_file():
        print(f"release-notes-scripts: {args.inventory} not found", file=sys.stderr)
        return 2
    rendered = render(json.loads(args.inventory.read_text(encoding="utf-8")), REPO)
    if args.write:
        write(NOTES, rendered)
        print(f"release-notes-scripts: wrote {NOTES.relative_to(REPO)} § Summary")
        return 0
    if args.check:
        return check(NOTES, rendered)
    sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
