# Legacy script conversion plan

Source: `/root/maxfbeditor/reference/fictionbookeditor/FBE/files` — 147 scripts.

| Group | Scripts | Tier 1 | Tier 2 | Tier 3 | Tier 4 | HTML dialogs | Encodings |
|-------|---------|--------|--------|--------|--------|--------------|-----------|
| `01_Регистр` | 8 | 7 | 0 | 1 | 0 | 1 | utf-8 |
| `02_Добавление примечания` | 9 | 0 | 9 | 0 | 0 | 0 | utf-8 |
| `03_Добавление комментария` | 8 | 0 | 8 | 0 | 0 | 0 | utf-8 |
| `04_Примечания и комментарии из скобок` | 12 | 0 | 12 | 0 | 0 | 0 | utf-8 |
| `05_Иллюстрации` | 9 | 0 | 7 | 1 | 1 | 1 | utf-8 |
| `06_Чистка` | 16 | 7 | 4 | 5 | 0 | 5 | utf-8 |
| `07_Символы` | 7 | 0 | 0 | 7 | 0 | 7 | utf-8 |
| `08_Структура разделов` | 4 | 0 | 2 | 2 | 0 | 2 | utf-8 |
| `09_Стихи` | 3 | 0 | 3 | 0 | 0 | 0 | utf-8 |
| `10_Статистика` | 3 | 2 | 0 | 1 | 0 | 1 | utf-8 |
| `11_Заголовки картинок в подписи` | 5 | 0 | 5 | 0 | 0 | 0 | utf-8 |
| `12_Обработка кавычек` | 15 | 8 | 7 | 0 | 0 | 0 | utf-8 |
| `13_Подзаголовки, пустые строки` | 4 | 0 | 4 | 0 | 0 | 0 | utf-8 |
| `16_Поиск форматирования` | 24 | 24 | 0 | 0 | 0 | 0 | utf-8 |
| `17_Перенос примечаний в скобки` | 3 | 0 | 3 | 0 | 0 | 0 | utf-8 |
| `18_Мелочи редактирования` | 9 | 3 | 5 | 1 | 0 | 1 | utf-8 |
| `19_Обработка форматирования` | 1 | 0 | 0 | 1 | 0 | 1 | utf-8 |
| `20_Инструменты отладки` | 3 | 0 | 0 | 0 | 3 | 1 | utf-8, utf-8-sig |
| `21_Поиск и замена` | 2 | 2 | 0 | 0 | 0 | 0 | utf-8, utf-8-sig |
| `(root)` | 1 | 1 | 0 | 0 | 0 | 0 | windows-1251 |
| `tree` | 1 | 0 | 1 | 0 | 0 | 0 | utf-8 |
| **Total** | 147 | 54 | 70 | 19 | 4 | | |

## Scripts

### `01_Регистр`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `01_Регистр/01_Верхний регистр.js` | 1 | Upper case | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeChild |  |  |
| `01_Регистр/02_Нижний регистр.js` | 1 | Lower case | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeChild |  |  |
| `01_Регистр/03_Предложение_alxs.js` | 1 | Predlozhenie_alxs *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, RegExp |  |  |
| `01_Регистр/04_Предложение.js` | 1 | Sentence case | BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeChild, RegExp |  |  |
| `01_Регистр/05_Капитализация выделения.js` | 1 | Capitalisation of the selection | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeChild, RegExp |  |  |
| `01_Регистр/06_Капитализация первого слова.js` | 1 | Capitalisation of the first word | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeChild, RegExp |  |  |
| `01_Регистр/07_Циклическое изменение регистра.js` | 1 | Cyclic change of case | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeChild, RegExp |  |  |
| `01_Регистр/08_Регистр заголовков и подзаголовков....js` | 3 | Case of titles and subtitles... | showModalDialog, getElementById | HTML/Регистр заголовков - набор фреймов.html |  |

