#!/usr/bin/env python3
"""Feature 016 (T065; D32; SC-005, SC-007, SC-014): the corpus gate's PDF import run.

  tests/corpus/pdf-import.py LIST [--out DIR] [--core PATH] [--text N] [--layer N] [--refused N] [--sort-limit S]

LIST holds library PDFs as `sample.py --ext pdf` draws them - more than the run keeps. Each is first read by the
editor's own reader for at most --sort-limit seconds (20; its first pages tell its kind) and sorted: PDFs made from
text (most pages read are text), scans with a text layer (most are pictures with a layer), and scans without
usable text (refused: no text, a garbled layer, pages showing text without a layer). Across their makers (the
PDF's producer, else its creator) the run keeps --text, --layer and --refused of them (50, 50 and 20), reads the
kept ones whole for the check of their words, and imports each through the editor (the journey
ui/tests/e2e/corpus-pdf-import.spec.ts; build ui/dist first).

Judged, as D32 says: no crash or hang; an imported book's bodies are valid FB2 2.1; every word of a PDF's text
layer is in its book in order, apart from a page's short first and last lines (the running heads and page
numbers the import leaves out), the words a drawing holds (they are its picture, D16) and words joined at a line's
hyphen; no PDF of the first two kinds is refused; every one of the third is refused with its message (D19).
DIR/report.txt and DIR/report.json give the outcome. The exit code is 0 only when all of it holds.
"""

from __future__ import annotations

import bisect
import difflib
import html
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import arguments, report, run_journey, timing  # noqa: E402

REFUSALS = ("noText", "garbled", "pictureOfText")
# The word check (SC-005, SC-007): a lost line is a run of this many missing words; the check's own doubts
# leave single words, at most this share of a layer.
GAP = 6
SHARE = 0.005


def reader_of(core: Path) -> Path:
    reader = core.with_name("mfbe-pdf-reader")
    if not reader.is_file():
        sys.exit(f"no mfbe-pdf-reader beside {core}")
    return reader


def read(reader: Path, pdf: Path, folder: Path, limit: float | None) -> dict:
    """The reader over `pdf` into `folder`, for at most `limit` seconds: its last event, the pages' kinds, maker."""
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    last: dict = {}
    try:
        # Bytes, decoded whole: a reader stopped at the limit may have cut a letter in two.
        run = subprocess.run([str(reader), "--pdf", str(pdf), "--out", str(folder)], stdin=subprocess.DEVNULL,
                             capture_output=True, timeout=limit)
        for line in run.stdout.decode("utf-8", "replace").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") in ("done", "failed"):
                last = event
    except subprocess.TimeoutExpired:
        last = {"event": "partial"}
    kinds = Counter()
    for page in folder.glob("page-*.json"):
        try:
            kinds[json.loads(page.read_text(encoding="utf-8")).get("kind", "")] += 1
        except (json.JSONDecodeError, OSError):
            pass
    maker = "unknown"
    try:
        info = json.loads((folder / "document.json").read_text(encoding="utf-8")).get("metadata", {}).get("info", {})
        name = info.get("Producer") or info.get("Creator") or ""
        maker = re.sub(r"[\d.,;:()\[\]v]+$", "", re.sub(r"\s+\d[\w.]*", "", name)).strip().lower()[:40] or "unknown"
    except (json.JSONDecodeError, OSError):
        pass
    return {"event": last.get("event", "crashed"), "reason": last.get("reason", ""), "kinds": dict(kinds),
            "maker": maker}


def kind_of(sorted_read: dict) -> str:
    if sorted_read["event"] == "failed":
        return "refused" if sorted_read["reason"] in REFUSALS else "other"
    kinds = sorted_read["kinds"]
    text, layer = kinds.get("text", 0), kinds.get("pictureWithLayer", 0) + kinds.get("garbled", 0)
    if text == 0 and layer == 0:
        return "refused" if kinds else "other"
    return "text" if text >= layer else "layer"


def across_makers(books: list[tuple[str, str]], count: int) -> list[str]:
    """`count` books taken in turn from each maker, the most frequent makers first."""
    by_maker: dict[str, list[str]] = defaultdict(list)
    for book, maker in books:
        by_maker[maker].append(book)
    queues = sorted(by_maker.values(), key=len, reverse=True)
    kept: list[str] = []
    while len(kept) < count and any(queues):
        for queue in queues:
            if queue and len(kept) < count:
                kept.append(queue.pop(0))
    return kept


def norm(word: str) -> str:
    word = unicodedata.normalize("NFKC", word).lower().replace("\u00ad", "")
    return "".join(ch for ch in word if ch.isalnum())


