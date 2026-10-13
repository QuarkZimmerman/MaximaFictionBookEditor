# UI icons

Copies of `resources/icons/toolbar24/id_*.png`, `resources/icons/toolbar16/id_*.png` and
`resources/icons/app/mfbe-{16,32}.png` (PNG conversions of the original FictionBook Editor
toolbar bitmaps, see `resources/icons/README.md` for provenance and licence). File names are the
original command ids in lower case; `ui/src/app/commands.ts` references them through the
`icon` field. Regenerate with:

    cp resources/icons/toolbar24/id_*.png ui/public/icons/toolbar24/
    cp resources/icons/toolbar16/id_*.png ui/public/icons/toolbar16/