### `02_Добавление примечания`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `02_Добавление примечания/01_Добавить сноску, оставшись на ее ссылке.js` | 2 | Add footnote, staying on its reference | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/02_Добавить сноску, введя ее текст в окошке.js` | 2 | Add footnote, entering its text into a dialog | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/03_Добавить сноску, перейти к ее разделу.js` | 2 | Add footnote, go to its section | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/04_Унификация сносок.js` | 2 | Unification of footnotes | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/05_Добавить последнюю сноску, оставшись на ее ссылке.js` | 2 | Add last footnote, staying on its reference | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/06_Добавить последнюю сноску, введя ее текст в окошке.js` | 2 | Add last footnote, entering its text into a dialog | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/07_Добавить последнюю сноску, перейти к ее разделу.js` | 2 | Add last footnote, go to its section | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/08_Унификация сносок (с удалением неиспользуемых разделов сносок).js` | 2 | Unification of footnotes (s udaleniem neispolzuemykh of sections snosok) *(draft)* | MsgBox, confirm, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `02_Добавление примечания/20_Тест сносок.js` | 2 | Test of footnotes | MsgBox, getElementsByTagName, getElementById, innerHTML, className, RegExp |  |  |

### `03_Добавление комментария`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `03_Добавление комментария/01_Добавить комментарий, оставшись на его ссылке.js` | 2 | Add kommentariy, staying on ego reference *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/02_Добавить комментарий, введя его текст в окошке.js` | 2 | Add kommentariy, entering ego text into a dialog *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/03_Добавить комментарий, перейти к его разделу.js` | 2 | Add kommentariy, go to ego section *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/04_Унификация комментариев.js` | 2 | Unification comments | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/05_Добавить последний комментарий, оставшись на его ссылке.js` | 2 | Add posledniy kommentariy, staying on ego reference *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/06_Добавить последний комментарий, введя его текст в окошке.js` | 2 | Add posledniy kommentariy, entering ego text into a dialog *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/07_Добавить последний комментарий, перейти к его разделу.js` | 2 | Add posledniy kommentariy, go to ego section *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `03_Добавление комментария/08_Унификация комментариев (с удалением неиспользуемых разделов комментариев).js` | 2 | Unification comments (s udaleniem neispolzuemykh of sections kommentariev) *(draft)* | MsgBox, confirm, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |

### `04_Примечания и комментарии из скобок`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `04_Примечания и комментарии из скобок/601_Примечания из [].js` | 2 | Footnotes from [] | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  |  |
| `04_Примечания и комментарии из скобок/602_Примечания из {}.js` | 2 | Footnotes from {} | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  | id suffixed to stay unique |
| `04_Примечания и комментарии из скобок/603_Примечания из [! !].js` | 2 | Footnotes from [! !] | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  | id suffixed to stay unique |
| `04_Примечания и комментарии из скобок/604_Примечания из [~ ~].js` | 2 | Footnotes from [~ ~] | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  | id suffixed to stay unique |
| `04_Примечания и комментарии из скобок/605_Примечания из скобок, заданных регэкспами.js` | 2 | Footnotes from skobok, given by regular expressions *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  |  |
| `04_Примечания и комментарии из скобок/606_Примечания из скобок, заданных простым текстом.js` | 2 | Footnotes from skobok, given by plain text *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  |  |
| `04_Примечания и комментарии из скобок/607_Комментарии из [].js` | 2 | Comments from [] | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  |  |
| `04_Примечания и комментарии из скобок/608_Комментарии из {}.js` | 2 | Comments from {} | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  | id suffixed to stay unique |
| `04_Примечания и комментарии из скобок/609_Комментарии из [! !].js` | 2 | Comments from [! !] | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  | id suffixed to stay unique |
| `04_Примечания и комментарии из скобок/610_Комментарии из [~ ~].js` | 2 | Comments from [~ ~] | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  | id suffixed to stay unique |
| `04_Примечания и комментарии из скобок/611_Комментарии из скобок, заданных регэкспами.js` | 2 | Comments from skobok, given by regular expressions *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  |  |
| `04_Примечания и комментарии из скобок/612_Комментарии из скобок, заданных простым текстом.js` | 2 | Comments from skobok, given by plain text *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeChild, removeNode, cloneNode, className, RegExp |  |  |

