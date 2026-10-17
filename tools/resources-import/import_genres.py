#!/usr/bin/env python3
"""Regenerate resources/genres/* from the original FictionBook Editor genre lists.

Inputs (read-only, from the reference checkout of the original FictionBook
Editor sources or a compatible tree):

  FBE/genres.txt       English list: category line without indentation, then
                       " code Name" lines (one leading space).
  FBE/genres.rus.txt   Russian list (UTF-8): same structure, every line is
                       "<ru text><TAB> ... <en text>" where the English text
                       mirrors genres.txt.
  FBE/genres.ukr.txt   Ukrainian list (UTF-8): same layout as genres.rus.txt.
  FictionBookGenres.xsd (resources/schema) - the authoritative code list.

Hand-maintained inputs in the output folder (feature 003, Ukrainian names of
the supplement):

  genres/names.extra.ru.txt   Russian supplement: the rows of the Ukrainian
                              supplement follow it.
  genres/categories.extra.tsv supplement categories with their title_uk column.

Outputs (UTF-8, LF):

  genres/names.en.txt        category<TAB>code<TAB>name   (English)
  genres/names.ru.txt        category<TAB>code<TAB>name   (Russian)
  genres/names.uk.txt        category<TAB>code<TAB>name   (Ukrainian)
  genres/names.extra.uk.txt  Ukrainian supplement: names.extra.ru.txt's rows with
                             the Ukrainian names of UK_EXTRA_NAMES
  genres/categories.tsv      key<TAB>title_en<TAB>title_ru<TAB>title_uk
  genres/missing-names.txt   schema codes that neither original list names

genres.txt is the source of truth for category order, genre order and
category->genre membership; genres.rus.txt and genres.ukr.txt only contribute
their language's strings. The script prints every discrepancy it detects and
exits non-zero if the schema check fails.

Usage:
  python3 tools/resources-import/import_genres.py
      [--ref /path/to/fictionbookeditor/FBE]
      [--schema resources/schema/FictionBookGenres.xsd]
      [--out resources/genres]
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

# Same for genres.ukr.txt (none known: the Ukrainian list is clean).
UK_FIXUPS = {}

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

# Ukrainian titles for original categories that genres.ukr.txt would leave
# without one (English title of the category -> Ukrainian title). Every
# category of genres.txt has a Ukrainian title in genres.ukr.txt, so the table
# is empty; it is the place to fill should the reference list change.
UK_CATEGORY_TITLES = {}

# Ukrainian names for codes of genres.txt that genres.ukr.txt does not list
# (code -> Ukrainian name), translated from the Russian name; without an entry
# the English name is used and reported.
UK_MISSING_NAMES = {
    "geo_guides": "Геопутівник",  # genres.rus.txt: ГеоПутеводитель
}

# Ukrainian names of the supplement codes (names.extra.*.txt: the schema codes
# the original lists do not name), translated from the Russian supplement with
# the original's genres.ukr.txt as the glossary (feature 003, US1). Mapping
# code -> Ukrainian name; a code of names.extra.ru.txt missing here is reported
# and falls back to its English name, a code here that the Russian supplement
# no longer has is reported as stale.
UK_EXTRA_NAMES = {
    "city_fantasy": "Міське фентезі",
    "dragon_fantasy": "Фентезі про драконів",
    "fantasy_fight": "Бойове фентезі",
    "historical_fantasy": "Історичне фентезі",
    "humor_fantasy": "Гумористичне фентезі",
    "love_fantasy": "Любовне фентезі",
    "magician_book": "Книги про чарівників",
    "popadanec": "Попаданці",
    "russian_fantasy": "Російське фентезі",
    "vampire_book": "Книги про вампірів",
    "beginning_authors": "Автори-початківці",
    "essays": "Есеї",
    "literature_18": "Література XVIII століття",
    "literature_19": "Література XIX століття",
    "literature_20": "Література XX століття",
    "narrative": "Повісті",
    "russian_contemporary": "Сучасна російська проза",
    "short_story": "Оповідання",
    "sketch": "Нариси",
    "geography_book": "Географія",
    "pedagogy_book": "Педагогіка",
    "sociology_book": "Соціологія",
    "aphorism_quote": "Афоризми та цитати",
    "architecture_book": "Архітектура",
    "cinema_theatre": "Кінематограф і театр",
    "military_special": "Військова справа та спецслужби",
    "music_dancing": "Музика і танці",
    "visual_arts": "Образотворче мистецтво",
    "auto_regulations": "Автомобілі та ПДР",
    "upbringing_book": "Виховання дітей",
    "psy_alassic": "Класики психології",
    "psy_childs": "Дитяча психологія",
    "psy_generic": "Загальна психологія",
    "psy_personal": "Особистісне зростання",
    "psy_sex_and_family": "Секс і сімейна психологія",
    "psy_social": "Соціальна психологія",
    "psy_theraphy": "Психотерапія та консультування",
    "newspapers": "Газети",
    "periodic": "Журнали та періодика",
    "foreign_action": "Зарубіжні бойовики",
    "foreign_adventure": "Зарубіжні пригоди",
    "foreign_antique": "Зарубіжна старовинна література",
    "foreign_business": "Зарубіжна ділова література",
    "foreign_children": "Зарубіжні дитячі книги",
    "foreign_comp": "Зарубіжна комп'ютерна література",
    "foreign_contemporary": "Сучасна зарубіжна проза",
    "foreign_contemporary_lit": "Сучасна зарубіжна література",
    "foreign_desc": "Зарубіжна довідкова література",
    "foreign_detective": "Зарубіжні детективи",
    "foreign_dramaturgy": "Зарубіжна драматургія",
    "foreign_edu": "Зарубіжна освітня література",
    "foreign_fantasy": "Зарубіжне фентезі",
    "foreign_home": "Зарубіжна література про дім і сім'ю",
    "foreign_humor": "Зарубіжний гумор",
    "foreign_language": "Іноземні мови",
    "foreign_love": "Зарубіжні любовні романи",
    "foreign_novel": "Зарубіжні романи",
    "foreign_other": "Зарубіжна література: інше",
    "foreign_poetry": "Зарубіжна поезія",
    "foreign_prose": "Зарубіжна класика",
    "foreign_psychology": "Зарубіжна психологія",
    "foreign_publicism": "Зарубіжна публіцистика",
    "foreign_religion": "Зарубіжна релігійна та езотерична література",
    "foreign_sf": "Зарубіжна фантастика",
    "unrecognised": "Жанр не визначено",
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

HEADER_EXTRA_UK = [
    "# Maxima Fiction Book Editor - FB2 genre display names (Ukrainian), supplement.",
    "# Names for the {count} codes of schema/FictionBookGenres.xsd that the original",
    "# FictionBook Editor lists (names.uk.txt) do not cover (see missing-names.txt).",
    "# Same format as names.uk.txt: category<TAB>code<TAB>name, where 'category' is",
    "# the Ukrainian title of the group (categories.tsv or categories.extra.tsv).",
    "# Lines starting with '#' are comments. UTF-8, LF.",
    "#",
    "# Generated by tools/resources-import/import_genres.py: the rows follow the",
    "# hand-maintained names.extra.ru.txt, the Ukrainian names come from the script's",
    "# UK_EXTRA_NAMES table (translated from the Russian names, the original's",
    "# genres.ukr.txt as the glossary). Do not edit by hand - change the table and",
    "# rerun the script instead.",
]

CYRILLIC = r"[\u0400-\u04FF]"


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


def parse_localised(path, lang, report, fixups):
    """Parse genres.rus.txt / genres.ukr.txt (the same layout: "<text><TAB> ... <en>").

    Returns a list of dicts: {title, title_en, genres: [(code, name, en)]}, where
    `title`/`name` are the texts in the file's language.
    """
    label = path.name
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        report(f"{label}: UTF-8 BOM present - ignored")
        data = data[3:]
    text = data.decode("utf-8")
    cats = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        fields = raw.split("\t")
        if not raw[0].isspace():
            title = norm_ws(fields[0])
            title_en = strip_ellipsis(fields[-1]) if len(fields) > 1 else ""
            cats.append({"title": title, "title_en": title_en, "genres": []})
            continue
        if not cats:
            report(f"{label}:{lineno}: genre line before any category")
            continue
        first = fields[0].strip().split(None, 1)
        code = first[0]
        if len(first) > 1:
            name = norm_ws(first[1])
            rest = fields[1:]
        else:
            # " accounting<TAB>Бухучет...<TAB>… Accounting": name in 2nd field
            report(f"{label}:{lineno}: TAB used instead of space after code {code!r}")
            name = norm_ws(fields[1]) if len(fields) > 1 else ""
            rest = fields[2:]
        en = strip_ellipsis(rest[-1]) if rest else ""
        if not rest:
            report(f"{label}:{lineno}: {code}: no English column")
        if code in fixups:
            bad, good = fixups[code]
            if name == bad:
                report(f"{label}:{lineno}: {code}: {lang} name {name!r} contains a leaked "
                       f"English word - corrected to {good!r}")
                name = good
            else:
                report(f"{label}:{lineno}: {code}: fix-up for {bad!r} is stale (found {name!r})")
        elif re.search(r"\b[A-Za-z]{2,}\b", name) and re.search(CYRILLIC, name):
            report(f"{label}:{lineno}: {code}: {lang} name {name!r} mixes Latin and Cyrillic words")
        if not re.search(CYRILLIC, name):
            report(f"{label}:{lineno}: {code}: {lang} name {name!r} has no Cyrillic letters")
        cats[-1]["genres"].append((code, name, en))
    return cats


def category_key(title_en, genres):
    if title_en in CATEGORY_KEY_OVERRIDES:
        return CATEGORY_KEY_OVERRIDES[title_en]
    first = genres[0][0]
    return first.split("_", 1)[0]


def schema_codes(path):
    text = path.read_text(encoding="utf-8")
    return re.findall(r'<xs:enumeration value="([^"]+)"', text)


def match_categories(en_cats, loc_cats, label, report, title_fallbacks):
    """Pair every English category with the localised one of the same English title
    (then by position). Returns [(title_en, genres, loc_cat)]; a category without a
    localised counterpart gets the title of `title_fallbacks` (else the English title).
    """
    by_title = {c["title_en"]: c for c in loc_cats}
    if len(en_cats) != len(loc_cats):
        report(f"category count differs: genres.txt {len(en_cats)}, {label} {len(loc_cats)}")
    matched = []
    for idx, (title_en, genres) in enumerate(en_cats):
        loc = by_title.get(title_en)
        if loc is None and idx < len(loc_cats):
            loc = loc_cats[idx]
            report(f"category {title_en!r}: no {label} category with that English title; "
                   f"matched by position to {loc['title']!r} ({loc['title_en']!r})")
        if loc is None:
            title = title_fallbacks.get(title_en)
            if title is None:
                report(f"category {title_en!r}: no {label} category at all - English title used")
                title = title_en
            else:
                report(f"category {title_en!r}: no {label} category at all - script table "
                       f"title {title!r} used")
            loc = {"title": title, "title_en": title_en, "genres": []}
        matched.append((title_en, genres, loc))
    return matched


def localised_rows(matched, loc_cats, lang, label, report, check_english, missing_names):
    """Build the category<TAB>code<TAB>name rows of one language from the matched
    categories; a code the localised list lacks takes its name from `missing_names`
    (script table), else the English name. Returns (rows, fallback_codes)."""
    any_name = {}  # code -> name (first occurrence anywhere)
    for c in loc_cats:
        for code, name, _en in c["genres"]:
            any_name.setdefault(code, name)
    en_codes = {code for _t, genres, _l in matched for code, _n in genres}
    loc_codes = {code for c in loc_cats for code, _n, _e in c["genres"]}
    for code in sorted(loc_codes - en_codes):
        report(f"code {code!r} is in {label} but not in genres.txt - ignored")

    rows, fallback = [], []
    for title_en, genres, loc_cat in matched:
        here = {}
        for code, name, _en in loc_cat["genres"]:
            here.setdefault(code, name)
        loc_order = [code for code, _n, _e in loc_cat["genres"]]
        en_order = [code for code, _n in genres]
        if loc_order != en_order:
            only_loc = [c for c in loc_order if c not in en_order]
            only_en = [c for c in en_order if c not in loc_order]
            if only_loc or only_en:
                report(f"category {title_en!r}: membership differs - only in {label}: "
                       f"{only_loc}, only in genres.txt: {only_en}")
            else:
                report(f"category {title_en!r}: genre order differs between the two files "
                       f"(genres.txt order kept): en={en_order} {lang}={loc_order}")
        for code, name_en in genres:
            name = here.get(code)
            if name is None:
                name = any_name.get(code)
                if name is not None:
                    report(f"{code} under {title_en!r}: {lang} name taken from another category")
            if name is None and code in missing_names:
                name = missing_names[code]
                report(f"{code} under {title_en!r}: no {lang} name in {label} - script table "
                       f"name {name!r} used")
            if name is None:
                fallback.append(code)
                report(f"{code} under {title_en!r}: no {lang} name - English name {name_en!r} used")
                name = name_en
            rows.append((loc_cat["title"], code, name))
            # English text embedded in the localised file should mirror genres.txt
            # (reported for the Russian file only: the Ukrainian file copies its text).
            if check_english:
                for c, _n, e in loc_cat["genres"]:
                    if c == code and e and norm_ws(e) != name_en and e.replace("Misk", "Misc") != name_en:
                        report(f"{code} under {title_en!r}: English text differs: genres.txt "
                               f"{name_en!r}, {label} {e!r}")
                        break
    return rows, fallback


def read_tsv_rows(path):
    """Rows of a '#'-commented TAB-separated file (header rows included)."""
    rows = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        rows.append([f.strip() for f in raw.split("\t")])
    return rows


def ukrainian_supplement(out, title_uk_by_ru, report):
    """Rows of names.extra.uk.txt: names.extra.ru.txt's rows with Ukrainian titles and
    the names of UK_EXTRA_NAMES; falls back to the English supplement's names."""
    ru_path = out / "names.extra.ru.txt"
    en_path = out / "names.extra.en.txt"
    extra_path = out / "categories.extra.tsv"
    if not ru_path.exists():
        report(f"{ru_path.name} not found - names.extra.uk.txt not written")
        return None
    en_names = {}
    if en_path.exists():
        for fields in read_tsv_rows(en_path):
            if len(fields) >= 3:
                en_names.setdefault(fields[1], fields[2])
    titles = dict(title_uk_by_ru)
    if extra_path.exists():
        for fields in read_tsv_rows(extra_path):
            if fields[0] == "key" or len(fields) < 3:
                continue  # header row
            if len(fields) < 4 or not fields[3]:
                report(f"{extra_path.name}: category {fields[0]!r} has no title_uk column")
                continue
            titles.setdefault(fields[2], fields[3])
    rows = []
    seen = set()
    for fields in read_tsv_rows(ru_path):
        if len(fields) < 3:
            report(f"{ru_path.name}: malformed row {fields!r}")
            continue
        title_ru, code, name_ru = fields[0], fields[1], fields[2]
        seen.add(code)
        title_uk = titles.get(title_ru)
        if title_uk is None:
            report(f"{ru_path.name}: {code}: no Ukrainian title for category {title_ru!r} "
                   f"- Russian title used")
            title_uk = title_ru
        name_uk = UK_EXTRA_NAMES.get(code)
        if name_uk is None:
            name_uk = en_names.get(code, name_ru)
            report(f"{ru_path.name}: {code}: no Ukrainian name in UK_EXTRA_NAMES - "
                   f"{name_uk!r} used")
        rows.append((title_uk, code, name_uk))
    for code in sorted(set(UK_EXTRA_NAMES) - seen):
        report(f"UK_EXTRA_NAMES: {code!r} is not in {ru_path.name} - stale entry")
    return rows


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
    ru_cats = parse_localised(ref / "genres.rus.txt", "Russian", report, RU_FIXUPS)
    uk_cats = parse_localised(ref / "genres.ukr.txt", "Ukrainian", report, UK_FIXUPS)

    # --- match the localised categories to the English ones (by embedded English
    #     title, then by position) ----------------------------------------------
    matched_ru = match_categories(en_cats, ru_cats, "genres.rus.txt", report, {})
    matched_uk = match_categories(en_cats, uk_cats, "genres.ukr.txt", report,
                                  UK_CATEGORY_TITLES)

    # --- build output rows --------------------------------------------------
    rows_en = [(title_en, code, name_en)
               for title_en, genres, _loc in matched_ru for code, name_en in genres]
    rows_ru, fallback_ru = localised_rows(matched_ru, ru_cats, "ru", "genres.rus.txt",
                                          report, check_english=True, missing_names={})
    rows_uk, fallback_uk = localised_rows(matched_uk, uk_cats, "uk", "genres.ukr.txt",
                                          report, check_english=False,
                                          missing_names=UK_MISSING_NAMES)
    en_codes = {code for _t, genres in en_cats for code, _n in genres}
    uk_named = {code for cat in uk_cats for code, _n, _e in cat["genres"]}
    for code in sorted(UK_MISSING_NAMES):
        if code not in en_codes:
            report(f"UK_MISSING_NAMES: {code!r} is not in genres.txt - stale entry")
        elif code in uk_named:
            report(f"UK_MISSING_NAMES: {code!r} is named by genres.ukr.txt - stale entry")
    cat_rows = []
    for (title_en, genres, ru_cat), (_t, _g, uk_cat) in zip(matched_ru, matched_uk):
        cat_rows.append((category_key(title_en, genres), title_en, ru_cat["title"],
                         uk_cat["title"]))
    keys = [k for k, _e, _r, _u in cat_rows]
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

    # --- Ukrainian supplement -----------------------------------------------
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows_extra_uk = ukrainian_supplement(out, {r: u for _k, _e, r, u in cat_rows}, report)

    # --- write --------------------------------------------------------------
    def write(path, lines):
        path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    def header(lang, source):
        return [h.format(lang=lang, source=source) for h in HEADER_COMMON]

    def fallback_note(lang, fallback):
        return ([f"# Codes without a {lang} name (English name used): {', '.join(fallback)}"]
                if fallback else [])

    write(out / "names.en.txt",
          header("English", "FBE/genres.txt")
          + [f"{c}\t{code}\t{n}" for c, code, n in rows_en])
    write(out / "names.ru.txt",
          header("Russian", "FBE/genres.rus.txt (structure from FBE/genres.txt)")
          + fallback_note("Russian", fallback_ru)
          + [f"{c}\t{code}\t{n}" for c, code, n in rows_ru])
    write(out / "names.uk.txt",
          header("Ukrainian", "FBE/genres.ukr.txt (structure from FBE/genres.txt)")
          + fallback_note("Ukrainian", fallback_uk)
          + [f"{c}\t{code}\t{n}" for c, code, n in rows_uk])
    if rows_extra_uk is not None:
        write(out / "names.extra.uk.txt",
              [h.format(count=len({code for _c, code, _n in rows_extra_uk}))
               for h in HEADER_EXTRA_UK]
              + [f"{c}\t{code}\t{n}" for c, code, n in rows_extra_uk])
    write(out / "categories.tsv",
          ["# Genre categories of the original FictionBook Editor lists (FBE/genres.txt,",
           "# FBE/genres.rus.txt, FBE/genres.ukr.txt). Format:",
           "# key<TAB>title_en<TAB>title_ru<TAB>title_uk. 'key' is a stable identifier",
           "# derived from the code prefix of the category's first genre (override:",
           "# economics). Generated by tools/resources-import/import_genres.py.",
           "key\ttitle_en\ttitle_ru\ttitle_uk"]
          + [f"{k}\t{e}\t{r}\t{u}" for k, e, r, u in cat_rows])
    write(out / "missing-names.txt",
          ["# FB2 genre codes enumerated in schema/FictionBookGenres.xsd that the",
           "# original FictionBook Editor lists (FBE/genres.txt, FBE/genres.rus.txt)",
           "# do not name - one code per line, schema order. Display names for these",
           "# must be added separately. Generated by resources/tools/import_genres.py.",
           f"# Schema codes: {len(codes)}; named: {len(codes) - len(missing)}; missing: {len(missing)}."]
          + missing)

    # --- summary ------------------------------------------------------------
    print(f"categories: {len(cat_rows)}")
    print(f"genre lines: en={len(rows_en)} ru={len(rows_ru)} uk={len(rows_uk)}; "
          f"distinct codes named: {len(named)}")
    print(f"Russian fallbacks to English: {len(fallback_ru)} {fallback_ru}")
    print(f"Ukrainian fallbacks to English: {len(fallback_uk)} {fallback_uk}")
    if rows_extra_uk is not None:
        print(f"Ukrainian supplement lines: {len(rows_extra_uk)}")
    print(f"schema codes: {len(codes)}; named: {len(codes) - len(missing)}; missing: {len(missing)}")
    print(f"named codes not in schema: {len(extra)} {extra}")
    print(f"discrepancies reported: {len(issues)}")
    for i in issues:
        print("  -", i)
    ok = (all(c in named or c in missing for c in codes)
          and len(rows_en) == len(rows_ru) == len(rows_uk))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