def layer_pages(folder: Path) -> list[tuple[int, list[tuple[str, bool]]]]:
    """Each page's words in reading order, as (word, ends its line with a hyphen), apart from the words inside
    its drawings and its running heads and page numbers: a first or last line that is short, or much like the
    first or last line of a page around it (as the import finds them, D12)."""
    paths = sorted(folder.glob("page-*.json"), key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)))
    pages: list[tuple[int, list[list[dict]]]] = []
    for path in paths:
        page = json.loads(path.read_text(encoding="utf-8"))
        drawings = [d["box"] for d in page.get("drawings", [])]
        lines: list[list[dict]] = []
        for word in page.get("words", []):
            x, y, w, h = word["box"]
            if any(b[0] <= x + w / 2 <= b[0] + b[2] and b[1] <= y + h / 2 <= b[1] + b[3] for b in drawings):
                continue
            if lines and abs(lines[-1][-1]["base"] - word["base"]) <= max(2.0, word["s"] * 0.3):
                lines[-1].append(word)
            else:
                lines.append([word])
        pages.append((page["n"], lines))
    letters = lambda line: re.sub(r"[^\w]|\d|_", "", " ".join(w["t"] for w in line).lower())  # noqa: E731
    # A page's first and last lines by their place on it - top and bottom - not by the order the PDF draws them in
    # (a running head drawn after the text, D32's library run).
    # Every group of words at that height is that line: a head drawn in two pieces (an author's name, then the
    # page number, then the title) is one line.
    def ends(lines: list[list[dict]]) -> tuple[list[int], list[int]]:
        bases = [sum(w["base"] for w in line) / len(line) for line in lines]
        top, bottom = min(bases), max(bases)
        return ([k for k, b in enumerate(bases) if b - top <= 2.0], [k for k, b in enumerate(bases) if bottom - b <= 2.0])
    edges = [ends(lines) if lines else ([], []) for _, lines in pages]

    def edge_line(index: int, which: int) -> list[dict]:
        lines = pages[index][1]
        return [w for k in edges[index][which] for w in lines[k]]
    edge = [(letters(edge_line(i, 0)) if lines else "", letters(edge_line(i, 1)) if lines else "")
            for i, (_, lines) in enumerate(pages)]

    def furniture(index: int, which: int) -> bool:
        line = edge_line(index, which)
        if len(line) <= 8:
            return True
        key = edge[index][which]
        return len(key) >= 4 and any(
            0 <= other < len(pages) and other != index
            and difflib.SequenceMatcher(None, key, edge[other][which]).ratio() >= 0.7
            for other in (index - 2, index - 1, index + 1, index + 2))

    out: list[tuple[int, list[tuple[str, bool]]]] = []
    for index, (n, lines) in enumerate(pages):
        drop: set[int] = set()
        if lines and furniture(index, 0):
            drop.update(edges[index][0])
        if len(lines) > 1 and furniture(index, 1):
            drop.update(edges[index][1])
        keep = [line for k, line in enumerate(lines) if k not in drop]
        words: list[tuple[str, bool]] = []
        for line in keep:
            for i, word in enumerate(line):
                token = norm(word["t"])
                if token:
                    words.append((token, i == len(line) - 1 and word["t"].rstrip().endswith(("-", "\u00ad"))))
        out.append((n, words))
    return out


def book_words(fb2: Path) -> list[str]:
    text = fb2.read_text(encoding="utf-8")
    text = re.sub(r"<binary[\s\S]*?</binary>", " ", text)
    text = re.sub(r"<description[\s\S]*?</description>", " ", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return [token for token in (norm(word) for word in text.split()) if token]


def canonical(tokens: list[str], vocabulary: set[str]) -> tuple[list[str], list[int]]:
    """Two neighbouring words that are one word somewhere in the layer or the book become that word - a word
    broken at a line's end (joined by the import, D12, or not), a drop cap set apart, a compound split over
    two lines. Both sides go through the same rule, so a pair is merged alike in both. Gives the words and,
    for each, the index of its first word in `tokens`."""
    out: list[str] = []
    first: list[int] = []
    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens) and tokens[i] + tokens[i + 1] in vocabulary:
            out.append(tokens[i] + tokens[i + 1])
            first.append(i)
            i += 2
            continue
        out.append(tokens[i])
        first.append(i)
        i += 1
    return out, first


