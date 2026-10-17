#!/usr/bin/env python3
r"""Build ukr-glossary.tsv: the user-visible strings of the original FictionBook
Editor 2.7 resource scripts, paired Russian / Ukrainian / English by resource id.

The original editor shipped a Russian and a Ukrainian resource DLL. The Ukrainian
interface of Maxima Fiction Book Editor must reuse that Ukrainian wording wherever
the original had the string, so translators need the Russian and Ukrainian texts
side by side under a stable id.

Inputs (read-only; the reference checkout of the original sources, root --ref,
default /root/maxfbeditor/reference/fictionbookeditor/FBE):

  FBE.rc                    English main resource script (strings in its
                            Windows-1252 block; the Windows-1251 block holds only a
                            TEXTINCLUDE)
  locales/res_rus/FBE.rc    Russian resource DLL script (Windows-1251)
  locales/res_ukr/FBE.rc    Ukrainian resource DLL script (Windows-1251)
  resource.h next to each   numeric values of the symbolic ids; used only to pair
                            string-table entries whose symbol differs between the
                            files although it is the same resource (English
                            IDS_SPELL_COMPLETED = Ukrainian IDS_SPELL_CHECK_COMPLETED
                            = 275). Ids declared elsewhere (wtl/atlres.h: ID_FILE_NEW,
                            IDCANCEL ...) pair by symbol.

Encoding: a UTF-16 or UTF-8 byte-order mark wins; otherwise the file is decoded line
by line with the code page of the last "#pragma code_page(N)" seen (Windows-1252
before the first pragma), which is what rc.exe does.

What is extracted (scope -> id):

  stringtable  STRINGTABLE entries, id = the symbol or number as written
               (IDS_SETTINGS_NEED_RESTART, ID_FILE_OPEN, 60161). Command prompts keep
               their MFC form "status bar text\ntooltip" as one string.
  menu         MENUITEM texts, id = the command id (ID_FILE_OPEN). When one file uses
               the same command id for several items (placeholders such as IDCANCEL)
               the 2nd, 3rd ... occurrence in file order get the suffix "#2", "#3" ...
  popup        POPUP titles, id = POPUP:<menu resource id>/<path>, <path> = 0-based
               index of the popup among the POPUP entries of its level, nested levels
               separated by "/": POPUP:IDR_MAINFRAME/0 is the first top-level popup
               ("&File"), POPUP:IDR_MAINFRAME/0/2 its third sub-popup ("&Recent Files").
  caption      dialog CAPTION, id = DIALOG:<dialog id>:CAPTION.
  control      texts of LTEXT, RTEXT, CTEXT, PUSHBUTTON, DEFPUSHBUTTON, CONTROL,
               GROUPBOX, CHECKBOX, RADIOBUTTON, AUTOCHECKBOX, AUTORADIOBUTTON,
               AUTO3STATE, STATE3, PUSHBOX; id = <dialog id>:<control id>. Controls
               with the id IDC_STATIC / -1 get <dialog id>:STATIC:<n>, n = 1-based
               position among the static controls of the dialog in order of
               appearance (textless statics count too). A repeated non-static id gets
               "#2", "#3" ... like menu items.

Popup paths and static numbers pair across the files only because the three scripts
share one structure (true for the Russian and Ukrainian 2.7 scripts, which are
identical apart from the texts; the English dialogs list a few statics in another
order, so the en column of STATIC rows is a hint only - the summary names the dialogs
concerned and everything that did not pair).
Empty texts and non-UI resources (VERSIONINFO, TEXTINCLUDE, DESIGNINFO,
AFX_DIALOG_LAYOUT, TOOLBAR, ACCELERATORS, ICON / BITMAP / CURSOR file names, TYPELIB,
user-defined resources) are ignored. String syntax handled: doubled quotes "", the
escapes \n \t \r \a \\ \" plus octal and hex escapes, backslash-newline continuation,
the L"..." prefix, // and /* */ comments, statements continued over several lines.
Mnemonic ampersands ("&File") and accelerator suffixes ("\tCtrl+O") are kept.

Output (UTF-8, LF): --out, default ukr-glossary.tsv next to this script. First line
"id<TAB>scope<TAB>ru<TAB>uk<TAB>en", then one row per id present in the Ukrainian or
the Russian file (empty cell when a language lacks it; ids found only in the English
file are reported, not written), sorted by scope, then id (digit runs compared
numerically). Inside a cell a backslash, tab, newline and carriage return are written
as the two characters \\, \t, \n, \r. Unchanged inputs give a byte-identical file.

The script prints a summary (strings per file and LANGUAGE block, rows per scope, how
many ids have both ru and uk, which lack one of them, English-only ids, every oddity
met while parsing) and exits non-zero when the Ukrainian file yields fewer than 200
strings or a file cannot be decoded.

Usage:
  python3 tools/resources-import/extract_ukr_strings.py
      [--ref /path/to/fictionbookeditor/FBE]
      [--en FBE.rc] [--ru locales/res_rus/FBE.rc] [--uk locales/res_ukr/FBE.rc]
      [--out tools/resources-import/ukr-glossary.tsv]
"""
import argparse
import codecs
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

