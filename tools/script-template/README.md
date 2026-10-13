# Script package template

Copy `NN_Group/NN_Script name/` into your scripts folder (**Scripts > Open scripts folder** in
the editor), rename the folders (`NN_` prefixes order the menu and are not displayed), edit
`script.json` and write `index.js`. Then **Scripts > Reload scripts**.

```text
<scripts folder>/
└── 05_My group/                 group = sub-menu (group.json gives it localised names)
    ├── group.json
    └── 01_My script/            one script = one folder
        ├── script.json          manifest: id, name (en required), kind, icon, hotkey...
        ├── index.js             export default async function run(ctx) { ... }
        └── icon.png             16 px toolbar icon (optional)
```

- `id` must be unique; use a reverse-DNS style such as `yourname.group.script`.
- `kind: "menu"` scripts appear in the Scripts menu / toolbar / hotkeys; `kind: "tree"` scripts
  appear in the Document Tree context menu and receive the clicked node in `ctx.treeNode`.
- The complete API with examples: `docs/scripting/en.md` / `docs/scripting/ru.md`; typings for
  code completion: `docs/scripting/mfbe.d.ts` (`/// <reference path="…/mfbe.d.ts" />`).
- Converting an original FictionBook Editor script: run `python3 tools/legacy-script-audit.py`
  to get a skeleton with the right names, icon and `legacy.source`, then port the `Run()` body
  with the table in `docs/scripting/en.md` §6.
- Check a converted script against a reference book with
  `node tests/scripts/run-script.mjs <script folder> <book.fb2> --snapshot <file>`.
