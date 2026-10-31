#!/usr/bin/env python3
"""Legacy FBE script audit and conversion toolkit (T107, US12).

Reads the 146 JScript scripts of the original FictionBook Editor
(``~/maxfbeditor/reference/fictionbookeditor/FBE/files/Scripts`` plus ``TreeCmd``), detects the
text encoding of each file, extracts the host/DOM API calls it relies on, classifies it into
the conversion tiers of ``contracts/script-manifest.md`` §4, derives the Russian name from the
file name (``NN_`` prefix stripped), drafts an English name from a glossary (transliteration
fallback, flagged as a draft) and writes under ``tests/scripts/audit/``:

* ``conversion-plan.json``   – one entry per script: group, order, names, tier, APIs, HTML
                               dialogs referenced, icon, encoding, size, target package folder
* ``summary.md``             – tier counts per group (the planning table for T108–T127)
* ``skeletons/<group>/<script>/script.json`` – manifest skeletons with ``legacy.source``
* ``skeletons/<group>/<script>/index.js``    – a stub entry module quoting the legacy header
* ``skeletons/<group>/<script>/icon.png``    – the ``.ico`` converted to PNG (16 px preferred)
* ``skeletons/<group>/group.json``           – group names (Russian + drafted English)

Usage: ``python3 tools/legacy-script-audit.py [--source DIR] [--out DIR] [--no-skeletons]``.

Feature 007 (FictionBook Editor 2.7.9): ``--recheck [--source 2.7.9/files] [--baseline
2.7beta1/files]`` pairs every converted package's original with its 2.7.9 successor (the same
name first, else the most similar code; the review's ``pairing-overrides-279.json`` wins),
classifies each change (identical / small < 5 % / moderate < 30 % / major, code without comments
and layout) and writes ``inventory-279.json`` (one entry per 2.7.9 script and per package without
a successor; the fields recorded by hand survive a regeneration), ``recheck-279.json``,
``authors-279.txt`` and ``skeletons-279/`` (group names and icons, a starting package per new
script with its 16 x 16 icon). ``--diff <package>`` prints a pair's diff; ``--self-test`` checks
the pairing on five known pairs.
Pure standard library (no PIL): the ICO → PNG conversion decodes the BMP/DIB images itself.
Developer tooling only - never shipped.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path



REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path.home() / "maxfbeditor" / "reference" / "fictionbookeditor" / "FBE" / "files"
DEFAULT_OUT = REPO_ROOT / "tests" / "scripts" / "audit"

# --------------------------------------------------------------------------------------------
# Encoding detection
# --------------------------------------------------------------------------------------------


def decode_text(data: bytes) -> tuple[str, str]:
    """Returns (text, encoding) trying BOMs, UTF-16, UTF-8 and finally Windows-1251."""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace"), "utf-8-sig"
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16", errors="replace"), "utf-16"
    if len(data) >= 4 and data[1] == 0 and data[3] == 0:
        return data.decode("utf-16-le", errors="replace"), "utf-16-le"
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return data.decode("cp1251", errors="replace"), "windows-1251"


# --------------------------------------------------------------------------------------------
# API detection
# --------------------------------------------------------------------------------------------

# name -> regular expression over the script text
API_PATTERNS: dict[str, str] = {
    "MsgBox": r"\bMsgBox\s*\(",
    "InputBox": r"\bInputBox\s*\(",
    "AskYesNo": r"\bAskYesNo\s*\(",
    "confirm": r"\bconfirm\s*\(",
    "alert": r"\balert\s*\(",
    "BeginUndoUnit": r"\b[Bb]eginUndoUnit\s*\(",
    "EndUndoUnit": r"\b[Ee]ndUndoUnit\s*\(",
    "GetNBSP": r"\bGetNBSP\s*\(",
    "SetStatusBarText": r"\bSetStatusBarText\s*\(",
    "inflateBlock": r"\binflateBlock\b",
    "GetViewSize": r"\b[Gg]etView(Width|Height)\s*\(",
    "GetBinarySize": r"\bGetBinarySize\s*\(",
    "SaveBinary": r"\bSaveBinary\s*\(",
    "GetUUID": r"\bGetUUID\s*\(",
    "showModalDialog": r"\bshowModal(ess)?Dialog\s*\(",
    "window.open": r"\bwindow\.open\s*\(",
    "clipboardData": r"\bclipboardData\b",
    "execCommand": r"\bexecCommand\s*\(",
    "document.selection": r"\bdocument\.selection\b",
    "TextRange": r"\b(createRange|createTextRange|moveToElementText|setEndPoint|pasteHTML|expand|findText)\s*\(",
    "getElementsByTagName": r"\bgetElementsByTagName\s*\(",
    "document.all": r"\bdocument\.all\b",
    "getElementById": r"\bgetElementById\s*\(",
    "innerText": r"\binnerText\b",
    "innerHTML": r"\binnerHTML\b",
    "outerHTML": r"\bouterHTML\b",
    "insertAdjacentHTML": r"\binsertAdjacent(HTML|Element|Text)\s*\(",
    "createElement": r"\bcreateElement\s*\(",
    "appendChild": r"\bappendChild\s*\(",
    "insertBefore": r"\binsertBefore\s*\(",
    "removeChild": r"\bremoveChild\s*\(",
    "removeNode": r"\bremoveNode\s*\(",
    "replaceNode": r"\breplaceNode\s*\(",
    "cloneNode": r"\bcloneNode\s*\(",
    "className": r"\bclassName\b",
    "RegExp": r"\bnew\s+RegExp\b|\.replace\s*\(\s*/|\.match\s*\(|\.search\s*\(|\.test\s*\(",
    "setTimeout": r"\bsetTimeout\s*\(",
    "api.*": r"\bapi\.[A-Za-z]",
    "Description": r"\bDescription\b",
    "styleSheets": r"\bstyleSheets\b|\bcurrentStyle\b|\bruntimeStyle\b",
}

STRUCTURAL_CLASSES = (
    "section",
    "image",
    "poem",
    "stanza",
    "notes",
    "comments",
    "body",
    "binary",
    "cite",
    "epigraph",
    "annotation",
    "title",
    "subtitle",
    "table",
    "coverpage",
)

STRUCTURAL_APIS = {
    "createElement",
    "appendChild",
    "insertBefore",
    "removeChild",
    "removeNode",
    "replaceNode",
    "cloneNode",
    "insertAdjacentHTML",
}

DIALOG_APIS = {"showModalDialog", "window.open"}
OBSOLETE_APIS = {"clipboardData", "SaveBinary", "styleSheets"}
HTML_REF_RE = re.compile(r"""["']([^"'\n]*\.html?)["']""", re.IGNORECASE)


def detect_apis(text: str) -> list[str]:
    found = [name for name, pattern in API_PATTERNS.items() if re.search(pattern, text)]
    return found


def structural_hints(text: str) -> list[str]:
    hints = []
    for cls in STRUCTURAL_CLASSES:
        # class="section", className=="image", <div class=section>, tags("DIV") + class
        if re.search(rf"""class(Name)?\s*(=|==|!=)\s*["']?{cls}\b""", text, re.IGNORECASE) or re.search(
            rf"""<div\s+class\s*=\s*\\?["']?{cls}\b""", text, re.IGNORECASE
        ):
            hints.append(cls)
    return hints