DEFAULT_REF = "/root/maxfbeditor/reference/fictionbookeditor/FBE"
MIN_UK_STRINGS = 200

# Dialog statements whose first field is the visible text.
TEXT_CONTROLS = {
    "LTEXT", "RTEXT", "CTEXT", "PUSHBUTTON", "DEFPUSHBUTTON", "CONTROL", "GROUPBOX",
    "CHECKBOX", "RADIOBUTTON", "AUTOCHECKBOX", "AUTORADIOBUTTON", "AUTO3STATE", "STATE3",
    "PUSHBOX",
}
# ICON's first field is an icon resource, not text; the others start with the id.
ICON_CONTROL = "ICON"
ID_FIRST_CONTROLS = {"EDITTEXT", "COMBOBOX", "LISTBOX", "SCROLLBAR"}
# Statements allowed between a resource header and its BEGIN (dialog options and the
# fixed part of VERSIONINFO).
HEADER_OPTIONS = {
    "STYLE", "EXSTYLE", "CAPTION", "FONT", "MENU", "CLASS", "LANGUAGE", "CHARACTERISTICS",
    "VERSION", "FILEVERSION", "PRODUCTVERSION", "FILEFLAGSMASK", "FILEFLAGS", "FILEOS",
    "FILETYPE", "FILESUBTYPE",
}
STATIC_IDS = {"IDC_STATIC", "-1", "65535", "0xFFFF", "0xffff"}

TOKEN_RE = re.compile(
    r"""
      (?P<nl>\n)
    | (?P<skip>[ \t\r\f\v]+|//[^\n]*|/\*.*?\*/|(?m:^[ \t]*\#[^\n]*))
    | (?P<str>L?"(?:[^"\\\n]|\\.|"")*")
    | (?P<word>[A-Za-z_][A-Za-z0-9_]*|-?(?:0[xX][0-9A-Fa-f]+|[0-9]+)[lL]?)
    | (?P<punct>.)
    """,
    re.VERBOSE | re.DOTALL,
)
SIMPLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "a": "\a", "\\": "\\", '"': '"'}


def parse_int(s):
    """Integer of a C / rc numeric literal (decimal, 0x hex, leading-0 octal); None if not one."""
    m = re.fullmatch(r"(-?)(0[xX][0-9A-Fa-f]+|0[0-7]*|[1-9][0-9]*)[lL]?", s.strip())
    if not m:
        return None
    sign, digits = m.groups()
    base = 16 if digits[:2].lower() == "0x" else 8 if len(digits) > 1 and digits[0] == "0" else 10
    return -int(digits, base) if sign else int(digits, base)


