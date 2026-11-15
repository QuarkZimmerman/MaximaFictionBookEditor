# Your own scripts / Ваши скрипты / Ваші скрипти

## English

Each script is a **folder** holding:

- `script.json` - its description (required), at least
  `{"manifestVersion": 1, "name": {"en": "My script", "ru": "Мой скрипт"}, "kind": "menu"}`;
- `index.js` - the script itself, written for this editor's script interface (`mfbe.doc`,
  `mfbe.selection`, `mfbe.ui`...);
- `icon.png` - optional, a 16 px icon for the Scripts toolbar.

A script folder may sit directly here, or inside a group folder, which becomes a sub-menu of the
Scripts menu; `NN_` at the start of a folder name (`01_My group`) orders the groups and scripts
and is not shown. The Scripts menu reads this folder each time it opens: a script you add is there
the next time you open the menu. A script with the id of a bundled one replaces it in its place.

A bare `.js` file, or a folder without `script.json`, is not used: *Settings > Other* lists it with
the reason. Scripts of FictionBook Editor 2.7 do not run as they are - they were written for the
old editor's interface and must be converted. The scripting guide describes the format and the
interface: `docs/scripting/en.md` in the editor's source,
https://github.com/QuarkZimmerman/MaximaFictionBookEditor/blob/master/docs/scripting/en.md

## Русский

Каждый скрипт - это **папка**, в которой лежат:

- `script.json` - его описание (обязательно), как минимум
  `{"manifestVersion": 1, "name": {"en": "My script", "ru": "Мой скрипт"}, "kind": "menu"}`;
- `index.js` - сам скрипт, написанный для интерфейса скриптов этого редактора (`mfbe.doc`,
  `mfbe.selection`, `mfbe.ui`...);
- `icon.png` - необязательно, значок 16 пикселей для панели «Скрипты».

Папка скрипта может лежать прямо здесь или внутри папки группы, которая становится подменю меню
«Скрипты»; `NN_` в начале имени папки (`01_Моя группа`) задаёт порядок групп и скриптов и не
показывается. Меню «Скрипты» перечитывает эту папку при каждом открытии: добавленный скрипт
появится, когда вы откроете меню в следующий раз. Скрипт с id встроенного заменяет его на его
месте.

Отдельный файл `.js` или папка без `script.json` не используются: «Настройки > Другое» перечисляет
их с причиной. Скрипты FictionBook Editor 2.7 не работают как есть - они написаны для интерфейса
старого редактора, их нужно переделать. Руководство по скриптам описывает формат и интерфейс:
`docs/scripting/ru.md` в исходниках редактора,
https://github.com/QuarkZimmerman/MaximaFictionBookEditor/blob/master/docs/scripting/ru.md

## Українська

Кожен скрипт - це **тека**, у якій лежать:

- `script.json` - його опис (обов'язково), щонайменше
  `{"manifestVersion": 1, "name": {"en": "My script", "uk": "Мій скрипт"}, "kind": "menu"}`;
- `index.js` - сам скрипт, написаний для інтерфейсу скриптів цього редактора (`mfbe.doc`,
  `mfbe.selection`, `mfbe.ui`...);
- `icon.png` - необов'язково, значок 16 пікселів для панелі «Скрипти».

Тека скрипту може лежати просто тут або всередині теки групи, яка стає підменю меню «Скрипти»;
`NN_` на початку імені теки (`01_Моя група`) задає порядок груп і скриптів і не показується. Меню
«Скрипти» перечитує цю теку щоразу, коли відкривається: доданий скрипт з'явиться, коли ви
відкриєте меню наступного разу. Скрипт з id вбудованого замінює його на його місці.

Окремий файл `.js` або тека без `script.json` не використовуються: «Налаштування > Інше» перелічує
їх із причиною. Скрипти FictionBook Editor 2.7 не працюють як є - вони написані для інтерфейсу
старого редактора, їх треба переробити. Посібник зі скриптів описує формат та інтерфейс:
`docs/scripting/en.md` у джерельному коді редактора,
https://github.com/QuarkZimmerman/MaximaFictionBookEditor/blob/master/docs/scripting/en.md
