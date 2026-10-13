# Скрипты для Maxima Fiction Book Editor

Скрипты автоматизируют рутинную правку: смену регистра, сноски из текста в скобках,
подписи к иллюстрациям, обработку кавычек, чистку, статистику. Они пишутся на обычном
**JavaScript (модули ES2023)** и выполняются внутри редактора одинаково на всех платформах.
Здесь описаны формат пакета скрипта, каждая возможность интерфейса `mfbe` с работающим
примером, правила песочницы и перенос скриптов из оригинального FictionBook Editor.
Английская версия — [en.md](en.md); типы для редакторов с автодополнением —
[mfbe.d.ts](mfbe.d.ts); примеры — в папке [examples/](examples/).

## 1. Где лежат скрипты

Редактор ищет скрипты в нескольких папках и объединяет найденное (ничто из нижних слоёв
никогда не скрывается и не подменяется):

1. папка, выбранная в **Сервис > Настройки > Другое > Папка скриптов** (необязательно),
2. личная папка скриптов (**Скрипты > Открыть папку скриптов** открывает её):
   - Windows: `%LOCALAPPDATA%\Maxima Fiction Book Editor\scripts\`
   - Linux: `~/.local/share/maxfbeditor/scripts/`
   - macOS: `~/Library/Application Support/Maxima Fiction Book Editor/scripts/`
3. переносная папка рядом с программой (`user/scripts/`),
4. скрипты, поставляемые с редактором (только для чтения, внутри установки).

Внутри папки скриптов каждая **группа** — подпапка, а каждый **скрипт** — подпапка группы.
Префикс `NN_` задаёт порядок групп и скриптов и в названии не показывается:

```text
scripts/
├── 01_Регистр/                      → подменю «Регистр» (порядок 1)
│   ├── group.json                   необязательно: {"names": {"en": "Case", "ru": "Регистр"}}
│   ├── 01_К верхнему регистру/      → один скрипт = одна папка
│   │   ├── script.json              манифест (обязателен)
│   │   ├── index.js                 входной модуль (обязателен, если "entry" не указывает другой)
│   │   └── icon.png                 значок 16 px для панели скриптов (необязательно, PNG/ICO/SVG)
│   └── 02_К нижнему регистру/
├── 06_Чистка/
└── tree/                            → скрипты вида "tree" (контекстное меню дерева документа)
    └── Пример 1/