### `05_Иллюстрации`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `05_Иллюстрации/01_Проверка иллюстраций.js` | 2 | Proverka illyustratsiy *(draft)* | MsgBox, getElementsByTagName, document.all |  |  |
| `05_Иллюстрации/02_Унификация вложений и иллюстраций.js` | 2 | Unification vlozheniy and illyustratsiy *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, getElementsByTagName, document.all, getElementById, appendChild, replaceNode, cloneNode, className, RegExp |  |  |
| `05_Иллюстрации/03_Обновление иллюстраций.js` | 2 | Obnovlenie illyustratsiy *(draft)* | getElementsByTagName |  |  |
| `05_Иллюстрации/04_Сохранить вложения на диск.js` | 4 | Sokhranit vlozheniya on disk *(draft)* | MsgBox, AskYesNo, SaveBinary, getElementsByTagName, document.all |  |  |
| `05_Иллюстрации/05_Удалить все вложения.js` | 2 | Udalit all vlozheniya *(draft)* | MsgBox, AskYesNo, BeginUndoUnit, EndUndoUnit, getElementsByTagName, document.all, innerHTML, outerHTML |  |  |
| `05_Иллюстрации/06_Пустые строки возле иллюстраций....js` | 2 | Empty lines vozle illyustratsiy... *(draft)* | MsgBox, confirm, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, inflateBlock, getElementById, innerText, createElement, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |
| `05_Иллюстрации/07_Удаление неиспользуемых вложений....js` | 2 | Removal neispolzuemykh vlozheniy... *(draft)* | MsgBox, confirm, BeginUndoUnit, EndUndoUnit, getElementsByTagName, document.all, getElementById, removeNode, className, RegExp |  |  |
| `05_Иллюстрации/08_Разметка подписей к иллюстрациям....js` | 3 | Razmetka podpisey to illyustratsiyam... *(draft)* | MsgBox, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, GetViewSize, TextRange, getElementById, innerHTML, createElement, removeNode, className, RegExp, setTimeout | HTML/Разметка подписей к картинкам.html | uses view size: not available to scripts, use ui.form for options |
| `05_Иллюстрации/09_Сделать обычный рисунок из рисунка в тексте.js` | 2 | Sdelat obychnyy risunok from risunka into tekste *(draft)* | alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, outerHTML, insertAdjacentHTML, removeNode |  |  |

### `06_Чистка`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `06_Чистка/02_Генеральная уборка.js` | 2 | General clean-up | MsgBox, AskYesNo, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerHTML, className, RegExp |  |  |
| `06_Чистка/03_Латиница в Кириллице.js` | 1 | Latin letters into cyrillic | MsgBox, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerHTML, className, RegExp |  |  |
| `06_Чистка/04_Фамилия И. О..js` | 1 | Surname I. O. | MsgBox, InputBox, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, className, RegExp |  |  |
| `06_Чистка/05_Слипшиеся слова.js` | 1 | Stuck-together word | MsgBox, InputBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, className, RegExp |  |  |
| `06_Чистка/06_Управляемое исправление разрывов абзацев....js` | 3 | Guided fixing of breaks of paragraphs... | MsgBox, BeginUndoUnit, EndUndoUnit, GetNBSP, showModalDialog, getElementById, innerText, outerHTML, appendChild, removeChild, cloneNode, className, RegExp | HTML/интеракт. удаление разрывов - выбор режимов.htm, HTML/интеракт. удаление разрывов - спорные места.htm |  |
| `06_Чистка/07_10.000.000.000.js` | 1 | 10.000.000.000 | MsgBox, InputBox, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, className, RegExp |  |  |
| `06_Чистка/08_Дефис - Тире.js` | 1 | Hyphen - dash | MsgBox, InputBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, className, RegExp |  |  |
| `06_Чистка/10_Точка..js` | 1 | Dot. | MsgBox, InputBox, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, className, RegExp |  |  |
| `06_Чистка/12_Удаление возвратов.js` | 2 | Removal of carriage returns | MsgBox, AskYesNo, getElementsByTagName, getElementById, innerHTML, outerHTML, className, RegExp |  |  |
| `06_Чистка/14_Разрыв предложения.js` | 2 | Break of a sentence | MsgBox, AskYesNo, GetNBSP, getElementsByTagName, getElementById, innerHTML, outerHTML, className, RegExp |  |  |
| `06_Чистка/15_Точка, тире, буква....js` | 3 | Dot, dash, letter... | GetNBSP, showModalDialog, getElementById | HTML/Точка, тире, буква - набор фреймов.html |  |
| `06_Чистка/16_Точка, тире, буква (без поиска многоточий).js` | 3 | Dot, dash, letter (without search ellipses) | GetNBSP, showModalDialog, getElementById | HTML/Точка, тире, буква (без поиска многоточий) - набор фреймов.html |  |
| `06_Чистка/17_Превращение внешних ссылок в текст.js` | 1 | Conversion vneshnikh ssylok into text *(draft)* | BeginUndoUnit, EndUndoUnit, innerHTML, outerHTML, RegExp |  |  |
| `06_Чистка/19_Символы win-1252 (буквы)....js` | 3 | Symbols win-1252 (letters)... | GetViewSize, showModalDialog, document.selection, TextRange, getElementById, innerHTML, RegExp | HTML/Символы win-1252 в файле win-1251 - набор фреймов.html | uses view size: not available to scripts, use ui.form for options |
| `06_Чистка/20_Символы win-1252 (слова)....js` | 3 | Symbols win-1252 (words)... | alert, GetNBSP, GetViewSize, showModalDialog, document.selection, TextRange, getElementById, innerHTML, className, RegExp | HTML/Символы win-1252 в файле win-1251 - набор фреймов.html | uses view size: not available to scripts, use ui.form for options |
| `06_Чистка/21_Удаление тегов style.js` | 2 | Removal tegov style *(draft)* | BeginUndoUnit, EndUndoUnit, getElementById, removeNode, className |  |  |