CREATION_CLASSES = {
    "section",
    "image",
    "poem",
    "stanza",
    "notes",
    "comments",
    "body",
    "binary",
    "cite",
    "epigraph",
    "table",
    "coverpage",
}
STRUCTURAL_GROUPS = ("02_", "03_", "04_", "05_", "08_", "09_", "11_", "13_", "17_")
DOM_BUILD_APIS = {"createElement", "appendChild", "insertBefore", "insertAdjacentHTML", "cloneNode"}
MARKER_RE = re.compile(r"BlockStart|BlockEnd|CursorPosition|id\s*=\s*\\?[\"']?\w*[Mm]arker", re.IGNORECASE)


def classify(group: str, apis: list[str], html_refs: list[str], structure: list[str], text: str) -> tuple[int, str]:
    """Returns (tier, reason) - heuristics; the conversion tasks confirm the tier per script.

    Tier 4: the debugging group or raw HTML / clipboard / binary export helpers.
    Tier 3: opens an HTML dialog (showModalDialog / window.open / *.htm reference).
    Tier 2: a group that creates structure (notes, comments, images, sections, poems, captions,
            subtitles), or a script that builds container elements (section/poem/cite/...),
            or DOM-building calls that are not the marker-tag selection trick.
    Tier 1: everything else - text and regex work over paragraphs/selection with the façade.
    """
    if group.startswith("20_") or "clipboardData" in apis or "SaveBinary" in apis:
        return 4, "engine/debugging helper (clipboard, raw HTML dump or binary export)"
    if any(api in DIALOG_APIS for api in apis) or html_refs:
        return 3, "HTML dialog(s) -> ui.form"
    creation = sorted(set(structure) & CREATION_CLASSES)
    dom_build = sorted(set(apis) & DOM_BUILD_APIS)
    markers_only = MARKER_RE.search(text) is not None
    if group.startswith(STRUCTURAL_GROUPS):
        return 2, "group creates/moves structure (notes, images, sections, poems) -> mfbe.doc"
    if creation:
        return 2, f"builds/walks containers ({', '.join(creation)}) -> mfbe.doc node operations"
    if dom_build and not markers_only:
        return 2, f"DOM building ({', '.join(dom_build)}) -> doc.insertNode/replaceNode"
    return 1, "text/regex over paragraphs with MsgBox/InputBox/undo units -> façade port"


# --------------------------------------------------------------------------------------------
# Names
# --------------------------------------------------------------------------------------------

ORDER_RE = re.compile(r"^(\d+)_(.*)$")

GLOSSARY: dict[str, str] = {
    # groups
    "регистр": "case",
    "добавление": "adding",
    "примечания": "footnotes",
    "примечание": "footnote",
    "комментария": "comment",
    "комментарии": "comments",
    "комментариев": "comments",
    "и": "and",
    "из": "from",
    "скобок": "brackets",
    "иллюстрации": "illustrations",
    "чистка": "clean-up",
    "символы": "symbols",
    "структура": "structure",
    "разделов": "of sections",
    "стихи": "poems",
    "статистика": "statistics",
    "заголовки": "titles",
    "картинок": "of images",
    "в": "into",
    "подписи": "captions",
    "обработка": "processing",
    "кавычек": "of quotes",
    "подзаголовки,": "subtitles,",
    "подзаголовки": "subtitles",
    "пустые": "empty",
    "строки": "lines",
    "поиск": "search",
    "форматирования": "of formatting",
    "перенос": "moving",
    "примечаний": "footnotes",
    "скобки": "brackets",
    "мелочи": "small",
    "редактирования": "editing tasks",
    "инструменты": "tools",
    "отладки": "debugging",
    "замена": "replace",
    "режим": "mode",
    "чтения": "reading",
    # scripts
    "верхний": "upper",
    "нижний": "lower",
    "предложение": "sentence case",
    "капитализация": "capitalisation",
    "выделения": "of the selection",
    "первого": "of the first",
    "слова": "word",
    "циклическое": "cyclic",
    "изменение": "change",
    "регистра": "of case",
    "заголовков": "of titles",
    "подзаголовков...": "subtitles...",
    "подзаголовков": "subtitles",
    "добавить": "add",
    "сноску,": "footnote,",
    "сноску": "footnote",
    "оставшись": "staying",
    "на": "on",
    "ее": "its",
    "её": "its",
    "ссылке": "reference",
    "введя": "entering",
    "текст": "text",
    "окошке": "a dialog",
    "перейти": "go",
    "к": "to",
    "разделу": "section",
    "унификация": "unification",
    "сносок": "of footnotes",
    "последнюю": "last",
    "тест": "test",
    "комментарий": "comment",
    "комментария,": "comment,",
    "простым": "plain",
    "текстом": "text",
    "заданных": "given by",
    "регэкспами": "regular expressions",
    "{}": "{}",
    "[!": "[!",
    "!]": "!]",
    "[~": "[~",
    "~]": "~]",
    "генеральная": "general",
    "уборка": "clean-up",
    "латиница": "latin letters",
    "кириллице": "cyrillic",
    "фамилия": "surname",
    "и.": "I.",
    "о.": "O.",
    "слипшиеся": "stuck-together",
    "управляемое": "guided",
    "исправление": "fixing",
    "разрывов": "of breaks",
    "абзацев...": "of paragraphs...",
    "абзацев": "of paragraphs",
    "дефис": "hyphen",
    "-": "-",
    "тире": "dash",
    "точка.": "dot.",
    "точка,": "dot,",
    "точка": "dot",
    "удаление": "removal",
    "возвратов": "of carriage returns",
    "разрыв": "break",
    "предложения": "of a sentence",
    "тире,": "dash,",
    "буква...": "letter...",
    "буква": "letter",
    "(без": "(without",
    "поиска": "search",
    "многоточий)": "ellipses)",
    "win-1252": "win-1252",
    "(слова)...": "(words)...",
    "(буквы)...": "(letters)...",
    "спецсимволы": "special symbols",
    "диакритика": "diacritics",
    "арабский": "arabic",
    "валюта": "currency",
    "греческий": "greek",
    "древнерусский": "old russian",
    "иврит": "hebrew",
    "таблица": "table",
    "символов": "of symbols",
    "управление": "managing",
    "структурой": "the structure",
    "их": "their",
    "заголовками...": "titles...",
    "поднять": "raise",
    "опустить": "lower",
    "раздел": "section",
    "один": "one",
    "уровень": "level",
    "разбиение": "splitting",
    "секции": "into sections",
    "вверх": "up",
    "вниз": "down",
    "стих": "poem",
    "строфа": "stanza",
    "строфы": "stanzas",
    "показать": "show",
    "все-все": "all",
    "ссылки": "links",
    "все": "all",
    "размер": "size",
    "картинки": "images",
    "картинку": "image",
    "подпись": "caption",
    "подписью": "caption",
    "заголовок": "title",
    "расстановка": "placement",
    "елочек": "of guillemets",
    "лапок": "of low quotes",
    "елочки": "guillemets",
    "лапки": "low quotes",
    "переход": "go",
    "след.": "to the next",
    "пред.": "to the previous",
    "кавычки": "quotes",
    "кавычек,": "quotes,",
    "вложенных": "nested",
    "прямые": "straight",
    "подзаголовок": "subtitle",
    "пустая": "empty",
    "строка": "line",
    "строки,": "lines,",
    "форматирование": "formatting",
    "жирный": "bold",
    "курсив": "italic",
    "обзор": "overview",
    "превращение": "conversion",
    "элементов...": "of elements...",
    "элементов": "of elements",
    "код": "code",
    "весь": "whole",
    "буфер": "clipboard",
    "вставить": "insert",
    "ссылку": "a link",
    "midi...": "midi...",
    "ошибок": "of errors",
    "текста": "of the text",
    "(регекспы": "(regexps",
    "от": "by",
    "набору": "a set of",
    "регэкспов": "regular expressions",
    "(заготовка)": "(template)",
    "пример": "example",
    "1": "1",
    "примечаниями": "footnotes",
    "примечаниям": "footnotes",
    "комментариям": "comments",
}

TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh",
    "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def transliterate(text: str) -> str:
    out = []
    for ch in text:
        low = ch.lower()
        if low in TRANSLIT:
            t = TRANSLIT[low]
            out.append(t.capitalize() if ch.isupper() and t else t)
        else:
            out.append(ch)
    return "".join(out)


def split_order(stem: str) -> tuple[int | None, str]:
    match = ORDER_RE.match(stem)
    if match:
        return int(match.group(1)), match.group(2)
    return None, stem


def draft_english(russian: str) -> tuple[str, bool]:
    """Glossary word-by-word translation; (text, is_draft) where draft = some words transliterated."""
    words = russian.split()
    out = []
    draft = False
    for word in words:
        key = word.lower()
        if key in GLOSSARY:
            out.append(GLOSSARY[key])
        elif re.fullmatch(r"[A-Za-z0-9.,()\[\]{}!~\-_/%&+*]+", word):
            out.append(word)
        else:
            out.append(transliterate(word))
            draft = True
    text = " ".join(out)
    text = re.sub(r"\s+", " ", text).strip()
    return (text[:1].upper() + text[1:]) if text else russian, draft


def slug(text: str) -> str:
    base = transliterate(text).lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return base or "script"


# --------------------------------------------------------------------------------------------
# ICO -> PNG (BMP/DIB decoding, no PIL)
# --------------------------------------------------------------------------------------------