```

После добавления или правки пакета выберите **Скрипты > Перечитать скрипты** (список также
обновляется при запуске редактора и при смене папки). Папка без `script.json` или с
неверным манифестом пропускается, о ней сообщается в журнале ошибок и в
**Настройки > Другое**.

### Как изменить встроенный скрипт

Встроенные скрипты нельзя править на месте. Скопируйте папку скрипта в личную папку
скриптов, задайте в `script.json` **новый `id`** (копия с тем же id игнорируется —
побеждает встроенный скрипт) и измените `name`, чтобы различать их. Копия появится рядом с
оригиналом; её можно положить в группу с тем же именем — тогда оба окажутся в одном подменю.

## 2. Манифест (`script.json`)

```json
{
  "manifestVersion": 1,
  "id": "fbe.case.upper",
  "name": { "en": "To upper case", "ru": "К верхнему регистру" },
  "description": { "ru": "Переводит выделенный текст в верхний регистр" },
  "kind": "menu",
  "entry": "index.js",
  "icon": "icon.png",
  "defaultHotkey": "Ctrl+Alt+U",
  "needsSelection": true,
  "undoLabel": { "en": "Upper case", "ru": "Верхний регистр" },
  "legacy": { "source": "01_Регистр/01_Верхний регистр.js", "fbeVersion": "2.7" }
}
```

| Поле | Обязательно | Смысл |
|------|-------------|-------|
| `manifestVersion` | да | всегда `1` |
| `id` | нет | уникальный идентификатор (рекомендуется вид обратного DNS); по умолчанию `<папка группы>/<папка скрипта>`; дубликаты в разных папках отмечаются, побеждает первый (сначала встроенные) |
| `name` | да | названия по языкам; `en` обязательно, `ru` желательно |
| `description` | нет | подсказка / текст в строке состояния по языкам |
| `kind` | да | `menu` (меню «Скрипты», панель, горячая клавиша) или `tree` (контекстное меню дерева документа). Если поля нет: `tree` внутри папки `tree/`, иначе `menu`, с предупреждением |
| `entry` | нет | входной модуль внутри папки, по умолчанию `index.js` |
| `icon` | нет | PNG, ICO или SVG внутри папки; скрипты со значком получают кнопку на панели |
| `defaultHotkey` | нет | сочетание вроде `Ctrl+Alt+U`, `Mod+Shift+F5` (`Mod` = Ctrl, на macOS Cmd); пользователь может изменить его в Настройки > Горячие клавиши (группа «Скрипты»); конфликты показываются там же |
| `needsSelection` | нет | команда недоступна, пока в виде «Текст» ничего не выделено |
| `undoLabel` | нет | подпись единственного шага отмены (по умолчанию — название) |
| `legacy` | нет | происхождение сконвертированного скрипта FBE |

## 3. Скрипт

Входной модуль экспортирует одну асинхронную функцию по умолчанию, получающую контекст:

```js
export default async function run(ctx) {
  // ctx.script     = { id, name, group, kind }
  // ctx.uiLanguage = 'en' | 'ru'
  // ctx.treeNode   = { nodeId, type } для kind "tree" (узел, по которому щёлкнули правой кнопкой)
  // ctx.cancelled  = true, когда пользователь попросил прервать выполнение
  const selection = await mfbe.selection.get();
  await mfbe.ui.message(selection ? selection.text : 'Ничего не выделено');
}
```

Всё взаимодействие с редактором идёт через глобальный объект `mfbe`, и **каждый вызов
возвращает Promise** — всегда пишите `await`. Весь запуск — один шаг отмены: одна команда
**Правка > Отменить** откатывает всё, что изменил скрипт. Пока скрипт работает, строка
состояния показывает «Выполняется скрипт…»; через 30 секунд без единого вызова `mfbe`
редактор спрашивает, подождать или прервать; прерывание останавливает скрипт немедленно и
откатывает его изменения. Ошибки показываются как
`Ошибка скрипта: <сообщение> в строке L, позиция C` (строка и позиция внутри файла скрипта)
и записываются в журнал ошибок. Скрипт может подключать другие модули из своей папки
(`import { helper } from './lib/helper.js'`); ничего за пределами папки загрузить нельзя.

Скрипт запускается из **Скрипты > <группа> > <название>**, кнопкой на панели, горячей
клавишей или командой **Скрипты > Последний скрипт**. Скрипты вида `tree` появляются в
разделе **Скрипты** контекстного меню дерева документа.

## 4. Интерфейс `mfbe`

Узлы адресуются **ссылками** `{ nodeId, type }` (или просто строкой `nodeId`). `type` — имя
элемента FB2: `body`, `section`, `title`, `epigraph`, `annotation`, `p`, `subtitle`,
`text-author`, `v`, `stanza`, `poem`, `cite`, `empty-line`, `table`, `tr`, `td`, `th`,
`image`, `inline-image`, `date`. Содержимое узлов — JSON модели документа редактора (см.
`mfbe.d.ts` и типы `document-model`, на которые он ссылается): узел —
`{ type, attrs, content }`, текст — `{ type: 'text', text, marks }`, где marks — `strong`,
`emphasis`, `strikethrough`, `sub`, `sup`, `code`, `{ type: 'style', attrs: { name } }` и
`{ type: 'link', attrs: { href, type: 'note' } }`.

### 4.1 Документ — `mfbe.doc`

| Член | Что делает | Пример |
|------|------------|--------|
| `doc.get()` | Снимок всей книги (описание, тела, метаданные бинарных объектов) в JSON. Снимки больше 64 МБ отклоняются — используйте функции обхода | [08-tree-command.js](examples/08-tree-command.js) |
| `doc.getNode(ref)` | Снимок одного узла с поддеревом | [04-structure.js](examples/04-structure.js) |
| `doc.replaceNode(ref, node)` | Заменяет поддерево узла; id узла сохраняется; тип должен быть допустим в этой позиции родителя | [04-structure.js](examples/04-structure.js) |
| `doc.insertNode(where, ref, node)` | Вставляет `node` `'before'` / `'after'` узла-ориентира или `'append'` — последним потомком; возвращает ссылку на новый узел. `'after'` последнего тела с `{ type: 'body', attrs: { name: 'notes' }, … }` создаёт новое тело | [04-structure.js](examples/04-structure.js) |
| `doc.removeNode(ref)` | Удаляет узел с поддеревом. Можно удалить любое тело, кроме первого (книге нужно основное тело); последний раздел тела остаётся | [04-structure.js](examples/04-structure.js) |
| `doc.setDescription(description)` | Заменяет весь блок описания (title-info, document-info, …) | [08-tree-command.js](examples/08-tree-command.js) |
| `doc.getElementsByTagName(name, within?)` | Все узлы с данным именем элемента FB2 в порядке документа, при желании — внутри поддерева. Для инлайновых пометок (`emphasis`, `strong`, `link`…) возвращаются текстовые блоки, их содержащие | [02-walk-paragraphs.js](examples/02-walk-paragraphs.js) |
| `doc.textOf(ref)` | Простой текст поддерева (текстовые блоки через `\n`, инлайновые картинки как U+FFFC) | [02-walk-paragraphs.js](examples/02-walk-paragraphs.js) |
| `doc.setText(ref, text)` | Заменяет содержимое текстового блока (`p`, `subtitle`, `v`, `text-author`, `td`, `th`, `date`) простым текстом; инлайновая разметка теряется | [02-walk-paragraphs.js](examples/02-walk-paragraphs.js) |
| `doc.parentOf(ref)` / `doc.childrenOf(ref)` | Структурный родитель (null у тела) и непосредственные потомки | [04-structure.js](examples/04-structure.js) |
| `doc.find(query)` | Совпадения поиска по всем текстовым блокам (или `within` поддерева): `{ text, regex?, matchCase?, wholeWord?, within? }` → `[{ nodeId, from, to, text }]` | [03-replace-all.js](examples/03-replace-all.js) |
| `doc.replaceAll(query, replacement)` | Заменяет все совпадения; при `regex: true` замена понимает `$1`–`$9`, `$0`, `$+`, `$U`/`$L`/`$T` (регистр), `$S`/`$E` (strong/emphasis), `$Q` (сброс), как Правка > Заменить; возвращает `{ count }`. Выражения компилируются с флагом `u` (экранирования вроде `\"` недопустимы); в замене по регулярному выражению нет способа записать буквальный `$` | [03-replace-all.js](examples/03-replace-all.js) |
| `doc.binaries()` | Метаданные бинарных объектов (`id`, `contentType`, `size`, `width`, `height`…), но не байты | [06-statistics.js](examples/06-statistics.js) |
| `doc.stats()` | `{ characters, words, paragraphs, sections, images, notes, binaryBytes }` | [06-statistics.js](examples/06-statistics.js) |