### `07_Символы`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `07_Символы/01_Спецсимволы.js` | 3 | Special symbols | getElementById | Scripts/spez.htm |  |
| `07_Символы/02_Диакритика.js` | 3 | Diacritics | getElementById | Scripts/CE.htm |  |
| `07_Символы/Арабский.js` | 3 | Arabic | getElementById | Scripts/арабский.htm |  |
| `07_Символы/Валюта.js` | 3 | Currency | getElementById | Scripts/валюты.htm |  |
| `07_Символы/Греческий.js` | 3 | Greek | getElementById | Scripts/греческий.htm |  |
| `07_Символы/Древнерусский.js` | 3 | Old russian | getElementById | Scripts/древнерусский.htm |  |
| `07_Символы/Иврит.js` | 3 | Hebrew | getElementById | Scripts/иврит.htm |  |

### `08_Структура разделов`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `08_Структура разделов/01_Управление структурой разделов и их заголовками....js` | 3 | Managing the structure of sections and their titles... | BeginUndoUnit, EndUndoUnit, showModalDialog, getElementById, innerHTML | HTML/modal_dialog.htm |  |
| `08_Структура разделов/02_Разбить документ на разделы....js` | 3 | Razbit dokument on razdely... *(draft)* | getElementById | HTML/Разбиение на секции - задание параметров.htm |  |
| `08_Структура разделов/03_Опустить раздел на один уровень.js` | 2 | Lower section on one level | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeChild, className |  |  |
| `08_Структура разделов/04_Сброс структуры разделов.js` | 2 | Sbros struktury of sections *(draft)* | BeginUndoUnit, EndUndoUnit, getElementById, insertAdjacentHTML, createElement, removeNode, className |  |  |

### `09_Стихи`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `09_Стихи/01_Слияние подряд идущих стихов.js` | 2 | Sliyanie podryad idushchikh stikhov *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, GetNBSP, SetStatusBarText, document.selection, TextRange, getElementById, innerHTML, insertAdjacentHTML, removeChild, removeNode, className, RegExp |  |  |
| `09_Стихи/02_Драма....js` | 2 | Drama... *(draft)* | MsgBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerHTML, className, RegExp |  |  |
| `09_Стихи/03_Слить параграфы.js` | 2 | Slit paragrafy *(draft)* | BeginUndoUnit, EndUndoUnit, document.selection, TextRange, RegExp |  |  |

### `10_Статистика`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `10_Статистика/01_Показать все ссылки.js` | 1 | Show all links | MsgBox, getElementsByTagName, innerText |  |  |
| `10_Статистика/02_Показать все-все ссылки.js` | 3 | Show all links | MsgBox, window.open, getElementsByTagName, innerText | Scripts/links.htm |  |
| `10_Статистика/03_Статистика документа.js` | 1 | Statistics dokumenta *(draft)* | MsgBox, GetBinarySize, getElementsByTagName, document.all, getElementById, innerText, className |  |  |