def _png(width: int, height: int, rgba_rows: list[bytes]) -> bytes:
    raw = b"".join(b"\x00" + row for row in rgba_rows)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def _decode_dib(img: bytes) -> tuple[int, int, list[bytes]] | None:
    header_size, width, height2, planes, bpp = struct.unpack_from("<IiiHH", img, 0)
    if header_size < 40:
        return None
    height = height2 // 2  # XOR + AND masks
    compression = struct.unpack_from("<I", img, 16)[0]
    if compression != 0:
        return None
    colors_used = struct.unpack_from("<I", img, 32)[0]
    palette_count = colors_used or (1 << bpp if bpp <= 8 else 0)
    offset = header_size
    palette = []
    for i in range(palette_count):
        b, g, r, _ = struct.unpack_from("<BBBB", img, offset + 4 * i)
        palette.append((r, g, b))
    offset += 4 * palette_count
    row_bytes = ((width * bpp + 31) // 32) * 4
    xor_size = row_bytes * height
    xor = img[offset : offset + xor_size]
    and_row_bytes = ((width + 31) // 32) * 4
    and_mask = img[offset + xor_size : offset + xor_size + and_row_bytes * height]
    rows: list[bytes] = []
    for y in range(height):
        src_y = height - 1 - y  # bottom-up
        row = bytearray()
        xor_row = xor[src_y * row_bytes : (src_y + 1) * row_bytes]
        and_row = and_mask[src_y * and_row_bytes : (src_y + 1) * and_row_bytes] if and_mask else b""
        for x in range(width):
            if bpp == 32:
                b, g, r, a = xor_row[4 * x : 4 * x + 4]
            elif bpp == 24:
                b, g, r = xor_row[3 * x : 3 * x + 3]
                a = 255
            elif bpp == 8:
                r, g, b = palette[xor_row[x]] if xor_row[x] < len(palette) else (0, 0, 0)
                a = 255
            elif bpp == 4:
                byte = xor_row[x // 2]
                index = byte >> 4 if x % 2 == 0 else byte & 0x0F
                r, g, b = palette[index] if index < len(palette) else (0, 0, 0)
                a = 255
            elif bpp == 1:
                index = (xor_row[x // 8] >> (7 - x % 8)) & 1
                r, g, b = palette[index] if index < len(palette) else (0, 0, 0)
                a = 255
            else:
                return None
            if and_row and bpp != 32:
                transparent = (and_row[x // 8] >> (7 - x % 8)) & 1
                if transparent:
                    a = 0
            elif and_row and bpp == 32:
                # Some 32-bit icons carry no real alpha; honour the AND mask when alpha is all 0.
                pass
            row += bytes((r, g, b, a))
        rows.append(bytes(row))
    if bpp == 32 and all(px == 0 for row in rows for px in row[3::4]):
        # Alpha channel unused: derive it from the AND mask instead.
        fixed = []
        for y, row in enumerate(rows):
            src_y = height - 1 - y
            and_row = and_mask[src_y * and_row_bytes : (src_y + 1) * and_row_bytes]
            out = bytearray(row)
            for x in range(width):
                transparent = (and_row[x // 8] >> (7 - x % 8)) & 1 if and_row else 0
                out[4 * x + 3] = 0 if transparent else 255
            fixed.append(bytes(out))
        rows = fixed
    return width, height, rows


def ico_to_png(data: bytes, prefer: int = 16) -> bytes | None:
    if len(data) < 6:
        return None
    _, kind, count = struct.unpack_from("<HHH", data, 0)
    if kind != 1 or count == 0:
        return None
    entries = []
    for i in range(count):
        w, h, _, _, _, bpp, size, offset = struct.unpack_from("<BBBBHHII", data, 6 + 16 * i)
        entries.append(((w or 256), (h or 256), bpp, size, offset))
    # Prefer the requested size with the highest colour depth, then the smallest larger one.
    entries.sort(key=lambda e: (abs(e[0] - prefer), -e[2]))
    for w, h, bpp, size, offset in entries:
        img = data[offset : offset + size]
        if img[:8] == b"\x89PNG\r\n\x1a\n":
            return img
        try:
            decoded = _decode_dib(img)
        except (struct.error, IndexError):
            decoded = None
        if decoded:
            width, height, rows = decoded
            return _png(width, height, rows)
    return None


# --------------------------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------------------------


@dataclass
class ScriptEntry:
    source: str  # path relative to the Scripts folder (legacy.source)
    group: str  # legacy group folder ("" for top-level scripts, "tree" for TreeCmd)
    group_order: int | None
    group_name_ru: str
    group_name_en: str
    order: int | None
    name_ru: str
    name_en: str
    name_en_draft: bool
    id: str
    kind: str
    tier: int
    tier_reason: str
    apis: list[str]
    structure: list[str]
    html_dialogs: list[str]
    icon: str | None
    encoding: str
    lines: int
    bytes: int
    has_run: bool
    target: str  # target package folder under scripts/
    notes: list[str] = field(default_factory=list)


def audit(source: Path) -> tuple[list[ScriptEntry], list[str]]:
    scripts_dir = source / "Scripts"
    tree_dir = source / "TreeCmd"
    entries: list[ScriptEntry] = []
    problems: list[str] = []
    files = sorted(scripts_dir.rglob("*.js")) + sorted(tree_dir.glob("*.js"))
    for file in files:
        data = file.read_bytes()
        text, encoding = decode_text(data)
        rel = file.relative_to(source if file.is_relative_to(tree_dir) else scripts_dir)
        if file.is_relative_to(tree_dir):
            group_folder, group_order, group_ru = "tree", None, "Команды дерева"
            group_en = "Tree commands"
            kind = "tree"
            source_rel = str(Path("TreeCmd") / file.name)
        else:
            group_folder = rel.parts[0] if len(rel.parts) > 1 else ""
            group_order, group_ru = split_order(group_folder) if group_folder else (None, "")
            group_en = draft_english(group_ru)[0] if group_ru else ""
            kind = "menu"
            source_rel = str(rel)
        stem = file.stem
        order, name_ru = split_order(stem)
        name_en, draft = draft_english(name_ru)
        apis = detect_apis(text)
        structure = structural_hints(text)
        html_refs = sorted({m.group(1) for m in HTML_REF_RE.finditer(text)})
        tier, reason = classify(group_folder, apis, html_refs, structure, text)
        if kind == "tree":
            tier, reason = 2, "tree command: ProcessCmd() marks paragraphs -> kind 'tree' with ctx.treeNode"
        icon = file.with_suffix(".ico")
        has_run = re.search(r"\bfunction\s+Run\s*\(", text) is not None or re.search(r"\bfunction\s+ProcessCmd\s*\(", text) is not None
        notes = []
        if not has_run:
            notes.append("no Run()/ProcessCmd() entry point found")
        if encoding not in ("utf-8", "utf-8-sig"):
            notes.append(f"source encoded as {encoding}; convert to UTF-8")
        if "inflateBlock" in apis:
            notes.append("uses window.external.inflateBlock (IE layout helper): drop")
        if "GetViewSize" in apis:
            notes.append("uses view size: not available to scripts, use ui.form for options")
        group_slug = slug(group_ru) if group_ru else "misc"
        script_id = f"fbe.{group_slug}.{slug(name_ru)}"
        # Grouped scripts keep their group folder; the top-level script becomes an ungrouped
        # package at the scripts root (T126: scripts/29_Режим чтения/).
        target_dir = f"{group_folder}/{stem}" if group_folder else stem
        entries.append(
            ScriptEntry(
                source=source_rel,
                group=group_folder,
                group_order=group_order,
                group_name_ru=group_ru,
                group_name_en=group_en,
                order=order,
                name_ru=name_ru,
                name_en=name_en,
                name_en_draft=draft,
                id=script_id,
                kind=kind,
                tier=tier,
                tier_reason=reason,
                apis=apis,
                structure=structure,
                html_dialogs=html_refs,
                icon=str(icon.relative_to(source)) if icon.exists() else None,
                encoding=encoding,
                lines=text.count("\n") + 1,
                bytes=len(data),
                has_run=has_run,
                target=target_dir,
                notes=notes,
            )
        )
    # Duplicate ids (same slug in a group) get a numeric suffix.
    seen: dict[str, int] = {}
    for entry in entries:
        if entry.id in seen:
            seen[entry.id] += 1
            entry.id = f"{entry.id}-{seen[entry.id]}"
            entry.notes.append("id suffixed to stay unique")
        else:
            seen[entry.id] = 1
    return entries, problems


def write_outputs(entries: list[ScriptEntry], problems: list[str], source: Path, out: Path, skeletons: bool) -> None:
    out.mkdir(parents=True, exist_ok=True)
    plan = {
        "source": str(source),
        "scripts": len(entries),
        "tiers": {str(t): sum(1 for e in entries if e.tier == t) for t in (1, 2, 3, 4)},
        "entries": [asdict(e) for e in entries],
        "problems": problems,
    }
    (out / "conversion-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Summary table per group.
    groups: dict[str, list[ScriptEntry]] = {}
    for entry in entries:
        groups.setdefault(entry.group, []).append(entry)
    lines = [
        "# Legacy script conversion plan",
        "",
        f"Source: `{source}` — {len(entries)} scripts.",
        "",
        "| Group | Scripts | Tier 1 | Tier 2 | Tier 3 | Tier 4 | HTML dialogs | Encodings |",
        "|-------|---------|--------|--------|--------|--------|--------------|-----------|",
    ]

    def group_key(name: str) -> tuple[int, str]:
        order, _ = split_order(name)
        return (order if order is not None else 9999, name)

    totals = [0, 0, 0, 0]
    for group in sorted(groups, key=group_key):
        items = groups[group]
        counts = [sum(1 for e in items if e.tier == t) for t in (1, 2, 3, 4)]
        for i, c in enumerate(counts):
            totals[i] += c
        dialogs = sorted({d for e in items for d in e.html_dialogs})
        encodings = sorted({e.encoding for e in items})
        lines.append(
            f"| `{group or '(root)'}` | {len(items)} | {counts[0]} | {counts[1]} | {counts[2]} | {counts[3]} | "
            f"{len(dialogs)} | {', '.join(encodings)} |"
        )
    lines.append(f"| **Total** | {len(entries)} | {totals[0]} | {totals[1]} | {totals[2]} | {totals[3]} | | |")
    lines += ["", "## Scripts", ""]
    for group in sorted(groups, key=group_key):
        lines.append(f"### `{group or '(root)'}`")
        lines.append("")
        lines.append("| Source | Tier | Draft English name | APIs | Dialogs | Notes |")
        lines.append("|--------|------|--------------------|------|---------|-------|")
        for e in groups[group]:
            name = e.name_en + (" *(draft)*" if e.name_en_draft else "")
            lines.append(
                f"| `{e.source}` | {e.tier} | {name} | {', '.join(e.apis)} | {', '.join(e.html_dialogs)} | {'; '.join(e.notes)} |"
            )
        lines.append("")
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    if not skeletons:
        return
    root = out / "skeletons"
    icons_ok = 0
    for e in entries:
        folder = root / e.target
        folder.mkdir(parents=True, exist_ok=True)
        manifest = {
            "manifestVersion": 1,
            "id": e.id,
            "name": {"en": e.name_en, "ru": e.name_ru},
            "kind": e.kind,
            "entry": "index.js",
        }
        if e.icon:
            png = ico_to_png((source / e.icon).read_bytes())
            if png:
                (folder / "icon.png").write_bytes(png)
                manifest["icon"] = "icon.png"
                icons_ok += 1
        manifest["legacy"] = {"source": e.source, "fbeVersion": "2.7"}
        if "document.selection" in e.apis or "TextRange" in e.apis:
            manifest["needsSelection"] = False  # review: many scripts also work on the caret paragraph
        manifest["undoLabel"] = {"en": e.name_en, "ru": e.name_ru}
        (folder / "script.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        header = [
            f"// Converted from {e.source} (FictionBook Editor 2.7) — Tier {e.tier}: {e.tier_reason}",
            f"// Legacy APIs: {', '.join(e.apis) or 'none detected'}",
        ]
        if e.html_dialogs:
            header.append(f"// HTML dialogs to express as ui.form: {', '.join(e.html_dialogs)}")
        for note in e.notes:
            header.append(f"// NOTE: {note}")
        stub = "\n".join(header) + "\n" + (
            "export default async function run(ctx) {\n"
            "  // TODO(T1xx): port the legacy Run() body using docs/scripting/en.md §6.\n"
            "  await mfbe.ui.message(`${ctx.script.name}: not converted yet`, { icon: 'warning' });\n"
            "}\n"
        )
        (folder / "index.js").write_text(stub, encoding="utf-8")
    for group in sorted(groups, key=group_key):
        if not group or group == "tree":
            continue
        first = groups[group][0]
        group_dir = root / group
        group_dir.mkdir(parents=True, exist_ok=True)
        (group_dir / "group.json").write_text(
            json.dumps({"names": {"en": first.group_name_en, "ru": first.group_name_ru}}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        group_icon = source / "Scripts" / f"{group}.ico"
        if group_icon.exists():
            png = ico_to_png(group_icon.read_bytes())
            if png:
                (group_dir / "icon.png").write_bytes(png)
    print(f"skeletons: {len(entries)} packages, {icons_ok} icons converted -> {root}")


# --------------------------------------------------------------------------------------------
# FictionBook Editor 2.7.9: pairing, recheck and inventory (feature 007, T018; data-model §7.4)
# --------------------------------------------------------------------------------------------

DEFAULT_SOURCE_279 = Path.home() / "maxfbeditor" / "reference" / "fictionbookeditor-2.7.9" / "files"
INVENTORY = "inventory-279.json"
RECHECK = "recheck-279.json"
AUTHORS = "authors-279.txt"
SKELETONS_279 = "skeletons-279"
# Manual pairing decisions of the review (T019): "<2.7beta1 path>": "<2.7.9 path>" | null. They
# beat the computed pairing, so a regenerated inventory keeps them.
OVERRIDES = "pairing-overrides-279.json"

# The bundled package folder of each 2.7.9 group (data-model §7.5): English slugs; 20_debug is
# 95_programmers since feature 007 (the 2.7.9 group "Для программистов").
GROUP_FOLDERS_279: dict[int, str] = {
    1: "01_case", 2: "02_footnotes", 3: "03_comments", 4: "04_notes-from-brackets",
    5: "05_images", 6: "06_cleanup", 7: "07_symbols", 8: "08_sections", 9: "09_poems",
    10: "10_statistics", 11: "11_image-captions", 12: "12_quotes", 13: "13_subtitles",
    14: "14_citations", 16: "16_find-formatting", 17: "17_notes-to-brackets", 18: "18_editing",
    19: "19_formatting", 21: "21_search-replace", 22: "22_description", 30: "30_numbering",
    31: "31_automation", 32: "32_note-markers", 34: "34_caret-selection", 37: "37_epigraphs",
    40: "40_tables", 95: "95_programmers", 99: "99_misc",
}

# The capability scan of research R6.3: what a script needs beyond script API version 1.
CAPABILITIES: dict[str, str] = {
    "clipboardWrite": r"clipboardData\.setData",
    "clipboardRead": r"clipboardData\.getData",
    "files": r"FileSystemObject|\.SaveBinary\s*\(|OpenTextFile|CreateTextFile|ADODB\.Stream",
    "reportWindow": r"window\.open\s*\(",
    "otherScripts": r"\brunScript(?:InFolder)?\s*\(",
    "htmlDialog": r"showModa(?:l|less)Dialog\s*\(",
    "sendKeys": r"\bSendKeys\b",
    "externalProgram": r"WScript\.Shell|Shell\.Application|ShellExecute",
    "web": r"XMLHTTP|InternetExplorer\.Application",
    "timers": r"\bsetTimeout\s*\(|\bsetInterval\s*\(",
    "eval": r"\beval\s*\(",
}

VERSION_PATTERNS = [
    r"NumerusVersion\s*=\s*[\"']([^\"']+)[\"']",
    r"(?i)верси[яи]\s*[:№]?\s*v?\.?\s*([0-9]+(?:\.[0-9]+)*)",
    r"(?i)\bver(?:sion)?\.?\s*:?\s*([0-9]+(?:\.[0-9]+)+)",
    r"\bv\.?\s?([0-9]+(?:\.[0-9]+)+)\b",
]
AUTHOR_RE = re.compile(
    r"(?i)(?:автор(?:ы|ом|ством)?(?:\s+(?:скрипта|сборки))?|author|написал|engine by|by|©)"
    r"\s*[:\-—–]?\s*©?\s*([A-Za-zА-Яа-яЁё][\w\-]{2,}(?:\s[A-ZА-Я][a-zа-я]+)?)"
)
AUTHOR_STOP = {"скрипта", "сборки", "the", "this", "default", "name", "first", "last", "fb2",
               "имени", "имя", "author", "authors", "info", "стиха", "файла", "книги"}


@dataclass
class Original:
    rel: str  # "01_Регистр/01_В верхний регистр.js", "29_Режим чтения.js", "TreeCmd/Пример 1.js"
    path: Path
    text: str
    encoding: str
    sha256: str
    lines: list[str]
    grams: set
    key: str
    group: str  # the group folder, "" at the top level, "TreeCmd" for tree commands


def code_lines(text: str) -> list[str]:
    """The code of a script without comments, one entry per non-empty line, spaces collapsed:
    what the recheck compares (a comment or layout change is no change)."""
    code = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    code = re.sub(r"(?<![:\\])//[^\n]*", " ", code)
    out = []
    for line in code.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            out.append(line)
    return out


def token_grams(lines: list[str]) -> set:
    tokens = re.findall(r"\w+|[^\s\w]", " ".join(lines))
    return {tuple(tokens[i : i + 4]) for i in range(max(0, len(tokens) - 3))}


def name_key(rel: str) -> str:
    stem = Path(rel).name
    stem = stem[:-3] if stem.lower().endswith(".js") else stem
    stem = re.sub(r"^\d+_", "", stem)
    stem = re.sub(r"[\s.…]+$", "", stem).replace("ё", "е").replace("Ё", "Е")
    return stem.lower()


def similarity(a: Original, b: Original) -> float:
    if not a.grams or not b.grams:
        return 1.0 if a.lines == b.lines else 0.0
    return len(a.grams & b.grams) / len(a.grams | b.grams)


def load_originals(files: Path) -> dict[str, Original]:
    import hashlib

    out: dict[str, Original] = {}
    scripts_dir = files / "Scripts"
    paths = [(p, p.relative_to(scripts_dir).as_posix()) for p in sorted(scripts_dir.rglob("*.js"))]
    paths += [(p, f"TreeCmd/{p.name}") for p in sorted((files / "TreeCmd").glob("*.js"))]
    for path, rel in paths:
        data = path.read_bytes()
        text, encoding = decode_text(data)
        lines = code_lines(text)
        group = rel.split("/")[0] if "/" in rel else ""
        out[rel] = Original(rel, path, text, encoding, hashlib.sha256(data).hexdigest(), lines,
                            token_grams(lines), name_key(rel), group)
    return out


def header_version(text: str) -> str | None:
    head = text[:8000]
    for pattern in VERSION_PATTERNS:
        match = re.search(pattern, head)
        if match:
            return match.group(1).strip().rstrip(".")
    return None


def capabilities(text: str) -> list[str]:
    code = "\n".join(code_lines(text))
    return [name for name, pattern in CAPABILITIES.items() if re.search(pattern, code)]


def author_candidates(text: str) -> list[str]:
    names = []
    for line in text[:8000].splitlines():
        stripped = line.strip()
        if not stripped.startswith("//") and not stripped.startswith("*"):
            continue
        for match in AUTHOR_RE.finditer(stripped):
            name = match.group(1).strip(" .,;")
            if name.lower() not in AUTHOR_STOP and not name.isdigit():
                names.append(name)
    return names


def our_packages(repo: Path) -> list[dict]:
    """Every bundled package: its folder, id, names and legacy reference."""
    out = []
    for manifest in sorted((repo / "scripts").glob("*/*/script.json")):
        data = json.loads(manifest.read_text(encoding="utf-8"))
        legacy = data.get("legacy") or {}
        out.append({
            "package": manifest.parent.relative_to(repo).as_posix(),
            "id": data.get("id") or f"{manifest.parent.parent.name}/{manifest.parent.name}",
            "source": legacy.get("source"),
            "fbeVersion": legacy.get("fbeVersion"),
            "name": data.get("name", {}),
        })
    return out


def diff_class(old: Original, new: Original) -> dict:
    import difflib

    matcher = difflib.SequenceMatcher(None, old.lines, new.lines, autojunk=False)
    changed = sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in matcher.get_opcodes() if tag != "equal")
    percent = changed / max(1, max(len(old.lines), len(new.lines)))
    if changed == 0:
        cls = "identical"
    elif percent < 0.05:
        cls = "small"
    elif percent < 0.30:
        cls = "moderate"
    else:
        cls = "major"
    return {"class": cls, "changedLines": changed, "percent": round(percent * 100, 1)}


def pair_successors(old: dict[str, Original], new: dict[str, Original],
                    overrides: dict[str, str | None]) -> dict[str, dict]:
    """The 2.7.9 successor of every 2.7beta1 script: the same name first (in any group: a
    moved script keeps its name), else the most similar code (a renamed script keeps most of
    it; 4-gram Jaccard similarity at least 0.3), else none. The review's overrides win."""
    pairs: dict[str, dict] = {}
    for rel, script in old.items():
        if rel in overrides:
            target = overrides[rel]
            if target is not None and target not in new:
                raise SystemExit(f"{OVERRIDES}: {rel} -> {target}: no such 2.7.9 script")
            pairs[rel] = {"successor": target, "method": "review",
                          "similarity": round(similarity(script, new[target]), 3) if target else 0.0}
            continue
        same_name = [n for n in new.values() if n.key == script.key]
        if same_name:
            best = max(same_name, key=lambda n: similarity(script, n))
            pairs[rel] = {"successor": best.rel, "method": "name",
                          "similarity": round(similarity(script, best), 3)}
            continue
        scores = {n.rel: similarity(script, n) for n in new.values()}
        top = max(scores.values())
        if top < 0.30:
            pairs[rel] = {"successor": None, "method": "none", "similarity": round(top, 3)}
            continue
        # Siblings often share nearly all their code (the variants of "add a note"): among the
        # close candidates the name decides - its words' stems, then the same position.
        close = [n for n in new.values() if scores[n.rel] >= max(0.30, top - 0.15)]
        best = max(close, key=lambda n: (name_overlap(script, n) + same_position(script, n) * 0.05
                                         + scores[n.rel]))
        pairs[rel] = {"successor": best.rel, "method": "code", "similarity": round(scores[best.rel], 3)}
    return pairs


def name_stems(rel: str) -> set[str]:
    return {word[:4] for word in re.findall(r"\w+", name_key(rel)) if len(word) > 2}


def name_overlap(a: Original, b: Original) -> float:
    sa, sb = name_stems(a.rel), name_stems(b.rel)
    return len(sa & sb) / max(1, len(sa | sb))


def same_position(a: Original, b: Original) -> bool:
    order_a, _ = split_order(Path(a.rel).stem)
    order_b, _ = split_order(Path(b.rel).stem)
    return order_a is not None and order_a == order_b


def suggested_package(rel: str) -> tuple[str | None, str | None, dict]:
    """The package folder and id a new 2.7.9 script would get (conversion rule 2), with drafted
    names: scripts/<group folder>/<NN>_<english slug>, id <group NN>/<slug>."""
    parts = rel.split("/")
    order, name_ru = split_order(Path(parts[-1]).stem)
    name_ru = re.sub(r"[\s.…]+$", "", name_ru)
    name_en, _draft = draft_english(name_ru)
    script_slug = slug(name_en)[:48].strip("-") or "script"
    if len(parts) == 1:
        return None, None, {"ru": name_ru, "en": name_en}
    group_order, _ = split_order(parts[0])
    if parts[0] == "TreeCmd" or group_order not in GROUP_FOLDERS_279:
        return None, None, {"ru": name_ru, "en": name_en}
    folder = GROUP_FOLDERS_279[group_order]
    prefix = f"{order:02d}_" if order is not None else ""
    return (f"scripts/{folder}/{prefix}{script_slug}", f"{group_order:02d}/{script_slug}",
            {"ru": name_ru, "en": name_en})


def recheck(source: Path, baseline: Path, out: Path, repo: Path, skeletons: bool) -> int:
    new = load_originals(source)
    old = load_originals(baseline)
    overrides_path = out / OVERRIDES
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
    overrides = {k: v for k, v in overrides.items() if not k.startswith("_")}
    pairs = pair_successors(old, new, overrides)
    packages = our_packages(repo)
    # A package names the original it was converted from: a 2.7beta1 script, or - once
    # converted or updated from 2.7.9 - a 2.7.9 one.
    by_new = {p["source"]: p for p in packages if p["source"] and p["fbeVersion"] == "2.7.9"}
    by_source = {p["source"]: p for p in packages if p["source"] and p["fbeVersion"] != "2.7.9"}
    for rel, pair in pairs.items():
        successor = pair["successor"]
        if rel not in by_source and successor in by_new and successor not in {
            pairs[r]["successor"] for r in by_source
        }:
            by_source[rel] = by_new[successor]  # updated to its 2.7.9 version already
    converted = {rel for rel in old if rel in by_source}
    dropped = sorted(rel for rel in old if rel not in by_source)

    # Converted predecessors of each 2.7.9 script; the most similar one is its predecessor, the
    # others are merged into it (2.7.9 kept one of them).
    predecessors: dict[str, list[str]] = {}
    for rel in sorted(converted):
        successor = pairs[rel]["successor"]
        if successor:
            predecessors.setdefault(successor, []).append(rel)
    for successor, rels in predecessors.items():
        rels.sort(key=lambda r: -similarity(old[r], new[successor]))
    dropped_successors = {pairs[r]["successor"]: r for r in dropped if pairs[r]["successor"]}

    entries: list[dict] = []
    recheck_rows: list[dict] = []
    authors: dict[str, list[str]] = {}
    for rel, script in new.items():
        package_dir, package_id, names = suggested_package(rel)
        entry = {
            "source": rel,
            "fbeVersion": "2.7.9",
            "sourceVersion": header_version(script.text),
            "sha256": script.sha256,
            "group": script.group,
            "names": names,
            "icon": (script.path.with_suffix(".ico")).exists(),
            "encoding": script.encoding,
            "capabilities": capabilities(script.text),
            "htmlDialogs": sorted({m.group(1) for m in HTML_REF_RE.finditer(script.text)}),
            "package": None,
            "id": None,
            "status": "new",
            "predecessor": None,
            "differences": [],
            "fixes": [],
            "openQuestions": [],
        }
        for name in author_candidates(script.text):
            authors.setdefault(name, []).append(rel)
        if rel in predecessors:
            first = predecessors[rel][0]
            package = by_source[first]
            stats = diff_class(old[first], script)
            entry.update({
                "package": package["package"], "id": package["id"], "predecessor": first,
                "status": "unchanged" if stats["class"] == "identical" else "recheck",
                "recheck": stats,
            })
            recheck_rows.append({"package": package["package"], "id": package["id"],
                                 "predecessor": first, "successor": rel,
                                 "method": pairs[first]["method"],
                                 "similarity": pairs[first]["similarity"], **stats})
        elif rel in dropped_successors:
            entry.update({
                "status": "notConverted", "predecessor": dropped_successors[rel],
                "reason": "dropped in the conversion of 2.7beta1; to be re-examined under "
                          "FR-024 with script API version 2 (T069)",
            })
        elif rel in by_new:
            entry.update({"package": by_new[rel]["package"], "id": by_new[rel]["id"]})
        else:
            entry.update({"suggestedPackage": package_dir, "suggestedId": package_id})
        entries.append(entry)
    # Converted packages whose script has no 2.7.9 successor of its own: removed in 2.7.9, or
    # merged into a successor another package already represents.
    for rel in sorted(converted):
        successor = pairs[rel]["successor"]
        if successor and predecessors.get(successor, [None])[0] == rel:
            continue
        package = by_source[rel]
        entry = {
            "source": rel, "fbeVersion": "2.7", "sourceVersion": header_version(old[rel].text),
            "sha256": old[rel].sha256, "group": old[rel].group, "names": package["name"],
            "package": package["package"], "id": package["id"], "status": "noCounterpart",
            "predecessor": None, "differences": [], "fixes": [], "openQuestions": [],
        }
        if successor:
            entry["mergedInto"] = successor
        entries.append(entry)
        recheck_rows.append({"package": package["package"], "id": package["id"],
                             "predecessor": rel, "successor": successor,
                             "method": pairs[rel]["method"],
                             "similarity": pairs[rel]["similarity"],
                             "class": "merged" if successor else "noCounterpart"})

    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["status"]] = counts.get(entry["status"], 0) + 1
    summary = {
        "scripts279": len(new),
        "new": counts.get("new", 0),
        "successors": counts.get("unchanged", 0) + counts.get("recheck", 0),
        "successorsOfDropped": len(dropped_successors),
        "noCounterpart": counts.get("noCounterpart", 0),
        "byStatus": dict(sorted(counts.items())),
        "recheckClasses": {cls: sum(1 for r in recheck_rows if r.get("class") == cls)
                           for cls in ("identical", "small", "moderate", "major", "merged", "noCounterpart")},
    }
    out.mkdir(parents=True, exist_ok=True)
    inventory = {
        "_about": "One entry per FictionBook Editor 2.7.9 script and per converted package without "
                  "a 2.7.9 successor (data-model §7.4 of feature 007). Written by "
                  "tools/legacy-script-audit.py --recheck, completed by hand during the "
                  "conversion; read by tests/scripts/run-all.mjs and "
                  "tools/release-notes-scripts.py. Status 'recheck' marks a converted package "
                  "whose 2.7.9 successor differs and is not rechecked yet (US4 turns it into "
                  "updated, unchanged or kept).",
        "counts": summary,
        "entries": entries,
    }
    inventory_path = out / INVENTORY
    if inventory_path.exists():
        merge_manual_fields(inventory, json.loads(inventory_path.read_text(encoding="utf-8")))
    inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / RECHECK).write_text(json.dumps({
        "_about": "The pairing of each converted package with its FictionBook Editor 2.7.9 "
                  "successor and the class of the change (code without comments and layout; "
                  "small < 5 % of the lines, moderate < 30 %, major otherwise). "
                  "tools/legacy-script-audit.py --diff <package> prints a pair's diff.",
        "dropped2_7beta1": [{"source": r, "successor": pairs[r]["successor"]} for r in dropped],
        "pairs": recheck_rows,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Author names found in the headers of the FictionBook Editor 2.7.9 scripts",
             "# (tools/legacy-script-audit.py --recheck): candidates for CONTRIBUTORS.txt, to be",
             "# reviewed by hand. <name> <TAB> <scripts> <TAB> <first script>"]
    for name, rels in sorted(authors.items(), key=lambda item: (-len(item[1]), item[0].lower())):
        lines.append(f"{name}\t{len(rels)}\t{rels[0]}")
    (out / AUTHORS).write_text("\n".join(lines) + "\n", encoding="utf-8")
    if skeletons:
        write_skeletons_279(source, new, entries, out / SKELETONS_279)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


# The statuses the tool itself decides; every other status was recorded by hand.
GENERATED_STATUSES = {"new", "recheck", "unchanged", "notConverted", "noCounterpart"}


def merge_manual_fields(fresh: dict, previous: dict) -> None:
    """Keeps what the conversion recorded by hand for every entry the regenerated inventory still
    has: the differences, fixes, open questions, reasons and notes, a status the tool does not
    decide (updated, kept) or a reason given for one it does, and a package the scan no longer
    finds. The scan's own findings - the packages it finds, its verdicts - are always fresh."""
    earlier = {(e["source"], e["fbeVersion"]): e for e in previous.get("entries", [])}
    for entry in fresh["entries"]:
        before = earlier.get((entry["source"], entry["fbeVersion"]))
        if not before:
            continue
        for key in ("differences", "fixes", "openQuestions", "reason", "needs", "notes"):
            if before.get(key):
                entry[key] = before[key]
        if before.get("status") not in GENERATED_STATUSES:
            entry["status"] = before["status"]
        if before.get("status") == "notConverted" and before.get("needs"):
            entry["status"] = "notConverted"
        if not entry.get("package") and before.get("package"):
            entry["package"], entry["id"] = before["package"], before.get("id")


def write_skeletons_279(source: Path, new: dict[str, Original], entries: list[dict], root: Path) -> None:
    """Starting points for the conversion of the new 2.7.9 scripts: per group its names and
    16 x 16 icon, per new script a script.json with legacy and drafted names, an index.js
    quoting the original's header and the original's icon as icon.png."""
    import shutil

    if root.exists():
        shutil.rmtree(root)
    icons = 0
    scripts_dir = source / "Scripts"
    for group_icon in sorted(scripts_dir.glob("*.ico")):
        group = group_icon.stem
        order, name_ru = split_order(group)
        folder = GROUP_FOLDERS_279.get(order or -1, slug(name_ru))
        group_dir = root / folder
        group_dir.mkdir(parents=True, exist_ok=True)
        (group_dir / "group.json").write_text(json.dumps(
            {"names": {"ru": name_ru, "en": draft_english(name_ru)[0], "uk": ""},
             "icon": "icon.png", "legacy": group}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        png = ico_to_png(group_icon.read_bytes())
        if png:
            (group_dir / "icon.png").write_bytes(png)
            icons += 1
    for entry in entries:
        if entry["fbeVersion"] != "2.7.9" or entry["status"] != "new" or not entry.get("suggestedPackage"):
            continue
        script = new[entry["source"]]
        target = root / entry["suggestedPackage"].split("/", 1)[1]
        target.mkdir(parents=True, exist_ok=True)
        manifest = {
            "manifestVersion": 1,
            "id": entry["suggestedId"],
            "name": {"ru": entry["names"]["ru"], "en": entry["names"]["en"], "uk": ""},
            "description": {"ru": "", "en": "", "uk": ""},
            "kind": "menu",
            "undoLabel": {"ru": entry["names"]["ru"], "en": entry["names"]["en"]},
            "legacy": {"source": entry["source"], "fbeVersion": "2.7.9",
                       **({"sourceVersion": entry["sourceVersion"]} if entry["sourceVersion"] else {})},
        }
        icon = script.path.with_suffix(".ico")
        if icon.exists():
            png = ico_to_png(icon.read_bytes())
            if png:
                (target / "icon.png").write_bytes(png)
                manifest["icon"] = "icon.png"
                icons += 1
        (target / "script.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        header = "\n".join(line for line in script.text.splitlines()[:30] if line.strip().startswith("//"))
        (target / "index.js").write_text(
            f"// Converted from FictionBook Editor 2.7.9: Scripts/{entry['source']}\n"
            "// The original's notice, kept as written (FR-029):\n"
            f"{header}\n\nexport default async function run(ctx) {{\n  // TODO: convert\n}}\n",
            encoding="utf-8")
    print(f"skeletons-279: {icons} icons converted -> {root}")


def print_diff(target: str, source: Path, baseline: Path, out: Path) -> int:
    """The diff between a converted package's 2.7beta1 original and its 2.7.9 successor."""
    import difflib

    report = json.loads((out / RECHECK).read_text(encoding="utf-8"))
    for row in report["pairs"]:
        if target in (row["package"], row["id"], row["predecessor"], row.get("successor")):
            if not row.get("successor"):
                print(f"{row['package']}: no 2.7.9 successor ({row['class']})")
                return 0
            old_path = (baseline / "Scripts" / row["predecessor"]) if not row["predecessor"].startswith("TreeCmd/") else baseline / row["predecessor"]
            new_path = (source / "Scripts" / row["successor"]) if not row["successor"].startswith("TreeCmd/") else source / row["successor"]
            old_text = decode_text(old_path.read_bytes())[0].splitlines()
            new_text = decode_text(new_path.read_bytes())[0].splitlines()
            sys.stdout.writelines(line + "\n" for line in difflib.unified_diff(
                old_text, new_text, f"2.7beta1/{row['predecessor']}", f"2.7.9/{row['successor']}",
                lineterm=""))
            return 0
    print(f"legacy-script-audit: no pair for {target} in {out / RECHECK}", file=sys.stderr)
    return 1


UPDATES = "updates-279"


def apply_updates(out: Path) -> int:
    """Folds the inventory updates a conversion left in updates-279/<group>.json into
    inventory-279.json, recounts the statuses and removes the update files. An update file holds
    a list of objects naming an entry by `source` and `fbeVersion` ("2.7.9", or "2.7" for a
    package without a 2.7.9 successor) and the fields to set; an unknown entry is an error and
    nothing is written."""
    folder = out / UPDATES
    files = sorted(folder.glob("*.json")) if folder.is_dir() else []
    if not files:
        print(f"legacy-script-audit: no updates in {folder}")
        return 0
    inventory_path = out / INVENTORY
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    by_key = {(e["source"], e["fbeVersion"]): e for e in inventory["entries"]}
    applied = 0
    for update_file in files:
        for change in json.loads(update_file.read_text(encoding="utf-8")):
            key = (change.get("source"), change.get("fbeVersion", "2.7.9"))
            entry = by_key.get(key)
            if entry is None:
                print(f"legacy-script-audit: {update_file.name}: no inventory entry {key}", file=sys.stderr)
                return 1
            for field_name, value in change.items():
                if field_name not in ("source", "fbeVersion"):
                    entry[field_name] = value
            if entry.get("package"):
                entry.pop("suggestedPackage", None)
                entry.pop("suggestedId", None)
            applied += 1
    counts: dict[str, int] = {}
    for entry in inventory["entries"]:
        counts[entry["status"]] = counts.get(entry["status"], 0) + 1
    inventory["counts"]["byStatus"] = dict(sorted(counts.items()))
    inventory["counts"]["converted"] = sum(
        1 for e in inventory["entries"] if e["fbeVersion"] == "2.7.9" and e.get("package"))
    inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for update_file in files:
        update_file.unlink()
    print(f"legacy-script-audit: {applied} updates from {len(files)} file(s) applied; by status {counts}")
    return 0


# Five pairs the pairing must find (T018): renames across a renamed group among siblings that
# share their code, a rename in place, and unchanged names.
SELF_TEST_PAIRS = {
    "02_Добавление примечания/01_Добавить сноску, оставшись на ее ссылке.js":
        "02_Примечания/01_Добавить примечание, остаться на его ссылке.js",
    "02_Добавление примечания/05_Добавить последнюю сноску, оставшись на ее ссылке.js":
        "02_Примечания/04_Добавить последнее примечание, остаться на его ссылке.js",
    "01_Регистр/01_Верхний регистр.js": "01_Регистр/01_В верхний регистр.js",
    "06_Чистка/03_Латиница в Кириллице.js": "06_Чистка/03_Латиница в Кириллице.js",
    "TreeCmd/Пример 1.js": "TreeCmd/Пример 1.js",
}


def self_test(source: Path, baseline: Path) -> int:
    new = load_originals(source)
    old = load_originals(baseline)
    failures = 0
    for before, expected in SELF_TEST_PAIRS.items():
        if before not in old:
            print(f"self-test: {before} is not a 2.7beta1 script", file=sys.stderr)
            failures += 1
            continue
        got = pair_successors({before: old[before]}, new, {})[before]
        status = "ok" if got["successor"] == expected else "FAIL"
        if status == "FAIL":
            failures += 1
        print(f"self-test: {status} {before} -> {got['successor']} ({got['method']}, {got['similarity']})")
    assert name_key("01_Регистр/08_Регистр заголовков и подзаголовков....js") == "регистр заголовков и подзаголовков"
    assert header_version('var NumerusVersion="1.4";') == "1.4"
    assert header_version("// Версия 1.3 (август 2025), автор: stokber") == "1.3"
    assert code_lines("a = 1; // note\n/* block */ b = 'http://x'\n") == ["a = 1;", "b = 'http://x'"]
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="FBE/files folder (contains Scripts/ and TreeCmd/)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder (default tests/scripts/audit)")
    parser.add_argument("--no-skeletons", action="store_true", help="only write the plan and the summary")
    parser.add_argument("--recheck", action="store_true",
                        help="feature 007: pair the converted packages with the scripts of --source "
                             "(FictionBook Editor 2.7.9), classify the changes, write "
                             f"{INVENTORY}, {RECHECK}, {AUTHORS} and {SKELETONS_279}/")
    parser.add_argument("--baseline", type=Path,
                        default=DEFAULT_SOURCE,
                        help="with --recheck: the files folder of the release the packages were "
                             "converted from (2.7beta1)")
    parser.add_argument("--diff", metavar="PACKAGE",
                        help="with the recheck report: print the diff of a package's original "
                             "and its 2.7.9 successor (package folder, id or source path)")
    parser.add_argument("--self-test", action="store_true",
                        help="check the pairing on five known pairs (needs both reference trees)")
    parser.add_argument("--apply-updates", action="store_true",
                        help=f"fold {UPDATES}/*.json (one per converted group) into {INVENTORY}")
    args = parser.parse_args(argv)
    if args.apply_updates:
        return apply_updates(args.out)
    if args.recheck or args.diff or args.self_test:
        if args.source == DEFAULT_SOURCE:
            args.source = DEFAULT_SOURCE_279
        for folder in (args.source, args.baseline):
            if not (folder / "Scripts").is_dir():
                print(f"legacy-script-audit: {folder / 'Scripts'} not found", file=sys.stderr)
                return 2
        if args.self_test:
            return self_test(args.source, args.baseline)
        if args.diff:
            return print_diff(args.diff, args.source, args.baseline, args.out)
        return recheck(args.source, args.baseline, args.out, REPO_ROOT, not args.no_skeletons)
    if not (args.source / "Scripts").is_dir():
        print(f"legacy-script-audit: {args.source / 'Scripts'} not found", file=sys.stderr)
        return 2
    entries, problems = audit(args.source)
    write_outputs(entries, problems, args.source, args.out, not args.no_skeletons)
    tiers = {t: sum(1 for e in entries if e.tier == t) for t in (1, 2, 3, 4)}
    drafts = sum(1 for e in entries if e.name_en_draft)
    encodings: dict[str, int] = {}
    for e in entries:
        encodings[e.encoding] = encodings.get(e.encoding, 0) + 1
    print(
        f"{len(entries)} scripts: tier 1 = {tiers[1]}, tier 2 = {tiers[2]}, tier 3 = {tiers[3]}, tier 4 = {tiers[4]}; "
        f"{drafts} English names need review; encodings {encodings}; plan -> {args.out / 'conversion-plan.json'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
