#!/usr/bin/env python3
"""Fetch the fonts the PDF export ships (feature 014, plan DP-1, research R5).

Static instances only: Chromium's PDF output turns variable fonts into Type3 fonts (Skia's
SkPDFFont.cpp), so every style is its own file. Sources are pinned: the Noto project's builds at a
fixed commit, DejaVu's 2.37 release, the OFL text from Google Fonts' repository. Every file is
checked against its SHA-256 below; `--update` recomputes the sums after a deliberate change of source.

Writes resources/fonts/<file>, resources/fonts/fonts.json and the licence texts. Developer tool,
never shipped; the fonts it writes are aggregated data read at run time (constitution VI).

Usage:
  python3 tools/fonts/fetch-fonts.py           # fetch and verify
  python3 tools/fonts/fetch-fonts.py --check   # verify the files already in resources/fonts
  python3 tools/fonts/fetch-fonts.py --update  # fetch, recompute the sums, rewrite this script's table
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'resources' / 'fonts'
NOTO = ('https://raw.githubusercontent.com/notofonts/notofonts.github.io/'
        '4cf78353cd1668040ba8efa13029cd910fcdf9e2/fonts')
DEJAVU = ('https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/'
          'dejavu-fonts-ttf-2.37.tar.bz2')
OFL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif/OFL.txt'

FOUR = ['Regular', 'Italic', 'Bold', 'BoldItalic']
TWO = ['Regular', 'Bold']
# id, family directory, kind, scripts, styles, offered as text font
NOTO_FAMILIES = [
    ('noto-serif', 'NotoSerif', 'serif', ['Latin', 'Cyrillic', 'Greek'], FOUR, True),
    ('noto-sans', 'NotoSans', 'sans-serif', ['Latin', 'Cyrillic', 'Greek'], FOUR, True),
    ('noto-serif-georgian', 'NotoSerifGeorgian', 'serif', ['Georgian'], TWO, False),
    ('noto-sans-georgian', 'NotoSansGeorgian', 'sans-serif', ['Georgian'], TWO, False),
    ('noto-serif-armenian', 'NotoSerifArmenian', 'serif', ['Armenian'], TWO, False),
    ('noto-sans-armenian', 'NotoSansArmenian', 'sans-serif', ['Armenian'], TWO, False),
]
DEJAVU_STYLES = {'Regular': 'DejaVuSansMono.ttf', 'Italic': 'DejaVuSansMono-Oblique.ttf',
                 'Bold': 'DejaVuSansMono-Bold.ttf', 'BoldItalic': 'DejaVuSansMono-BoldOblique.ttf'}

# file name -> SHA-256 (rewritten by --update)
SHA256 = {
    'DejaVu-LICENSE.txt': '7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93',
    'DejaVuSansMono-Bold.ttf': 'bce60f1b4421acd9ea51ba6623d7024ecbe6817a953e3654df62a5e6bdf8f769',
    'DejaVuSansMono-BoldOblique.ttf': '91713a71d550bba22c2a6b2bb2a9ad8f9a159e12e4e9f0a5b2677998ba21213e',
    'DejaVuSansMono-Oblique.ttf': '742097840c541870e8d6dc5c9b37bb1ceeea6c0dedd1d475faf903ef9df734b0',
    'DejaVuSansMono.ttf': 'b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582',
    'NotoSans-Bold.ttf': '1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913',
    'NotoSans-BoldItalic.ttf': '1b602a9d6353be42c91df097a4857b69fa2696f26703d7a33b54a15d87c2622c',
    'NotoSans-Italic.ttf': '467e3f89eeca4108bb8710a2b9e0cf2281ac56d5b0609211a83776d0505eecb5',
    'NotoSans-Regular.ttf': '478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823',
    'NotoSansArmenian-Bold.ttf': '58e4529f7f44d1fcfbd5d81d446b656f1230267ebfa96f8006956f18fbe4bbe2',
    'NotoSansArmenian-Regular.ttf': '720df88c332417a235b4d6209d14ec2e2bf4bfe2a954b7453d869ea593bfce1e',
    'NotoSansGeorgian-Bold.ttf': 'a7f6bc365b7c33372e9ff0b0422f35dad52df501a8fcd4e8766cefa430508693',
    'NotoSansGeorgian-Regular.ttf': 'd3e33254b09e7bb2c5cf0f17e554b80462056c5a107097f258d495168c3a9346',
    'NotoSerif-Bold.ttf': '96656aa5cec8f1d6fd0e804c1fad397e1a1cfa082e6642124e0bda68cd8363ce',
    'NotoSerif-BoldItalic.ttf': 'c710c5b9cf354ae46e7a10472a08019b28220fafeb5887a482a76856f8f6fc0b',
    'NotoSerif-Italic.ttf': '749e80e313ef711f9373c6cce17c72297ef05490b3dcda7967d1d5d90bf1183f',
    'NotoSerif-Regular.ttf': '19e72cd8d595fae5bd74a5206f5d938512e1183d4fed7abb1ec1be1d7efa5f88',
    'NotoSerifArmenian-Bold.ttf': '79b6e9d36f8409444d16bb88e8c1f091aaf9548fb9ba7e5dba572aec325f905e',
    'NotoSerifArmenian-Regular.ttf': '6dc71b17c55d398c7cc88edeec527292ba1e0573b033ac2136c636ab36c27d76',
    'NotoSerifGeorgian-Bold.ttf': '6d30bd1fd83882002cab9da8e3fadb6bbe86fc710913a07305b3aea861de007a',
    'NotoSerifGeorgian-Regular.ttf': 'e222862f34ad05bdf950de1049abf6149d250b9e27c1cc482dd645412afb64ff',
    'OFL.txt': 'cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a',
}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def collect() -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for _, family, _, _, styles, _ in NOTO_FAMILIES:
        for style in styles:
            name = f'{family}-{style}.ttf'
            files[name] = fetch(f'{NOTO}/{family}/hinted/ttf/{name}')
    archive = tarfile.open(fileobj=io.BytesIO(fetch(DEJAVU)), mode='r:bz2')
    for member in archive.getmembers():
        base = member.name.rsplit('/', 1)[-1]
        if base in DEJAVU_STYLES.values():
            files[base] = archive.extractfile(member).read()
        elif base == 'LICENSE':
            files['DejaVu-LICENSE.txt'] = archive.extractfile(member).read()
    files['OFL.txt'] = fetch(OFL)
    return files


def index() -> dict:
    families = []
    for fid, family, kind, scripts, styles, text in NOTO_FAMILIES:
        families.append({'id': fid, 'kind': kind, 'scripts': scripts, 'textFont': text,
                         'licence': 'OFL-1.1', 'notice': 'OFL.txt',
                         'styles': {s: f'{family}-{s}.ttf' for s in styles}})
    families.append({'id': 'dejavu-sans-mono', 'kind': 'monospace',
                     'scripts': ['Latin', 'Cyrillic', 'Greek'], 'textFont': False,
                     'licence': 'Bitstream-Vera', 'notice': 'DejaVu-LICENSE.txt',
                     'styles': DEJAVU_STYLES})
    return {'version': 1, 'families': families}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--update', action='store_true')
    args = parser.parse_args()
    if args.check:
        bad = [n for n, s in SHA256.items()
               if not (OUT / n).is_file() or hashlib.sha256((OUT / n).read_bytes()).hexdigest() != s]
        print('fetch-fonts: ' + ('OK' if not bad else 'MISMATCH ' + ', '.join(bad)))
        return 1 if bad or not SHA256 else 0
    files = collect()
    sums = {n: hashlib.sha256(b).hexdigest() for n, b in sorted(files.items())}
    if args.update:
        me = Path(__file__)
        table = 'SHA256 = {\n' + ''.join(f"    '{n}': '{s}',\n" for n, s in sums.items()) + '}'
        me.write_text(re.sub(r'SHA256 = \{\n.*?\n?\}', table, me.read_text(), count=1, flags=re.S))
    elif sums != SHA256:
        print('fetch-fonts: a source changed; run --update after checking it', file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (OUT / name).write_bytes(data)
    (OUT / 'fonts.json').write_text(json.dumps(index(), indent=2) + '\n', encoding='utf-8')
    print(f'fetch-fonts: {len(files)} files written to {OUT.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