### `11_Заголовки картинок в подписи`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `11_Заголовки картинок в подписи/600_Заголовок картинки в подпись (strong).js` | 2 | Title images into caption (strong) | MsgBox, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, getElementById, innerHTML, outerHTML, createElement, insertBefore, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `11_Заголовки картинок в подписи/601_Заголовок картинки в подпись (emphasis).js` | 2 | Title images into caption (emphasis) | MsgBox, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, getElementById, innerHTML, outerHTML, createElement, insertBefore, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `11_Заголовки картинок в подписи/602_Заголовок картинки в подпись (subtitle).js` | 2 | Title images into caption (subtitle) | MsgBox, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, getElementById, innerHTML, outerHTML, createElement, insertBefore, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `11_Заголовки картинок в подписи/603_Заголовок картинки в подпись (subtitle, strong).js` | 2 | Title images into caption (subtitle, strong) | MsgBox, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, getElementById, innerHTML, outerHTML, createElement, insertBefore, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `11_Заголовки картинок в подписи/604_Заголовок картинки в подпись (subtitle, emphasis).js` | 2 | Title images into caption (subtitle, emphasis) | MsgBox, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, getElementById, innerHTML, outerHTML, createElement, insertBefore, className |  | uses window.external.inflateBlock (IE layout helper): drop |

### `12_Обработка кавычек`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `12_Обработка кавычек/001_Расстановка елочек и лапок.js` | 2 | Placement of guillemets and of low quotes | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `12_Обработка кавычек/002_Расстановка елочек и лапок (начиная с 1-го уровня).js` | 2 | Placement of guillemets and of low quotes (nachinaya s 1-go urovnya) *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `12_Обработка кавычек/003_Расстановка елочек и лапок (начиная со 2-го уровня).js` | 2 | Placement of guillemets and of low quotes (nachinaya so 2-go urovnya) *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `12_Обработка кавычек/004_Расстановка елочек и лапок (с позиции курсора).js` | 2 | Placement of guillemets and of low quotes (s pozitsii kursora) *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `12_Обработка кавычек/005_Расстановка елочек и лапок (с позиции курсора, начиная с 1-го уровня).js` | 2 | Placement of guillemets and of low quotes (s pozitsii kursora, nachinaya s 1-go urovnya) *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `12_Обработка кавычек/006_Расстановка елочек и лапок (с позиции курсора, начиная со 2-го уровня).js` | 2 | Placement of guillemets and of low quotes (s pozitsii kursora, nachinaya so 2-go urovnya) *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `12_Обработка кавычек/007_Переход на след. елочки.js` | 1 | Go on to the next guillemets | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/008_Переход на пред. елочки.js` | 1 | Go on to the previous guillemets | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/009_Переход на пред. лапки.js` | 1 | Go on to the previous low quotes | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/010_Переход на след. лапки.js` | 1 | Go on to the next low quotes | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/011_Переход на пред. прямые кавычки.js` | 1 | Go on to the previous straight quotes | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/012_Переход на след. прямые кавычки.js` | 1 | Go on to the next straight quotes | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/013_Переход на пред. прямые кавычки, елочки или лапки.js` | 1 | Go on to the previous straight kavychki, guillemets ili low quotes *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/014_Переход на след. прямые кавычки, елочки или лапки.js` | 1 | Go on to the next straight kavychki, guillemets ili low quotes *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode |  |  |
| `12_Обработка кавычек/015_Расстановка только елочек.js` | 2 | Placement tolko of guillemets *(draft)* | MsgBox, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |

### `13_Подзаголовки, пустые строки`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `13_Подзаголовки, пустые строки/525_Разметка подзаголовков, чистка пустых строк.js` | 2 | Razmetka podzagolovkov, clean-up pustykh strok *(draft)* | MsgBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerText, innerHTML, outerHTML, removeNode, className, RegExp |  |  |
| `13_Подзаголовки, пустые строки/526_Разметка подзаголовков, чистка пустых строк, удаление жирности в заголовках.js` | 2 | Razmetka podzagolovkov, clean-up pustykh strok, removal zhirnosti into zagolovkakh *(draft)* | MsgBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerText, innerHTML, outerHTML, removeNode, className, RegExp |  |  |
| `13_Подзаголовки, пустые строки/527_Разметка подзаголовков, чистка пустых строк; удаление жирности в заголовках по запросу.js` | 2 | Razmetka podzagolovkov, clean-up pustykh strok; removal zhirnosti into zagolovkakh po zaprosu *(draft)* | MsgBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerText, innerHTML, outerHTML, removeNode, className, RegExp |  |  |
| `13_Подзаголовки, пустые строки/528_Разметка подзаголовков, чистка пустых строк, удаление жирности и курсива в заголовках.js` | 2 | Razmetka podzagolovkov, clean-up pustykh strok, removal zhirnosti and kursiva into zagolovkakh *(draft)* | MsgBox, AskYesNo, alert, BeginUndoUnit, EndUndoUnit, GetNBSP, getElementById, innerText, innerHTML, outerHTML, removeNode, className, RegExp |  |  |

