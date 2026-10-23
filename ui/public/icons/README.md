# UI icons

Copies of `resources/icons/toolbar24/id_*.png`, `resources/icons/toolbar16/id_*.png` and
`resources/icons/app/mfbe-{16,32}.png` (PNG conversions of the original FictionBook Editor
toolbar bitmaps, see `resources/icons/README.md` for provenance and licence). File names are the
original command ids in lower case; `ui/src/app/commands.ts` references them through the
`icon` field. Regenerate with:

    cp resources/icons/toolbar24/id_*.png ui/public/icons/toolbar24/
    cp resources/icons/toolbar16/id_*.png ui/public/icons/toolbar16/

Icons of this project's own (not conversions of an original bitmap — the original editor had no
such button):

| File                                                                       | Command                                        | Source                                                                                                                                                                                                                                 | Licence                        | Regeneration                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `toolbar24/ai-assistant.png` (24×24), `toolbar16/ai-assistant.png` (16×16) | `ai.toggle` (View → AI Assistant, feature 005) | a speech bubble with a spark, drawn in the style of the neighbouring FBE icons (8-bit RGBA, dark grey outline, white fill, one orange accent) by `tools/resources-import/draw_ai_icons.py` (Python 3, standard library, deterministic) | project licence (GPL-3.0-only) | `python3 tools/resources-import/draw_ai_icons.py` (`--check` compares the committed files with the drawing) |

`tree/` holds the Document Tree pane's buttons (`resources/icons/tree24/id_dt_*.png`) and the
cells of the original's `struct.bmp` image list that the tree rows use (`resources/icons/tree16/
struct-NN.png`, split by `tools/resources-import/import_icons.py`): 00 body and section, 03 poem,
09 cite, 12 annotation, 15 history (feature 004 — the original's History icon,
`FBE/ElementDescMnr.cpp:233-235`), 18 epigraph, 21 image, 27 title, 30 table
(`ui/src/views/tree/treeModel.ts`). Regenerate with:

    cp resources/icons/tree24/id_dt_*.png ui/public/icons/tree/
    for n in 00 03 09 12 15 18 21 27 30; do cp resources/icons/tree16/struct-$n.png ui/public/icons/tree/; done