def missing_words(pages: list[tuple[int, list[tuple[str, bool]]]], book: list[str],
                  near: int = 600) -> tuple[list[str], int, list[str]]:
    """The layer's words the book does not hold, and how many it holds elsewhere nearby. The two word sequences
    are aligned as a whole (difflib's matching blocks; words used everywhere only extend the blocks); a layer
    word outside the blocks that the book holds within `near` words of where the alignment puts it is only in
    another order - the order a PDF draws its text in is not always the order it reads in (a caption beside
    its column, a list in two columns), and the import reads by the page's layout. Gives the missing words,
    named with their pages, how many were found in another order, and the longest run of missing words one
    after another (a line or more of text lost, where the check's own doubts - furniture told by likeness,
    halves of a word drawn apart - leave single words)."""
    layer = [token for _, words in pages for token, _ in words]
    page_of = [n for n, words in pages for _ in words]
    page_size = {n: len(words) for n, words in pages}
    vocabulary = set(layer) | set(book)
    a, first = canonical(layer, vocabulary)
    b, _ = canonical(book, vocabulary)
    # No junk heuristics: they break the blocks at every common word, and a block moved far (an imprint the tags
    # read at the end) then wins over the whole body (D32's library run).
    blocks = [block for block in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks()
              if block.size]
    covered: set[int] = set()
    for block in blocks:
        covered.update(range(block.a, block.a + block.size))
    starts = [block.a for block in blocks]
    missing: list[str] = []
    elsewhere = 0
    run: list[str] = []
    longest: list[str] = []

    def nearby(i: int) -> list[str]:
        k = bisect.bisect_right(starts, i) - 1
        # Where the block before puts it, and where the block after does: a block moved between them shifts the
        # one but not the other.
        expected = [blocks[k].b + (i - blocks[k].a) if k >= 0 else 0]
        if k + 1 < len(blocks):
            expected.append(max(0, blocks[k + 1].b - (blocks[k + 1].a - i)))
        # Within its page's own length either way (a PDF page can hold two pages of a book, read column by
        # column by the import).
        reach = max(near, 2 * page_size[page_of[first[i]]])
        return [word for at in expected for word in b[max(0, at - reach):at + reach]]

    # A run of words the alignment left out that the book holds as it is somewhere else - a block its tags read
    # in another place (an imprint at the end) - is in another order, not lost.
    whole = f" {' '.join(b)} "
    moved: set[int] = set()
    i = 0
    while i < len(a):
        if i in covered:
            i += 1
            continue
        j = i
        while j < len(a) and j not in covered:
            j += 1
        # Five words at a time: a moved block may differ from the layer here and there.
        for k in range(i, j - 4):
            if f" {' '.join(a[k:k + 5])} " in whole:
                moved.update(range(k, k + 5))
        i = j
    # Letters of one word that the layer gives apart ("t sv e t k o v", a word set letter-spaced): the word the
    # book holds, read from consecutive tokens outside the blocks that together make up a nearby book word.
    joined: set[int] = set()
    for i in range(len(a)):
        if i in covered or i in joined or i in moved:
            continue
        words = [word for word in nearby(i) if len(word) >= 3]
        text, best = a[i], -1
        for j in range(i + 1, min(len(a), i + 24)):
            if j in covered:
                break
            text += a[j]
            if not any(text in word for word in words):
                break
            if any(text == word for word in words):
                best = j
        if best > i:
            joined.update(range(i, best + 1))
    for i, token in enumerate(a):
        if i in covered:
            run = []
            continue
        if i in joined or i in moved:
            elsewhere += 1
            run = []
            continue
        around = nearby(i)
        # Nearby as it is, or as a part of a word the book joined (its halves drawn apart in the PDF).
        if token in around or (len(token) >= 2 and any(
                len(word) > len(token) and (word.startswith(token) or word.endswith(token)) for word in around)):
            elsewhere += 1
            run = []
        else:
            missing.append(f"p{page_of[first[i]]} {token}")
            run.append(missing[-1])
            if len(run) > len(longest):
                longest = list(run)
    return missing, elsewhere, longest