Правки через `doc.*` проверяются по схеме до каких-либо изменений: вставка `title` после
абзаца, `p` прямо в `body` или узла с недопустимым поддеревом (раздел, в котором абзацы
перемешаны с подразделами; пустой стих) завершится понятной ошибкой, а не испорченной книгой.
Ошибки вызовов `mfbe` — отклонённые промисы с `name` `ScriptApiError` и полем `code`:
`invalidNode` (в сообщении указан путь нарушения, например `invalid node at
"section/poem[2]"`), `notAllowed` (родитель стал бы недопустимым), `unknownNode` (устаревший
id узла) или `apiError` (неверные аргументы или состояние). Операции с узлами охватывают
только тела: аннотация и история описания правятся через `doc.setDescription`.

### 4.2 Выделение и курсор — `mfbe.selection`

| Член | Что делает | Пример |
|------|------------|--------|
| `selection.get()` | `{ anchor: {nodeId, offset}, head, text, nodes }`; `null` только когда книга не открыта. Без выделения в виде «Текст» возвращает схлопнутое выделение (`anchor` = `head`, `text: ''`) в начале первого текстового блока — «ничего не выделено» проверяйте через `text === ''`. Для выделенной картинки: `nodes: []`, `text: '\uFFFC'`, а `anchor.nodeId` — абзац (инлайновая картинка) или тело (блочная) | [01-upper-case.js](examples/01-upper-case.js) |
| `selection.set(anchor, head?)` | Переставляет курсор / выделяет диапазон (смещения — в символах внутри текстового блока); `anchor` и `head` могут лежать в разных текстовых блоках | [09-long-running.js](examples/09-long-running.js) |
| `selection.replaceText(text)` | Заменяет выделенный текст (пометки вокруг сохраняются) | [01-upper-case.js](examples/01-upper-case.js) |
| `selection.wrap(mark)` | Накладывает на выделение `'strong'`, `'emphasis'`, `'strikethrough'`, `'sub'`, `'sup'`, `'code'`, `{ style: 'имя' }` или `{ link: '#id', note: true }` | [05-footnotes-form.js](examples/05-footnotes-form.js) |
| `selection.unwrap(mark)` | Снимает пометку (`'style'` и `'link'` снимают любой именованный стиль / ссылку) | [04-structure.js](examples/04-structure.js) |
| `selection.selectNode(ref)` | Выделяет узел целиком и прокручивает к нему вид «Текст» | [04-structure.js](examples/04-structure.js) |
| `selection.scrollIntoView()` | Прокручивает к текущему выделению | [04-structure.js](examples/04-structure.js) |

### 4.3 Диалоги и строка состояния — `mfbe.ui`

