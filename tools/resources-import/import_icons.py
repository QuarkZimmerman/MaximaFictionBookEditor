#!/usr/bin/env python3
"""Regenerate resources/icons/* from the original FictionBook Editor bitmaps.

Requires ImageMagick 7 (`magick`) on PATH. Reads FBE/res/*.bmp, FBE/res/*.ico
and FBE/FBE.rc (windows-1251) from the reference checkout of the original
FictionBook Editor sources and writes PNGs:

  icons/strips/<name>.png      whole strips, magenta (#FF00FF) made transparent
  icons/toolbar24/<id>.png     Toolbar.bmp split in 24x24 cells, named after the
                               BUTTON ids of "IDR_MAINFRAME TOOLBAR 24, 24"
  icons/toolbar16/<id>.png     Toolbar_small.bmp (IDR_MAINFRAME_SMALL TOOLBAR 16, 16)
                               plus Scripts.bmp (IDR_SCRIPTS TOOLBAR 16, 16)
  icons/tree24/<id>.png        document.bmp (IDR_DOCUMENT_TREE TOOLBAR 24, 24)
  icons/tree16/struct-NN.png   struct.bmp cells (document tree image list)
  icons/wordstat16/*.png       wordstat.bmp cells (Words dialog states)
  icons/status16/*.png         ok/error/update.bmp (black key)
  icons/misc/*.png             STRIKTHR.BMP (legacy, gray key)
  icons/app/mfbe-<size>.png    app icon from FBE.ico (16..256), plus the .ico copies

SEPARATOR lines in the .rc do not consume a bitmap cell. Cells beyond the last
BUTTON are written as unused-cell-NN.png.

Usage: python3 tools/import_icons.py [--ref FBE_dir] [--out icons_dir]
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

MAGENTA = "#FF00FF"

TOOLBARS = [
    # rc toolbar id,          bitmap,              cell, output dir
    ("IDR_MAINFRAME",         "Toolbar.bmp",       24,   "toolbar24"),
    ("IDR_MAINFRAME_SMALL",   "Toolbar_small.bmp", 16,   "toolbar16"),
    ("IDR_DOCUMENT_TREE",     "document.bmp",      24,   "tree24"),
    ("IDR_SCRIPTS",           "Scripts.bmp",       16,   "toolbar16"),
]

STRIPS = [
    # bitmap,              strip png name,   cell, transparent key
    ("Toolbar.bmp",        "toolbar",        24,   MAGENTA),
    ("Toolbar_small.bmp",  "toolbar_small",  16,   MAGENTA),
    ("document.bmp",       "document",       24,   MAGENTA),
    ("Scripts.bmp",        "scripts",        16,   MAGENTA),
    ("struct.bmp",         "struct",         16,   MAGENTA),
    ("wordstat.bmp",       "wordstat",       16,   MAGENTA),
    ("toolimg.bmp",        "toolimg",        16,   MAGENTA),   # legacy, unreferenced in FBE.rc
]

WORDSTAT_NAMES = ["wordstat-0-plain", "wordstat-1-warning",
                  "wordstat-2-has-replacement", "wordstat-3-no-replacement"]

STATUS = [  # AboutBox update checker, drawn with RGB(0,0,0) as transparent colour
    ("ok.bmp",     "update-ok"),
    ("error.bmp",  "update-error"),
    ("update.bmp", "update-available"),
]

APP_SIZES = [16, 32, 48, 64, 128, 256]


def run(*cmd):
    cmd = list(cmd)
    if cmd[-1].endswith(".png"):
        # explicit PNG32 coder (8-bit RGBA): the default PNG writer silently
        # drops the alpha channel of 2-colour grayscale images (STRIKTHR.BMP)
        cmd[-1] = "PNG32:" + cmd[-1]
    subprocess.run(cmd, check=True)


def ident(path, fmt):
    return subprocess.run(["magick", "identify", "-format", fmt, str(path)],
                          check=True, capture_output=True, text=True).stdout


def parse_rc_toolbars(rc_path):
    text = rc_path.read_bytes().decode("cp1251")
    result = {}
    for m in re.finditer(r"^(\w+) TOOLBAR\s+(\d+),\s*(\d+)\s*\nBEGIN\n(.*?)^END", text, re.S | re.M):
        name, w, h, body = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
        buttons = re.findall(r"^\s*BUTTON\s+(\w+)", body, re.M)
        result[name] = (w, h, buttons)
    return result


def convert_strip(src, dst, key):
    run("magick", str(src), "-transparent", key, "-define", "png:exclude-chunk=date,time", str(dst))


def split_cells(png, cell, names, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    w, h = (int(v) for v in ident(png, "%w %h").split())
    if w % cell or h != cell:
        raise SystemExit(f"{png}: {w}x{h} is not a horizontal strip of {cell}x{cell} cells")
    n = w // cell
    written = []
    for i in range(n):
        name = names[i] if i < len(names) else f"unused-cell-{i:02d}"
        dst = out_dir / f"{name}.png"
        run("magick", str(png), "-crop", f"{cell}x{cell}+{i * cell}+0", "+repage",
            "-define", "png:exclude-chunk=date,time", str(dst))
        written.append((i, dst.name))
    return n, written


def main():
    here = Path(__file__).resolve().parents[2] / "resources"  # <repo>/resources
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="/root/maxfbeditor/reference/fictionbookeditor/FBE")
    ap.add_argument("--out", default=str(here / "icons"))
    args = ap.parse_args()
    ref, res, out = Path(args.ref), Path(args.ref) / "res", Path(args.out)

    toolbars = parse_rc_toolbars(ref / "FBE.rc")
    for name, (w, h, buttons) in toolbars.items():
        print(f"FBE.rc {name}: {w}x{h}, {len(buttons)} buttons")

    strips = out / "strips"
    strips.mkdir(parents=True, exist_ok=True)
    total = 0
    for bmp, name, cell, key in STRIPS:
        dst = strips / f"{name}.png"
        convert_strip(res / bmp, dst, key)
        w, h = (int(v) for v in ident(dst, "%w %h").split())
        print(f"strip {bmp} -> strips/{name}.png {w}x{h} ({w // cell} cells of {cell})")
        total += 1

    for rc_id, bmp, cell, sub in TOOLBARS:
        w, h, buttons = toolbars[rc_id]
        if (w, h) != (cell, cell):
            raise SystemExit(f"{rc_id}: FBE.rc says {w}x{h}, expected {cell}x{cell}")
        strip_png = strips / f"{dict((b, n) for b, n, _c, _k in STRIPS)[bmp]}.png"
        n, written = split_cells(strip_png, cell, [b.lower() for b in buttons], out / sub)
        unused = [nm for _i, nm in written if nm.startswith("unused-cell")]
        print(f"split {bmp}: {n} cells -> {sub}/ ({len(buttons)} named by {rc_id}"
              + (f", {len(unused)} unused: {', '.join(unused)}" if unused else "") + ")")
        if len(buttons) > n:
            print(f"  WARNING: {rc_id} lists {len(buttons)} buttons but the strip has only {n} cells")
        total += n

    n, _w = split_cells(strips / "struct.png", 16, [f"struct-{i:02d}" for i in range(99)], out / "tree16")
    print(f"split struct.bmp: {n} cells -> tree16/")
    total += n
    n, _w = split_cells(strips / "wordstat.png", 16, WORDSTAT_NAMES, out / "wordstat16")
    print(f"split wordstat.bmp: {n} cells -> wordstat16/")
    total += n

    status = out / "status16"
    status.mkdir(exist_ok=True)
    for bmp, name in STATUS:
        run("magick", str(res / bmp), "-transparent", "black",
            "-define", "png:exclude-chunk=date,time", str(status / f"{name}.png"))
        total += 1
    print(f"status16/: {len(STATUS)} files (black key)")

    misc = out / "misc"
    misc.mkdir(exist_ok=True)
    run("magick", str(res / "STRIKTHR.BMP"), "-transparent", "srgb(192,192,192)",
        "-define", "png:exclude-chunk=date,time", str(misc / "strikethrough16.png"))
    total += 1
    print("misc/strikethrough16.png (legacy STRIKTHR.BMP, gray key)")

    app = out / "app"
    app.mkdir(exist_ok=True)
    for ico in ("FBE.ico", "FBE2.ico"):
        shutil.copyfile(res / ico, app / ico)
    # pick, per frame, the largest/most colourful frame of FBE.ico
    frames = []
    for line in ident(res / "FBE.ico", "%s %w %h %k %z\n").splitlines():
        s, w, h, k, z = (int(v) for v in line.split())
        frames.append((w, s, k, z))
    frames.sort(key=lambda t: (t[0], t[2], t[3]))  # by size, then colours, then depth
    best_by_size = {w: s for w, s, _k, _z in frames}
    largest_w = max(best_by_size)
    for size in APP_SIZES:
        if size in best_by_size:
            src = f"{res / 'FBE.ico'}[{best_by_size[size]}]"
            note = f"native frame {best_by_size[size]}"
            run("magick", src, "-define", "png:exclude-chunk=date,time", str(app / f"mfbe-{size}.png"))
        else:
            src = f"{res / 'FBE.ico'}[{best_by_size[largest_w]}]"
            note = f"frame {best_by_size[largest_w]} ({largest_w}px) scaled with -filter Lanczos"
            run("magick", src, "-filter", "Lanczos", "-resize", f"{size}x{size}",
                "-define", "png:exclude-chunk=date,time", str(app / f"mfbe-{size}.png"))
        print(f"app/mfbe-{size}.png <- FBE.ico {note}")
        total += 1
    print(f"total PNG files written: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