@dataclass
class Entry:
    scope: str
    key: str        # the id written to the glossary
    text: str
    line: int
    language: str
    join: object    # pairing key within the scope (numeric value or the symbol)
    kind: str = ""  # statement keyword (LTEXT, GROUPBOX ...) of a control


# --- decoding -----------------------------------------------------------------

def decode_rc(data):
    """Decode a resource script the way rc.exe would; return (text, description)."""
    if data.startswith(codecs.BOM_UTF16_LE) or data.startswith(codecs.BOM_UTF16_BE):
        return data.decode("utf-16"), "utf-16 (BOM)"
    if data.startswith(codecs.BOM_UTF8):
        return data[len(codecs.BOM_UTF8):].decode("utf-8"), "utf-8 (BOM)"
    pragma = re.compile(rb"^\s*#pragma\s+code_page\s*\(\s*(\w+)\s*\)")
    encoding, seen, lines = "cp1252", [], []
    for number, raw in enumerate(data.split(b"\n"), 1):
        m = pragma.match(raw)
        if m:
            arg = m.group(1).decode("ascii")
            if arg.upper() == "DEFAULT":
                encoding = "cp1252"
            elif arg == "65001":
                encoding = "utf-8"
            else:
                encoding = "cp" + arg
            seen.append(f"{arg} (line {number})")
        lines.append(raw.decode(encoding))
    return "\n".join(lines), "8-bit; code_page pragmas: " + (", ".join(seen) or "none")


def read_defines(path):
    """name -> int for the simple #define lines of a resource.h (missing file -> {})."""
    if not path.is_file():
        return {}
    text = path.read_bytes().decode("latin-1")  # ids are ASCII, comments may be anything
    raw = {}
    for m in re.finditer(r"^\s*#define\s+([A-Za-z_]\w*)[ \t]+(.+?)[ \t]*(?://.*)?$", text, re.M):
        raw[m.group(1)] = m.group(2).strip()

    def value(expr, depth=0):
        expr = expr.strip()
        while expr.startswith("(") and expr.endswith(")"):
            expr = expr[1:-1].strip()
        n = parse_int(expr)
        if n is not None:
            return n
        if expr in raw and depth < 8:
            return value(raw[expr], depth + 1)
        return None

    out = {}
    for name, expr in raw.items():
        n = value(expr)
        if n is not None:
            out[name] = n
    return out


# --- tokens and statements ------------------------------------------------------

def tokenize(text):
    """Yield (kind, value, line) with kind in nl / str / word / punct."""
    line = 1
    for m in TOKEN_RE.finditer(text):
        kind = m.lastgroup
        value = m.group()
        if kind == "nl":
            yield ("nl", value, line)
            line += 1
        elif kind == "skip":
            line += value.count("\n")  # block comments may span lines
        else:
            yield (kind, value, line)
            line += value.count("\n")  # backslash-newline inside a string


def statements(tokens):
    """Group tokens into statements.

    A statement ends at a newline unless the line ends with "," or "|" or the next
    line starts with a string (two-line CONTROL statements, string-table entries whose
    string sits on the line after the id). BEGIN / END (or { / }) always form a
    statement of their own.
    """
    tokens = list(tokens)
    cur, i, n = [], 0, len(tokens)
    while i < n:
        kind, value, line = tokens[i]
        if kind == "nl":
            if cur:
                j = i + 1
                while j < n and tokens[j][0] == "nl":
                    j += 1
                last_kind, last_value, _ = cur[-1]
                continues = (last_kind == "punct" and last_value in ",|") or (
                    j < n and tokens[j][0] == "str")
                if not continues:
                    yield cur
                    cur = []
            i += 1
            continue
        if (kind == "word" and value in ("BEGIN", "END")) or (kind == "punct" and value in "{}"):
            if cur:
                yield cur
                cur = []
            yield [("word", "BEGIN" if value in ("BEGIN", "{") else "END", line)]
            i += 1
            continue
        cur.append(tokens[i])
        i += 1
    if cur:
        yield cur