| Член | Что делает | Пример |
|------|------------|--------|
| `ui.message(text, options?)` | Окно сообщения; `options.buttons` — список `{ id, label, default?, cancel? }` (по умолчанию OK), `options.icon` — `info`/`warning`/`error`/`question`; возвращает id нажатой кнопки | [06-statistics.js](examples/06-statistics.js) |
| `ui.prompt(text, options?)` | Однострочный ввод; возвращает текст или `null` при отмене; при `yesNoCancel: true` кнопки Да / Нет / Отмена («Нет» возвращает `''`) | [07-legacy-port.js](examples/07-legacy-port.js) |
| `ui.form(spec)` | Декларативный модальный диалог с полями `text` (можно `multiline`), `number` (`min`/`max`), `checkbox`, `select`, `radio`, `list` (`multiple`; значение всегда массив) и `static`; возвращает `{ idПоля: значение }` или `null` при отмене. Одна форма за раз — палитра или «живой» список делаются циклом форм | [05-footnotes-form.js](examples/05-footnotes-form.js) |
| `ui.status(text, options?)` | Текст в строке состояния; стирается по окончании скрипта, если не задано `{ sticky: true }` | [01-upper-case.js](examples/01-upper-case.js) |
| `ui.progress(done, total?, label?)` | Ход выполнения в строке состояния; также сбрасывает 30-секундный таймер «скрипт всё ещё выполняется» — вызывайте в длинных циклах | [09-long-running.js](examples/09-long-running.js) |

### 4.4 Помощники правки — `mfbe.edit`

| Член | Что делает | Пример |
|------|------------|--------|
| `edit.label(text)` | Называет подшаг (информационно; запуск остаётся одним шагом отмены) | [05-footnotes-form.js](examples/05-footnotes-form.js) |
| `edit.nbsp` | Неразрывный пробел (`'\u00A0'`) | [09-long-running.js](examples/09-long-running.js) |
| `edit.symbols()` | Таблица символов редактора `[{ codepoint, name }]` (Настройки > Символы) | [06-statistics.js](examples/06-statistics.js) |

### 4.5 Окружение — `mfbe.env`

| Член | Что делает | Пример |
|------|------------|--------|
| `env.settings()` | Только чтение: `{ nbspDisplayChar, pasteImageFormat, jpegQuality, uiLanguage }` | [06-statistics.js](examples/06-statistics.js) |
| `env.docLanguage()` | Язык книги (`title-info/lang`) | [06-statistics.js](examples/06-statistics.js) |

### 4.6 Функции совместимости

Для механического переноса следующие функции доступны и как глобальные, и как члены
`mfbe.*` (см. [07-legacy-port.js](examples/07-legacy-port.js)):

| Функция | Поведение |
|---------|-----------|
| `MsgBox(text, caption?, flags?)` | Окно сообщения в стиле VBScript: `flags` задают кнопки (0 OK, 1 OK/Отмена, 2 Прервать/Повторить/Пропустить, 3 Да/Нет/Отмена, 4 Да/Нет, 5 Повторить/Отмена), значок (16 ошибка, 32 вопрос, 48 предупреждение, 64 информация) и кнопку по умолчанию (256 вторая, 512 третья); возвращает 1 OK, 2 Отмена, 3 Прервать, 4 Повторить, 5 Пропустить, 6 Да, 7 Нет |
| `InputBox(prompt, caption?, defaultValue?)` | Запрос текста; возвращает текст или `null` при отмене |
| `BeginUndoUnit(label?)` / `EndUndoUnit()` | Пустые функции для перенесённого кода (запуск и так один шаг отмены) |

## 5. Правила песочницы

Скрипт выполняется в отдельном Web Worker с закрытым каналом к редактору. До загрузки
скрипта удаляются `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`,
`Worker`, `SharedWorker`, `indexedDB`, `caches`, `navigator`, `BroadcastChannel`,
`MessageChannel`, `OffscreenCanvas`, `performance.memory` и собственные `postMessage`/`close`
воркера; политика безопасности страницы (CSP) дополнительно запрещает любой доступ к сети и
загрузку модулей не из папки скрипта. Нет файловой системы, буфера обмена, доступа к HTML
редактора и хранилищ. Полный язык JavaScript и его встроенные объекты (`String`, `RegExp`,
`Array`, `Map`, `Math`, `Date`, `Intl`, `JSON`, `Promise`, `setTimeout`, `console` — в
отладочных сборках попадает в журнал редактора) остаются доступны. Расширение интерфейса
`mfbe` — решение авторов редактора; скрипт не может расширить его сам.

