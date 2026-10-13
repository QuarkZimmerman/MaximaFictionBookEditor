#!/usr/bin/env python3
"""Regenerate resources/genres/* from the original FictionBook Editor genre lists.

Inputs (read-only, from the reference checkout of the original FictionBook
Editor sources or a compatible tree):

  FBE/genres.txt       English list: category line without indentation, then
                       " code Name" lines (one leading space).
  FBE/genres.rus.txt   Russian list (UTF-8): same structure, every line is
                       "<ru text><TAB> ... <en text>" where the English text
                       mirrors genres.txt.
  FictionBookGenres.xsd (resources/schema) - the authoritative code list.

Outputs (UTF-8, LF):

  genres/names.en.txt      category<TAB>code<TAB>name   (English)
  genres/names.ru.txt      category<TAB>code<TAB>name   (Russian)
  genres/categories.tsv    key<TAB>title_en<TAB>title_ru
  genres/missing-names.txt schema codes that neither list names

genres.txt is the source of truth for category order, genre order and
category->genre membership; genres.rus.txt only contributes Russian strings.
The script prints every discrepancy it detects and exits non-zero if the
schema check fails.

Usage:
  python3 tools/import_genres.py [--ref /path/to/fictionbookeditor/FBE]
                                 [--schema schema/FictionBookGenres.xsd]
                                 [--out genres]
"""
import argparse
import re
import sys
from pathlib import Path

ELLIPSIS = "\u2026"

# Russian names in genres.rus.txt that are known to be corrupted upstream:
# an English word of the name leaked into the Russian column. Mapping
# code -> (corrupted Russian text as found upstream, corrected Russian text).
# A fix-up that no longer matches the upstream text is reported as stale.
RU_FIXUPS = {
    "real_estate": ("Real Недвижимость", "Недвижимость"),
    "paper_work": ("Paper Делопроизводство", "Делопроизводство"),
}

# English display-name normalisations (obvious typos in genres.txt).
EN_FIXUPS = {
    "Misk": "Misc",
}

# Category keys are derived from the prefix of the first genre code of the
# category (text before the first "_"; the whole code when it has none).
# Overrides for categories where that rule gives a meaningless key.
CATEGORY_KEY_OVERRIDES = {
    "Economy, Business": "economics",   # first code is job_hunting -> "job"
}

HEADER_COMMON = [
    "# Maxima Fiction Book Editor - FB2 genre display names ({lang}).",
    "# Format: one genre per line, three TAB-separated fields:",
    "#   category<TAB>code<TAB>name",
    "# 'category' is the {lang} title of the group the genre is listed under",
    "# (see categories.tsv for the stable category keys); 'code' is the FB2",
    "# genre code (FictionBookGenres.xsd); 'name' is the display name.",
    "# A code may appear under several categories (cross-listing); category",
    "# and genre order follow the original lists. Lines starting with '#' are",
    "# comments. UTF-8, LF.",
    "#",
    "# Derived from the original FictionBook Editor 2.7 sources,",
    "# file(s) {source}, by tools/resources-import/import_genres.py.",
    "# Do not edit by hand - rerun the script instead.",
]


def norm_ws(s):
    return re.sub(r"\s+", " ", s).strip()


def strip_ellipsis(s):
    s = s.strip()
    if s.startswith(ELLIPSIS):
        s = s[len(ELLIPSIS):]
    return norm_ws(s)


def parse_en(path, report):
    """Return list of (category_title, [(code, name), ...]) from genres.txt."""
    text = path.read_bytes().decode("utf-8")  # genres.txt is plain ASCII
    cats = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        if not raw[0].isspace():
            cats.append((norm_ws(raw), []))
            continue
        if not cats:
            report(f"genres.txt:{lineno}: genre line before any category: {raw!r}")
            continue
        parts = raw.strip().split(None, 1)
        code = parts[0]
        name = norm_ws(parts[1]) if len(parts) > 1 else ""
        if code.endswith(","):
            report(f"genres.txt:{lineno}: code {code!r} has a trailing comma - stripped")
            code = code.rstrip(",")
        if "\t" in raw.strip().split(" ", 1)[0]:
            report(f"genres.txt:{lineno}: TAB used instead of space after code {code!r}")
        for bad, good in EN_FIXUPS.items():
            if re.search(rf"\b{bad}\b", name):
                report(f"genres.txt:{lineno}: {code}: name {name!r} uses {bad!r} - normalised to {good!r}")
                name = re.sub(rf"\b{bad}\b", good, name)
        if not re.fullmatch(r"[a-z0-9_]+", code):
            report(f"genres.txt:{lineno}: suspicious code {code!r}")
        cats[-1][1].append((code, name))
    return cats