def main() -> int:
    import argparse
    extra = argparse.ArgumentParser(add_help=False)
    extra.add_argument("--text", type=int, default=50)
    extra.add_argument("--layer", type=int, default=50)
    extra.add_argument("--refused", type=int, default=20)
    extra.add_argument("--sort-limit", type=float, default=20.0)
    extra.add_argument("-j", type=int, default=4)
    own, rest = extra.parse_known_args()
    sys.argv = [sys.argv[0], *rest]
    args = arguments(__doc__, "pdf-import")
    reader = reader_of(args.core)
    pdfs = [line.strip() for line in args.list.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")]
    sort_dir = args.out / "sort"
    with ThreadPoolExecutor(own.j) as pool:
        sorted_reads = dict(zip(pdfs, pool.map(
            lambda pdf: read(reader, Path(pdf), sort_dir / Path(pdf).stem, own.sort_limit), pdfs)))
    groups: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for pdf, sorted_read in sorted_reads.items():
        groups[kind_of(sorted_read)].append((pdf, sorted_read["maker"]))
    kept = {kind: across_makers(groups[kind], count)
            for kind, count in (("text", own.text), ("layer", own.layer), ("refused", own.refused))}
    kind_by_book = {book: kind for kind, books in kept.items() for book in books}
    selected = args.out / "selected.txt"
    selected.write_text("".join(f"{book}\n" for books in kept.values() for book in books), encoding="utf-8")
    # The kept PDFs of the first two kinds read whole, for the check of their words.
    whole_dir = args.out / "reader"
    with ThreadPoolExecutor(own.j) as pool:
        whole = dict(zip(kept["text"] + kept["layer"], pool.map(
            lambda pdf: read(reader, Path(pdf), whole_dir / Path(pdf).stem, None), kept["text"] + kept["layer"])))
    records = run_journey("pdf-import", selected, args.out, args.core, spec="corpus-pdf-import")
    problems: list[str] = []
    refused_whole: list[str] = []
    rows: list[dict] = []
    for record in records:
        book, kind = record["book"], kind_by_book.get(record["book"], "?")
        row = {"book": book, "kind": kind, "ms": record["ms"], "maker": sorted_reads[book]["maker"]}
        if record.get("failure"):
            problems.append(f"  failed or hung: {book}: {record['failure']}")
        elif kind == "refused":
            if not record.get("refused"):
                problems.append(f"  imported, but it has no usable text: {book}")
        elif record.get("refused"):
            # A protected PDF is refused for its password, not for its pages (D26): no fault. Nor is one the
            # sorting judged by its first pages that the reader, reading it whole, refuses itself - pages further
            # on show text without a layer (D19): the refusal is right, the first pages told wrong.
            read_whole = whole.get(book, {})
            if read_whole.get("event") == "failed" and read_whole.get("reason") in REFUSALS:
                refused_whole.append(f"  refused when read whole, sorted by its first pages as {kind}: {book}:"
                                     f" {read_whole['reason']}")
            elif record["refused"] != "password":
                problems.append(f"  refused, though its pages have text: {book}: {record['refused']}")
        else:
            if record.get("bodyErrors"):
                problems.append(f"  invalid bodies: {book}: {'; '.join(record['bodyErrors'][:3])}")
            pages = layer_pages(whole_dir / Path(book).stem)
            total = sum(len(words) for _, words in pages)
            lost, elsewhere, gap = missing_words(pages, book_words(Path(record["fb2"])))
            row.update({"words": total, "missing": len(lost), "inAnotherOrder": elsewhere, "longestGap": len(gap),
                        "firstMissing": lost[:12]})
            # Words lost: a run of words one after another (a line), or more than 0.5 % of the layer.
            if len(gap) >= GAP or len(lost) > total * SHARE:
                problems.append(f"  {len(lost)} of {total} words not in the book (longest run {len(gap)}: "
                                f"{' '.join(gap[:10])}): {book}")
        rows.append({**row, **{k: record[k] for k in ("refused", "summary") if record.get(k)}})
    counts = {kind: len(books) for kind, books in kept.items()}
    lines = [f"PDF import of {len(records)} library PDF(s) of {len(pdfs)} drawn from {args.list}:"
             f" {counts['text']} made from text, {counts['layer']} scans with a text layer, {counts['refused']}"
             f" without usable text; {len(problems)} problem(s) ({timing(records)})",
             f"  makers: {len({row['maker'] for row in rows})}; sorted out: "
             + ", ".join(f"{kind} {len(books)}" for kind, books in sorted(groups.items()))]
    lines += problems
    lines += refused_whole
    # What the sorting set aside - neither kind, nor refused for want of text (damaged, protected, a reader
    # stopped by the time limit with no page read): listed, so that none hides a fault.
    lines += [f"  set aside: {pdf}: {r['event']} {r['reason']}".rstrip()
              for pdf, r in sorted_reads.items() if kind_of(r) == "other"]
    report(args.out, lines, {"drawn": len(pdfs), "kept": counts, "books": rows, "problems": problems,
                             "sorted": sorted_reads})
    return 0 if not problems and all(counts[k] > 0 for k in counts) else 1


if __name__ == "__main__":
    raise SystemExit(main())
