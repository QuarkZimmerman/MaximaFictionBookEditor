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



def _public_entry(entry: dict) -> dict:
    """Plan entry as written to disk: file-derived paths carry no author tags."""
    icon = entry.get("icon")
    if isinstance(icon, str) and icon:
        stem, _, ext = icon.rpartition(".")
        entry["icon"] = anonymise_name(stem) + ("." + ext if ext else "")
    return entry


def anonymise_name(name: str) -> str:
    """Drops author tags from legacy file names: `_nick` suffixes and `(... от nick, nick ...)`
    lists. The project ships no personal names or nicknames anywhere."""
    name = re.sub(r"\s*\((?:регекспы|регэкспы|рег\w*)\s+от\s+[^)]*\)", " (набор регэкспов)", name)
    name = re.sub(r"_[A-Za-z][A-Za-z0-9]{2,}$", "", name)
    return name.strip()


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
            source_rel = anonymise_name(str(rel.with_suffix(""))) + file.suffix
        stem = anonymise_name(file.stem)
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
        "entries": [_public_entry(asdict(e)) for e in entries],
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


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="FBE/files folder (contains Scripts/ and TreeCmd/)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder (default tests/scripts/audit)")
    parser.add_argument("--no-skeletons", action="store_true", help="only write the plan and the summary")
    args = parser.parse_args(argv)
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