## 6. Перенос скриптов из оригинального FictionBook Editor

Оригинальные скрипты — это JScript внутри отображения книги в Internet Explorer: они обходили
HTML DOM (`document.all.tags("P")`, `innerText`, `TextRange`) и вызывали несколько функций
хоста. Возможности соответствуют одна к одной:

| Было (FBE 2.x) | Стало (Maxima) | Примечание |
|----------------|----------------|------------|
| `function Run() { ... }` | `export default async function run(ctx) { ... }` | перед каждым вызовом `mfbe` — `await` |
| `MsgBox(text)` | `await MsgBox(text)` или `await mfbe.ui.message(text)` | |
| `window.external.AskYesNo(text)` | `(await MsgBox(text, caption, 4)) === 6` | или `ui.message` с кнопками Да/Нет |
| `InputBox(prompt, title, value)` | `await InputBox(prompt, title, value)` | `null` при отмене |
| `window.external.BeginUndoUnit(document, name)` / `EndUndoUnit(document)` | `await BeginUndoUnit(name)` / `await EndUndoUnit()` | необязательно — запуск и так один шаг отмены |
| `window.external.SetStatusBarText(text)` | `await mfbe.ui.status(text)` | |
| `window.external.GetNBSP()` | `mfbe.edit.nbsp` | |
| `window.external.GetBinarySize(data)` | `(await mfbe.doc.binaries()).find(b => b.id === id).size` | байты скриптам недоступны |
| `window.external.GetViewWidth()/Height()` | нет | зависит от вёрстки; для параметров используйте `ui.form` |
| `window.showModalDialog("dialog.htm", ...)` | `await mfbe.ui.form({...})` | один `FormSpec` на каждый HTML-диалог |
| `document.all.tags("P")`, `getElementsByTagName("DIV")` | `await mfbe.doc.getElementsByTagName('p')` (`'section'`, `'title'`, …) | имена FB2, а не классы HTML |
| `el.innerText` | `await mfbe.doc.textOf(ref)` | |
| `el.innerText = s` | `await mfbe.doc.setText(ref, s)` | теряет инлайновые пометки; для текстовых замен лучше `replaceAll` |
| `el.innerHTML = ...`, `outerHTML` | `doc.replaceNode(ref, node)` / `doc.insertNode(...)` | стройте узлы FB2 в JSON |
| `el.parentElement`, `el.children` | `doc.parentOf(ref)`, `doc.childrenOf(ref)` | |
| `document.selection.createRange().text` | `(await mfbe.selection.get()).text` | |
| `range.text = s`, `range.pasteHTML(...)` | `await mfbe.selection.replaceText(s)`, `selection.wrap(...)` | |
| `api.fbwDoc` / `doc.Description...` | `await mfbe.doc.get()` + `doc.setDescription(...)` | |
| `TreeCmd`: `ProcessCmd()`, `GetClassName()`, `GetTitle()` | `kind: "tree"`, `run(ctx)` с `ctx.treeNode`, `name` в манифесте | классы подсветки заменяются правками или `selection.selectNode` |

Уровни конвертации встроенных скриптов: **уровень 1** (текст/регэкспы по абзацам,
MsgBox/InputBox) переносится механически через функции совместимости; **уровень 2** (разделы,
сноски, картинки, стихи) переписывается на `mfbe.doc`; **уровень 3** (HTML-диалоги) заменяет
каждый `.htm` на спецификацию `ui.form`; **уровень 4** (отладочные инструменты движка)
заменяется или убирается с пометкой в примечаниях к выпуску. `tools/legacy-script-audit.py`
классифицирует оригинальные скрипты и создаёт заготовки манифестов;
`tests/scripts/run-script.mjs` запускает пакет без интерфейса на тестовой книге и печатает
итоговый FB2 для сравнения со снимком.

## 7. Памятка для нового скрипта

1. Создайте `<папка скриптов>/<NN_Группа>/<NN_Название>/` с `script.json` и `index.js`
   (за основу возьмите `tools/script-template/`).
2. `export default async function run(ctx)`; `await` перед каждым вызовом `mfbe`.
3. Прочитайте нужное (`selection.get`, `doc.getElementsByTagName`, `doc.textOf`), измените
   (`selection.replaceText`, `doc.setText`, `doc.replaceAll`, `doc.insertNode`…), сообщите
   пользователю (`ui.status`, `ui.message`).
4. В длинных циклах вызывайте `ui.progress` и останавливайтесь, когда `ctx.cancelled`.
5. **Скрипты > Перечитать скрипты**, запустите скрипт, нажмите **Правка > Отменить** один раз
   и убедитесь, что откатился весь запуск.
