#!/usr/bin/env python3
"""Draws the AI assistant's busy pointer (feature 008, US8, FR-081, research R12).

The ordinary arrow with a small atom beside it: a nucleus and three electrons on tilted orbits.
Twelve frames per theme turn the electrons once (one revolution in about 1.5 s at the UI's
8 frames a second), plus one still frame for reduced motion. The arrow's tip is the hotspot
(2, 2). The drawing is the project's own (GPL-3.0 with the editor).

    python3 tools/draw_ai_cursor.py            # writes ui/public/cursors/ai-busy-*.svg
    python3 tools/draw_ai_cursor.py --check    # fails when a file differs from the drawing
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "ui" / "public" / "cursors"
FRAMES = 12
THEMES = {
    # arrow fill, arrow outline, atom colour
    "light": ("#000000", "#ffffff", "#1a73e8"),
    "dark": ("#ffffff", "#000000", "#8ab4f8"),
}
ARROW = "M2 2 L2 21 L6.5 16.8 L9.6 23.6 L12.6 22.3 L9.6 15.6 L15.8 15.6 Z"
CENTRE = (23.0, 23.0)
ORBIT = (6.5, 2.4)
TILTS = (0.0, 60.0, 120.0)


def electron(tilt: float, phase: float) -> tuple[float, float]:
    """A point on the orbit tilted by `tilt` degrees, at `phase` radians."""
    x, y = ORBIT[0] * math.cos(phase), ORBIT[1] * math.sin(phase)
    t = math.radians(tilt)
    return (CENTRE[0] + x * math.cos(t) - y * math.sin(t),
            CENTRE[1] + x * math.sin(t) + y * math.cos(t))


def frame(theme: str, index: int | None) -> str:
    fill, outline, atom = THEMES[theme]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
        f'<path d="{ARROW}" fill="{fill}" stroke="{outline}" stroke-width="1.2" '
        'stroke-linejoin="round"/>',
        f'<circle cx="{CENTRE[0]}" cy="{CENTRE[1]}" r="8.6" fill="{outline}" opacity="0.55"/>',
    ]
    for tilt in TILTS:
        parts.append(
            f'<ellipse cx="{CENTRE[0]}" cy="{CENTRE[1]}" rx="{ORBIT[0]}" ry="{ORBIT[1]}" '
            f'transform="rotate({tilt:g} {CENTRE[0]} {CENTRE[1]})" fill="none" '
            f'stroke="{atom}" stroke-width="0.9"/>')
    parts.append(f'<circle cx="{CENTRE[0]}" cy="{CENTRE[1]}" r="1.7" fill="{atom}"/>')
    step = 0 if index is None else index
    for n, tilt in enumerate(TILTS):
        phase = 2 * math.pi * step / FRAMES + n * 2 * math.pi / 3
        x, y = electron(tilt, phase)
        parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="1.25" fill="{atom}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def drawing() -> dict[str, str]:
    files: dict[str, str] = {}
    for theme in THEMES:
        for index in range(FRAMES):
            files[f"ai-busy-{theme}-{index + 1:02d}.svg"] = frame(theme, index)
        files[f"ai-busy-{theme}-static.svg"] = frame(theme, None)
    return files


def main() -> int:
    check = "--check" in sys.argv[1:]
    files = drawing()
    if check:
        stale = [name for name, text in files.items()
                 if not (OUT / name).is_file() or (OUT / name).read_text(encoding="utf-8") != text]
        if stale:
            print("draw_ai_cursor: differs from the drawing: " + ", ".join(sorted(stale)))
            return 1
        print(f"draw_ai_cursor: OK ({len(files)} files)")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (OUT / name).write_text(text, encoding="utf-8")
    print(f"draw_ai_cursor: wrote {len(files)} files to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