def parse_ru(path, report):
    """Return list of dicts: {title_ru, title_en, genres: [(code, ru, en)]}."""
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        report("genres.rus.txt: UTF-8 BOM present - ignored")
        data = data[3:]
    text = data.decode("utf-8")
    cats = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        fields = raw.split("\t")
        if not raw[0].isspace():
            title_ru = norm_ws(fields[0])
            title_en = strip_ellipsis(fields[-1]) if len(fields) > 1 else ""
            cats.append({"title_ru": title_ru, "title_en": title_en, "genres": []})
            continue
        if not cats:
            report(f"genres.rus.txt:{lineno}: genre line before any category")
            continue
        first = fields[0].strip().split(None, 1)
        code = first[0]
        if len(first) > 1:
            ru = norm_ws(first[1])
            rest = fields[1:]
        else:
            # " accounting<TAB>Бухучет...<TAB>… Accounting": name in 2nd field
            report(f"genres.rus.txt:{lineno}: TAB used instead of space after code {code!r}")
            ru = norm_ws(fields[1]) if len(fields) > 1 else ""
            rest = fields[2:]
        en = strip_ellipsis(rest[-1]) if rest else ""
        if not rest:
            report(f"genres.rus.txt:{lineno}: {code}: no English column")
        if code in RU_FIXUPS:
            bad, good = RU_FIXUPS[code]
            if ru == bad:
                report(f"genres.rus.txt:{lineno}: {code}: Russian name {ru!r} contains a leaked "
                       f"English word - corrected to {good!r}")
                ru = good
            else:
                report(f"genres.rus.txt:{lineno}: {code}: fix-up for {bad!r} is stale (found {ru!r})")
        elif re.search(r"\b[A-Za-z]{2,}\b", ru) and re.search(r"[\u0400-\u04FF]", ru):
            report(f"genres.rus.txt:{lineno}: {code}: Russian name {ru!r} mixes Latin and Cyrillic words")
        if not re.search(r"[\u0400-\u04FF]", ru):
            report(f"genres.rus.txt:{lineno}: {code}: Russian name {ru!r} has no Cyrillic letters")
        cats[-1]["genres"].append((code, ru, en))
    return cats


def category_key(title_en, genres):
    if title_en in CATEGORY_KEY_OVERRIDES:
        return CATEGORY_KEY_OVERRIDES[title_en]
    first = genres[0][0]
    return first.split("_", 1)[0]


def schema_codes(path):
    text = path.read_text(encoding="utf-8")
    return re.findall(r'<xs:enumeration value="([^"]+)"', text)