### `16_Поиск форматирования`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `16_Поиск форматирования/01_Переход на предыдущий курсив.js` | 1 | Go on predydushchiy italic *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/02_Переход на следующий курсив.js` | 1 | Go on sleduyushchiy italic *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/03_Переход на предыдущий абзац с курсивом.js` | 1 | Go on predydushchiy abzats s kursivom *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/04_Переход на следующий абзац с курсивом.js` | 1 | Go on sleduyushchiy abzats s kursivom *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/05_Переход на предыдущую жирность.js` | 1 | Go on predydushchuyu zhirnost *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/06_Переход на следующую жирность.js` | 1 | Go on sleduyushchuyu zhirnost *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/07_Переход на предыдущий абзац с жирностью.js` | 1 | Go on predydushchiy abzats s zhirnostyu *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/08_Переход на следующий абзац с жирностью.js` | 1 | Go on sleduyushchiy abzats s zhirnostyu *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/09_Переход на предыдущий верхний индекс.js` | 1 | Go on predydushchiy upper indeks *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/10_Переход на следующий верхний индекс.js` | 1 | Go on sleduyushchiy upper indeks *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/11_Переход на предыдущий абзац с верхним индексом.js` | 1 | Go on predydushchiy abzats s verkhnim indeksom *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/12_Переход на следующий абзац с верхним индексом.js` | 1 | Go on sleduyushchiy abzats s verkhnim indeksom *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/13_Переход на предыдующий нижний индекс.js` | 1 | Go on predyduyushchiy lower indeks *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/14_Переход на следующий нижний индекс.js` | 1 | Go on sleduyushchiy lower indeks *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/15_Переход на предыдущий абзац с нижним индексом.js` | 1 | Go on predydushchiy abzats s nizhnim indeksom *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/16_Переход на следующий абзац с нижним индексом.js` | 1 | Go on sleduyushchiy abzats s nizhnim indeksom *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/17_Переход на предыдущее зачеркивание.js` | 1 | Go on predydushchee zacherkivanie *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/18_Переход на следующее зачеркивание.js` | 1 | Go on sleduyushchee zacherkivanie *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/19_Переход на предыдущий абзац, содержащий зачеркивание.js` | 1 | Go on predydushchiy abzats, soderzhashchiy zacherkivanie *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/20_Переход на следующий абзац, содержащий зачеркивание.js` | 1 | Go on sleduyushchiy abzats, soderzhashchiy zacherkivanie *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/21_Переход на предыдущий код.js` | 1 | Go on predydushchiy code *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/22_Переход на следующий код.js` | 1 | Go on sleduyushchiy code *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/23_Переход на предыдущий абзац, содержащий код.js` | 1 | Go on predydushchiy abzats, soderzhashchiy code *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode, className |  | uses window.external.inflateBlock (IE layout helper): drop |
| `16_Поиск форматирования/24_Переход на следующий абзац, содержащий код.js` | 1 | Go on sleduyushchiy abzats, soderzhashchiy code *(draft)* | confirm, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerHTML, outerHTML, removeNode, className |  | uses window.external.inflateBlock (IE layout helper): drop |

### `17_Перенос примечаний в скобки`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `17_Перенос примечаний в скобки/01_Перенос примечаний в скобки.js` | 2 | Moving footnotes into brackets | alert, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerText, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `17_Перенос примечаний в скобки/02_Перенос примечаний в скобки (пробел перед открывающей скобкой).js` | 2 | Moving footnotes into brackets (probel pered otkryvayushchey skobkoy) *(draft)* | alert, BeginUndoUnit, EndUndoUnit, TextRange, getElementById, innerText, innerHTML, outerHTML, createElement, insertBefore, removeNode, className, RegExp |  |  |
| `17_Перенос примечаний в скобки/03_Перенос одного примечания в скобки.js` | 2 | Moving odnogo footnotes into brackets *(draft)* | MsgBox, alert, BeginUndoUnit, EndUndoUnit, inflateBlock, document.selection, TextRange, getElementById, innerText, innerHTML, outerHTML, createElement, appendChild, insertBefore, removeNode, className, RegExp |  | uses window.external.inflateBlock (IE layout helper): drop |

