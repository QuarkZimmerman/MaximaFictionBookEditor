# UI icons

Copies of `resources/icons/toolbar24/id_*.png`, `resources/icons/toolbar16/id_*.png` and
`resources/icons/app/mfbe-{16,32}.png` (PNG conversions of the original FictionBook Editor
toolbar bitmaps, see `resources/icons/README.md` for provenance and licence). File names are the
original command ids in lower case; `ui/src/app/commands.ts` references them through the
`icon` field. Regenerate with:

    cp resources/icons/toolbar24/id_*.png ui/public/icons/toolbar24/
    cp resources/icons/toolbar16/id_*.png ui/public/icons/toolbar16/

`tree/` holds the Document Tree pane's buttons (`resources/icons/tree24/id_dt_*.png`) and the
cells of the original's `struct.bmp` image list that the tree rows use (`resources/icons/tree16/
struct-NN.png`, split by `tools/resources-import/import_icons.py`): 00 body and section, 03 poem,
09 cite, 12 annotation, 15 history (feature 004 — the original's History icon,
`FBE/ElementDescMnr.cpp:233-235`), 18 epigraph, 21 image, 27 title, 30 table
(`ui/src/views/tree/treeModel.ts`). Regenerate with:

    cp resources/icons/tree24/id_dt_*.png ui/public/icons/tree/
    for n in 00 03 09 12 15 18 21 27 30; do cp resources/icons/tree16/struct-$n.png ui/public/icons/tree/; done