def main():
    here = Path(__file__).resolve().parents[2] / "resources"  # <repo>/resources
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="/root/maxfbeditor/reference/fictionbookeditor/FBE")
    ap.add_argument("--schema", default=str(here / "schema" / "FictionBookGenres.xsd"))
    ap.add_argument("--out", default=str(here / "genres"))
    args = ap.parse_args()

    issues = []
    report = issues.append

    ref = Path(args.ref)
    en_cats = parse_en(ref / "genres.txt", report)
    ru_cats = parse_ru(ref / "genres.rus.txt", report)

    # --- match Russian categories to English ones (by embedded English title,
    #     then by position) -------------------------------------------------
    ru_by_title = {c["title_en"]: c for c in ru_cats}
    if len(en_cats) != len(ru_cats):
        report(f"category count differs: genres.txt {len(en_cats)}, genres.rus.txt {len(ru_cats)}")
    matched = []
    for idx, (title_en, genres) in enumerate(en_cats):
        ru = ru_by_title.get(title_en)
        if ru is None and idx < len(ru_cats):
            ru = ru_cats[idx]
            report(f"category {title_en!r}: no Russian category with that English title; "
                   f"matched by position to {ru['title_ru']!r} ({ru['title_en']!r})")
        if ru is None:
            report(f"category {title_en!r}: no Russian category at all - English title used")
            ru = {"title_ru": title_en, "title_en": title_en, "genres": []}
        matched.append((title_en, genres, ru))

    # --- Russian lookup tables --------------------------------------------
    ru_any = {}            # code -> ru name (first occurrence anywhere)
    for c in ru_cats:
        for code, ru, _en in c["genres"]:
            ru_any.setdefault(code, ru)

    en_codes = {code for _t, genres in en_cats for code, _n in genres}
    ru_codes = {code for c in ru_cats for code, _r, _e in c["genres"]}
    for code in sorted(ru_codes - en_codes):
        report(f"code {code!r} is in genres.rus.txt but not in genres.txt - ignored")

    # --- build output rows --------------------------------------------------
    rows_en, rows_ru, cat_rows = [], [], []
    fallback = []
    for title_en, genres, ru_cat in matched:
        key = category_key(title_en, genres)
        title_ru = ru_cat["title_ru"]
        cat_rows.append((key, title_en, title_ru))
        ru_here = {}
        for code, ru, _en in ru_cat["genres"]:
            ru_here.setdefault(code, ru)
        ru_order = [code for code, _r, _e in ru_cat["genres"]]
        en_order = [code for code, _n in genres]
        if ru_order != en_order:
            only_ru = [c for c in ru_order if c not in en_order]
            only_en = [c for c in en_order if c not in ru_order]
            if only_ru or only_en:
                report(f"category {title_en!r}: membership differs - only in genres.rus.txt: "
                       f"{only_ru}, only in genres.txt: {only_en}")
            else:
                report(f"category {title_en!r}: genre order differs between the two files "
                       f"(genres.txt order kept): en={en_order} ru={ru_order}")
        for code, name_en in genres:
            rows_en.append((title_en, code, name_en))
            name_ru = ru_here.get(code)
            if name_ru is None:
                name_ru = ru_any.get(code)
                if name_ru is not None:
                    report(f"{code} under {title_en!r}: Russian name taken from another category")
            if name_ru is None:
                fallback.append(code)
                report(f"{code} under {title_en!r}: no Russian name - English name {name_en!r} used")
                name_ru = name_en
            rows_ru.append((title_ru, code, name_ru))
            # English text embedded in the Russian file should mirror genres.txt
            for c, _r, e in ru_cat["genres"]:
                if c == code and e and norm_ws(e) != name_en and e.replace("Misk", "Misc") != name_en:
                    report(f"{code} under {title_en!r}: English text differs: genres.txt {name_en!r}, "
                           f"genres.rus.txt {e!r}")
                    break

    keys = [k for k, _e, _r in cat_rows]
    if len(set(keys)) != len(keys):
        report(f"category keys are not unique: {keys}")

    # --- schema check -------------------------------------------------------
    codes = schema_codes(Path(args.schema))
    schema_set = set(codes)
    named = {code for _c, code, _n in rows_en}
    missing = [c for c in codes if c not in named]
    extra = sorted(named - schema_set)
    for c in extra:
        report(f"code {c!r} is named in genres.txt but is not in FictionBookGenres.xsd")

    # --- write --------------------------------------------------------------
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    def write(path, lines):
        path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    def header(lang, source):
        return [h.format(lang=lang, source=source) for h in HEADER_COMMON]

    write(out / "names.en.txt",
          header("English", "FBE/genres.txt")
          + [f"{c}\t{code}\t{n}" for c, code, n in rows_en])
    write(out / "names.ru.txt",
          header("Russian", "FBE/genres.rus.txt (structure from FBE/genres.txt)")
          + ([f"# Codes without a Russian name (English name used): {', '.join(fallback)}"]
             if fallback else [])
          + [f"{c}\t{code}\t{n}" for c, code, n in rows_ru])
    write(out / "categories.tsv",
          ["# Genre categories of the original FictionBook Editor lists (FBE/genres.txt,",
           "# FBE/genres.rus.txt). Format: key<TAB>title_en<TAB>title_ru. 'key' is a",
           "# stable identifier derived from the code prefix of the category's first",
           "# genre (override: economics). Generated by resources/tools/import_genres.py.",
           "key\ttitle_en\ttitle_ru"]
          + [f"{k}\t{e}\t{r}" for k, e, r in cat_rows])
    write(out / "missing-names.txt",
          ["# FB2 genre codes enumerated in schema/FictionBookGenres.xsd that the",
           "# original FictionBook Editor lists (FBE/genres.txt, FBE/genres.rus.txt)",
           "# do not name - one code per line, schema order. Display names for these",
           "# must be added separately. Generated by resources/tools/import_genres.py.",
           f"# Schema codes: {len(codes)}; named: {len(codes) - len(missing)}; missing: {len(missing)}."]
          + missing)

    # --- summary ------------------------------------------------------------
    print(f"categories: {len(cat_rows)}")
    print(f"genre lines: en={len(rows_en)} ru={len(rows_ru)}; distinct codes named: {len(named)}")
    print(f"Russian fallbacks to English: {len(fallback)} {fallback}")
    print(f"schema codes: {len(codes)}; named: {len(codes) - len(missing)}; missing: {len(missing)}")
    print(f"named codes not in schema: {len(extra)} {extra}")
    print(f"discrepancies reported: {len(issues)}")
    for i in issues:
        print("  -", i)
    ok = all(c in named or c in missing for c in codes) and len(rows_en) == len(rows_ru)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