def is_word(token, *values):
    return token[0] == "word" and (not values or token[1] in values)


def unescape(literal):
    """Decode an .rc string literal (with quotes, optional L prefix)."""
    s = literal[2:-1] if literal.startswith("L") else literal[1:-1]
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c == '"':                    # doubled quote
            out.append('"')
            i += 2
            continue
        if c != "\\" or i + 1 >= n:
            out.append(c)
            i += 1
            continue
        e = s[i + 1]
        if e == "\n":                   # line continuation
            i += 2
        elif e in SIMPLE_ESCAPES:
            out.append(SIMPLE_ESCAPES[e])
            i += 2
        elif e in "01234567":
            m = re.match(r"[0-7]{1,3}", s[i + 1:])
            out.append(chr(int(m.group(), 8)))
            i += 1 + len(m.group())
        elif e in "xX" and re.match(r"[0-9A-Fa-f]", s[i + 2:i + 3]):
            m = re.match(r"[0-9A-Fa-f]{1,2}", s[i + 2:])
            out.append(chr(int(m.group(), 16)))
            i += 2 + len(m.group())
        else:                           # unknown escape: keep both characters
            out.append(c)
            i += 1
    return "".join(out)


def fields(tokens):
    """Split statement tokens (after the keyword) at top-level commas."""
    result, cur, depth = [], [], 0
    for t in tokens:
        if t[0] == "punct" and t[1] == "(":
            depth += 1
        elif t[0] == "punct" and t[1] == ")":
            depth -= 1
        if t[0] == "punct" and t[1] == "," and depth == 0:
            result.append(cur)
            cur = []
        else:
            cur.append(t)
    result.append(cur)
    return result


def field_id(field):
    """Textual form of an id field: IDC_STATIC, -1, (IDC_BASE+1) -> IDC_BASE+1."""
    return "".join(t[1] for t in field).strip("()") if field else None


# --- one resource script ----------------------------------------------------------