### `18_Мелочи редактирования`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `18_Мелочи редактирования/01_Удаление пробелов.js` | 1 | Removal probelov *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, removeChild, removeNode, RegExp |  |  |
| `18_Мелочи редактирования/02_Вставить ссылку на midi....js` | 3 | Insert a link on midi... | BeginUndoUnit, EndUndoUnit, showModalDialog | HTML/диалог вставки ссылки на midi.htm |  |
| `18_Мелочи редактирования/03_Снятие форматирования стихом, цитатой или эпиграфом.js` | 2 | Snyatie of formatting stikhom, tsitatoy ili epigrafom *(draft)* | alert, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, getElementById, removeNode, className |  |  |
| `18_Мелочи редактирования/04_Вставить пустую строку перед стихом или цитатой.js` | 2 | Insert pustuyu stroku pered stikhom ili tsitatoy *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, insertAdjacentHTML, createElement, className, RegExp |  |  |
| `18_Мелочи редактирования/05_Вставить пустую строку за стихом, эпиграфом или цитатой.js` | 2 | Insert pustuyu stroku za stikhom, epigrafom ili tsitatoy *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, document.selection, TextRange, insertAdjacentHTML, createElement, className, RegExp |  |  |
| `18_Мелочи редактирования/06_Удаление пробелов и дефисов.js` | 1 | Removal probelov and defisov *(draft)* | alert, BeginUndoUnit, EndUndoUnit, GetNBSP, document.selection, TextRange, getElementById, removeChild, removeNode, RegExp |  |  |
| `18_Мелочи редактирования/07_Обрамить верхние индексы скобками [].js` | 2 | Obramit verkhnie indeksy skobkami [] *(draft)* | alert, BeginUndoUnit, EndUndoUnit, getElementById, appendChild, insertBefore |  |  |
| `18_Мелочи редактирования/08_Обрамить верхние индексы скобками {}.js` | 2 | Obramit verkhnie indeksy skobkami {} *(draft)* | alert, BeginUndoUnit, EndUndoUnit, getElementById, appendChild, insertBefore |  | id suffixed to stay unique |
| `18_Мелочи редактирования/09_Нумерацию в началах строк - надстрочным текстом.js` | 1 | Numeratsiyu into nachalakh strok - nadstrochnym text *(draft)* | MsgBox, BeginUndoUnit, EndUndoUnit, GetNBSP, SetStatusBarText, document.selection, TextRange, getElementById, innerHTML, removeChild, className, RegExp |  |  |

### `19_Обработка форматирования`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `19_Обработка форматирования/Обзор и превращение элементов....js` | 3 | Overview and conversion of elements... | showModalDialog, getElementById | HTML/Обзор элементов - набор фреймов.html |  |

### `20_Инструменты отладки`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `20_Инструменты отладки/01_Показать код.js` | 4 | Show code | MsgBox, document.selection, TextRange, outerHTML, className |  |  |
| `20_Инструменты отладки/02_Показать весь код.js` | 4 | Show whole code | window.open, document.selection, TextRange, innerText, outerHTML, className | Scripts/debug.htm |  |
| `20_Инструменты отладки/03_Код в буфер.js` | 4 | Code into clipboard | clipboardData, document.all, getElementById, outerHTML |  |  |

### `21_Поиск и замена`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `21_Поиск и замена/04_Поиск ошибок текста (регекспы от wotti, Roxana, JonVic и др.).js` | 1 | Search of errors of the text (regexps by wotti, Roxana, JonVic and dr.) *(draft)* | MsgBox, alert, GetNBSP, SetStatusBarText, document.selection, TextRange, getElementById, innerHTML, className, RegExp |  |  |
| `21_Поиск и замена/10_Поиск по набору регэкспов (заготовка).js` | 1 | Search po a set of regular expressions (template) *(draft)* | MsgBox, alert, GetNBSP, SetStatusBarText, document.selection, TextRange, getElementById, innerHTML, className, RegExp |  |  |

### `(root)`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `29_Режим чтения.js` | 1 | Mode reading | alert, TextRange, getElementById, outerHTML, RegExp |  | source encoded as windows-1251; convert to UTF-8 |

### `tree`

| Source | Tier | Draft English name | APIs | Dialogs | Notes |
|--------|------|--------------------|------|---------|-------|
| `TreeCmd/Пример 1.js` | 2 | Example 1 | TextRange, document.all, innerText, outerHTML |  |  |