class RcFile:
    def __init__(self, label, path):
        self.label = label
        self.path = Path(path)
        self.entries = []
        self.by_join = {}            # (scope, join) -> Entry
        self.key_counts = Counter()  # (scope, base key) -> occurrences
        self.lang_counts = Counter()
        self.skipped_types = Counter()
        self.empty_texts = 0
        self.issues = []
        self.encoding = ""

    def issue(self, msg):
        self.issues.append(f"{self.label} ({self.path.name}): {msg}")

    # -- collecting --

    def add(self, scope, key, text, line, language, join=None, kind=""):
        if text == "":
            self.empty_texts += 1
            return
        base = key
        self.key_counts[(scope, base)] += 1
        n = self.key_counts[(scope, base)]
        if n > 1:
            key = f"{base}#{n}"
            join = None
            self.issue(f"line {line}: {scope} id {base} occurs again - keyed {key}")
        if join is None:
            join = key
        entry = Entry(scope, key, text, line, language, join, kind)
        jk = (scope, join)
        if jk in self.by_join:
            other = self.by_join[jk]
            self.issue(f"line {line}: {scope} id {key} has the same value ({join}) as "
                       f"{other.key} (line {other.line}) - paired by symbol instead")
            entry.join = key
            jk = (scope, key)
        self.by_join[jk] = entry
        self.entries.append(entry)
        self.lang_counts[language] += 1
        for ch in text:
            if ord(ch) < 32 and ch not in "\t\n\r":
                self.issue(f"line {line}: {scope} id {key} contains control character "
                           f"U+{ord(ch):04X}")
                break

    # -- parsing --

    def parse(self, defines):
        data = self.path.read_bytes()
        text, self.encoding = decode_rc(data)
        stmts = list(statements(tokenize(text)))
        i, n = 0, len(stmts)
        language = "(no LANGUAGE statement)"
        while i < n:
            st = stmts[i]
            head = st[0]
            if not is_word(head):
                i += 1
                continue
            if is_word(head, "LANGUAGE"):
                language = " ".join(t[1] for t in st[1:] if t[0] == "word")
                i += 1
                continue
            if is_word(head, "BEGIN", "END"):
                self.issue(f"line {head[2]}: unexpected {head[1]} outside a resource")
                i += 1
                continue
            if head[1] in HEADER_OPTIONS:      # option of a single-line resource, re-read
                i += 1
                continue
            if is_word(head, "STRINGTABLE"):
                name, rtype = None, "STRINGTABLE"
            elif len(st) > 1 and is_word(st[1]):
                name, rtype = head[1], st[1][1]
            else:
                i += 1
                continue
            j = i + 1
            options = []
            while j < n and is_word(stmts[j][0]) and stmts[j][0][1] in HEADER_OPTIONS:
                options.append(stmts[j])
                j += 1
            if not (j < n and is_word(stmts[j][0], "BEGIN")):
                self.skipped_types[rtype] += 1   # single-line resource (ICON, BITMAP ...)
                i += 1
                continue
            depth, k = 0, j
            while k < n:
                if is_word(stmts[k][0], "BEGIN"):
                    depth += 1
                elif is_word(stmts[k][0], "END"):
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            if k >= n:
                self.issue(f"line {head[2]}: {rtype} {name or ''} has no matching END")
            body = stmts[j + 1:k]
            if rtype in ("MENU", "MENUEX"):
                self.parse_menu(name, body, language)
            elif rtype in ("DIALOG", "DIALOGEX"):
                self.parse_dialog(name, options, body, language)
            elif rtype == "STRINGTABLE":
                self.parse_stringtable(body, language, defines)
            else:
                self.skipped_types[rtype] += 1
            i = k + 1

    def parse_menu(self, menu, body, language):
        counts = [0]   # POPUPs seen so far on each open level
        path = []
        for st in body:
            head = st[0]
            if not is_word(head):
                continue
            if is_word(head, "BEGIN"):
                counts.append(0)
            elif is_word(head, "END"):
                if len(counts) > 1:
                    counts.pop()
                if path:
                    path.pop()
            elif is_word(head, "POPUP"):
                path.append(str(counts[-1]))
                counts[-1] += 1
                if len(st) > 1 and st[1][0] == "str":
                    self.add("popup", f"POPUP:{menu}/{'/'.join(path)}", unescape(st[1][1]),
                             head[2], language)
                else:
                    self.issue(f"line {head[2]}: POPUP without a text")
            elif is_word(head, "MENUITEM"):
                if len(st) > 1 and is_word(st[1], "SEPARATOR"):
                    continue
                parts = fields(st[1:])
                if not parts[0] or parts[0][0][0] != "str":
                    self.issue(f"line {head[2]}: MENUITEM without a text")
                    continue
                cmd = field_id(parts[1]) if len(parts) > 1 else None
                if not cmd:
                    self.issue(f"line {head[2]}: MENUITEM without a command id")
                    continue
                self.add("menu", cmd, unescape(parts[0][0][1]), head[2], language)
            else:
                self.issue(f"line {head[2]}: unknown menu statement {head[1]}")

    def parse_dialog(self, dialog, options, body, language):
        for st in options:
            if is_word(st[0], "CAPTION") and len(st) > 1 and st[1][0] == "str":
                self.add("caption", f"DIALOG:{dialog}:CAPTION", unescape(st[1][1]), st[0][2],
                         language)
        statics = 0
        for st in body:
            head = st[0]
            if not is_word(head):
                continue
            kind = head[1]
            parts = fields(st[1:])
            if kind in TEXT_CONTROLS or kind == ICON_CONTROL:
                first = parts[0][0] if parts[0] else None
                text = unescape(first[1]) if first and first[0] == "str" and kind != ICON_CONTROL \
                    else None
                ctl = field_id(parts[1]) if len(parts) > 1 else None
            elif kind in ID_FIRST_CONTROLS:
                text, ctl = None, field_id(parts[0])
            else:
                self.issue(f"line {head[2]}: unknown dialog statement {kind}")
                continue
            if not ctl:
                self.issue(f"line {head[2]}: {kind} without a control id")
                continue
            static = ctl in STATIC_IDS
            if static:
                statics += 1
            if text is None:
                continue
            key = f"{dialog}:STATIC:{statics}" if static else f"{dialog}:{ctl}"
            self.add("control", key, text, head[2], language, kind=kind)

    def parse_stringtable(self, body, language, defines):
        for st in body:
            head = st[0]
            if not is_word(head):
                self.issue(f"line {head[2]}: string-table entry does not start with an id")
                continue
            strings = [t for t in st if t[0] == "str"]
            if not strings:
                self.issue(f"line {head[2]}: string-table id {head[1]} without a string")
                continue
            if len(strings) > 1:
                self.issue(f"line {head[2]}: string-table id {head[1]} followed by "
                           f"{len(strings)} strings - first one used")
            sid = head[1]
            join = defines.get(sid)
            if join is None:
                join = parse_int(sid)
            if join is None:
                join = sid
            self.add("stringtable", sid, unescape(strings[0][1]), head[2], language, join)


# --- glossary ---------------------------------------------------------------------

def natural_key(s):
    return [(0, int(p)) if p.isdigit() else (1, p) for p in re.split(r"(\d+)", s)]


def tsv_escape(s):
    return (s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
            .replace("\r", "\\r"))


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ref", default=DEFAULT_REF,
                    help="root of the original FictionBook Editor FBE sources")
    ap.add_argument("--en", help="English main resource (default <ref>/FBE.rc)")
    ap.add_argument("--ru", help="Russian resource script (default <ref>/locales/res_rus/FBE.rc)")
    ap.add_argument("--uk", help="Ukrainian resource script (default <ref>/locales/res_ukr/FBE.rc)")
    ap.add_argument("--out", default=str(here / "ukr-glossary.tsv"))
    args = ap.parse_args()

    ref = Path(args.ref)
    files = {
        "ru": RcFile("ru", args.ru or ref / "locales" / "res_rus" / "FBE.rc"),
        "uk": RcFile("uk", args.uk or ref / "locales" / "res_ukr" / "FBE.rc"),
        "en": RcFile("en", args.en or ref / "FBE.rc"),
    }
    for rc in files.values():
        defines = read_defines(rc.path.parent / "resource.h")
        try:
            rc.parse(defines)
        except UnicodeDecodeError as exc:
            print(f"{rc.path}: cannot decode: {exc}", file=sys.stderr)
            return 2
        per_scope = Counter(e.scope for e in rc.entries)
        print(f"{rc.label}: {rc.path}")
        print(f"  encoding: {rc.encoding}; resource.h symbols: {len(defines)}")
        print("  strings: " + ", ".join(f"{s} {per_scope[s]}" for s in sorted(per_scope))
              + f"; total {len(rc.entries)}")
        print("  per LANGUAGE block: " + ", ".join(f"{k}: {v}" for k, v in rc.lang_counts.items()))
        print(f"  ignored: empty texts {rc.empty_texts}; other resources: "
              + ", ".join(f"{t} {c}" for t, c in sorted(rc.skipped_types.items())))

    ru, uk, en = files["ru"], files["uk"], files["en"]
    if len(uk.entries) < MIN_UK_STRINGS:
        print(f"ERROR: only {len(uk.entries)} Ukrainian strings extracted (expected at least "
              f"{MIN_UK_STRINGS}) - parser or encoding problem? Nothing written.", file=sys.stderr)
        return 1

    # --- pair ---------------------------------------------------------------
    joins = list(uk.by_join) + [jk for jk in ru.by_join if jk not in uk.by_join]
    rows = []
    symbol_differs = []
    for jk in joins:
        e_uk, e_ru, e_en = uk.by_join.get(jk), ru.by_join.get(jk), en.by_join.get(jk)
        ident = (e_uk or e_ru).key
        if e_uk and e_ru and e_uk.key != e_ru.key:
            symbol_differs.append(f"{jk[0]} {e_uk.key} (uk) = {e_ru.key} (ru), value {jk[1]}")
        rows.append((jk[0], ident, e_ru.text if e_ru else "", e_uk.text if e_uk else "",
                     e_en.text if e_en else ""))
    rows.sort(key=lambda r: (r[0], natural_key(r[1])))
    en_only = [en.by_join[jk] for jk in en.by_join if jk not in uk.by_join and jk not in ru.by_join]
    en_alias = [f"{e.scope} {e.key} (en) = {uk.by_join[(e.scope, e.join)].key} (uk)"
                for e in en.entries
                if (e.scope, e.join) in uk.by_join and e.key != uk.by_join[(e.scope, e.join)].key]

    # Static controls pair by position only; the en column of such rows is doubtful
    # wherever the English dialog does not list its statics in the same kinds order.
    def static_kinds(rc):
        kinds = {}
        for e in rc.entries:
            m = re.fullmatch(r"(.+):STATIC:(\d+)", e.key) if e.scope == "control" else None
            if m:
                kinds.setdefault(m.group(1), []).append((int(m.group(2)), e.kind))
        return {d: [k for _n, k in sorted(v)] for d, v in kinds.items()}

    uk_statics, en_statics = static_kinds(uk), static_kinds(en)
    static_doubts = []
    for dialog in sorted(uk_statics):
        a, b = uk_statics[dialog], en_statics.get(dialog, [])
        if a != b:
            first = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            static_doubts.append(f"{dialog}: uk statics {len(a)}, en statics {len(b)}, "
                                 f"kinds differ from STATIC:{first + 1} on")

    # --- write --------------------------------------------------------------
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = ["id\tscope\tru\tuk\ten"]
    for scope, ident, t_ru, t_uk, t_en in rows:
        lines.append("\t".join([ident, scope] + [tsv_escape(t) for t in (t_ru, t_uk, t_en)]))
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    # --- summary ------------------------------------------------------------
    per_scope = Counter(r[0] for r in rows)
    both = sum(1 for r in rows if r[2] and r[3])
    no_uk = [r for r in rows if not r[3]]
    no_ru = [r for r in rows if not r[2]]
    with_en = sum(1 for r in rows if r[4])
    print(f"glossary rows: {len(rows)} ("
          + ", ".join(f"{s} {per_scope[s]}" for s in sorted(per_scope)) + ")")
    print(f"rows with both ru and uk: {both}; lacking uk: {len(no_uk)}; lacking ru: {len(no_ru)}; "
          f"with en: {with_en}")
    print(f"ids in uk but not in ru: {len(no_ru)}" + "".join(f"\n  - {r[0]} {r[1]}" for r in no_ru))
    print(f"ids in ru but not in uk: {len(no_uk)}" + "".join(f"\n  - {r[0]} {r[1]}" for r in no_uk))
    print(f"uk/ru symbols differing for one resource: {len(symbol_differs)}"
          + "".join(f"\n  - {s}" for s in symbol_differs))
    print(f"en symbols paired through their numeric value: {len(en_alias)}"
          + "".join(f"\n  - {s}" for s in en_alias))
    print(f"ids only in en (not written): {len(en_only)}"
          + "".join(f"\n  - {e.scope} {e.key} = {e.text!r}" for e in en_only))
    print(f"dialogs whose en statics may pair wrongly (en column of STATIC rows doubtful): "
          f"{len(static_doubts)}" + "".join(f"\n  - {s}" for s in static_doubts))
    issues = ru.issues + uk.issues + en.issues
    print(f"parsing notes: {len(issues)}" + "".join(f"\n  - {s}" for s in issues))
    print(f"wrote {out}: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
