# Your own genres / Ваши жанры / Ваші жанри

## English

Put genre files here: plain text files in UTF-8 whose names end in `.genres.tsv`, such as
`my.genres.tsv`. One genre per line, the fields separated by tabs:

    code<TAB>category<TAB>English name<TAB>Russian name<TAB>Ukrainian name (optional)

- **code**: the genre's code as books carry it - any text without tabs; spaces at its ends are
  dropped. A code the editor already knows is not changed: your files only add genres.
- **category**: the key of the group the genre is listed under in *Choose a genre*, such as `sf`,
  `det` or `prose`.
- **names**: each interface language shows its own name; without a Ukrainian name the Ukrainian
  interface shows the standard Ukrainian name of the code, else the English one. An empty English
  or Russian name is written as the code.
- Empty lines and lines starting with `#` are skipped.

Example (the fields separated by tabs):

    my_genre	sf	My genre	Мой жанр	Мій жанр

Genres you add in the editor - the "+" beside an unknown genre on the Description page, or *Add a
genre of your own...* in *Choose a genre* - are written into `my.genres.tsv` here. Files here that
the editor does not use are listed with the reason in *Settings > Other*.

## Русский

Сюда кладутся файлы жанров: текстовые файлы в UTF-8, имя которых оканчивается на `.genres.tsv`,
например `my.genres.tsv`. Один жанр в строке, поля разделены табуляцией:

    код<TAB>категория<TAB>английское название<TAB>русское название<TAB>украинское название (необязательно)

- **код**: код жанра, как его пишут книги, - любой текст без табуляций; пробелы по краям
  отбрасываются. Код, который редактор уже знает, не меняется: ваши файлы только добавляют жанры.
- **категория**: ключ группы, в которой жанр показан в «Выбор жанра», например `sf`, `det` или
  `prose`.
- **названия**: каждый язык интерфейса показывает своё название; без украинского названия
  украинский интерфейс показывает стандартное украинское название кода или английское. Пустое
  английское или русское название записывается как код.
- Пустые строки и строки, начинающиеся с `#`, пропускаются.

Пример (поля разделены табуляцией):

    my_genre	sf	My genre	Мой жанр	Мій жанр

Жанры, добавленные в редакторе, - «+» рядом с неизвестным жанром на странице описания или
«Добавить свой жанр...» в «Выбор жанра», - записываются сюда, в `my.genres.tsv`. Файлы, которые
редактор не использует, перечислены с причиной в «Настройки > Другое».

## Українська

Сюди кладуться файли жанрів: текстові файли в UTF-8, ім'я яких закінчується на `.genres.tsv`,
наприклад `my.genres.tsv`. Один жанр у рядку, поля розділені табуляцією:

    код<TAB>категорія<TAB>англійська назва<TAB>російська назва<TAB>українська назва (необов'язково)

- **код**: код жанру, як його пишуть книги, - будь-який текст без табуляцій; пробіли з країв
  відкидаються. Код, який редактор уже знає, не змінюється: ваші файли лише додають жанри.
- **категорія**: ключ групи, у якій жанр показано у «Вибір жанру», наприклад `sf`, `det` або
  `prose`.
- **назви**: кожна мова інтерфейсу показує свою назву; без української назви український
  інтерфейс показує стандартну українську назву коду або англійську. Порожня англійська чи
  російська назва записується як код.
- Порожні рядки й рядки, що починаються з `#`, пропускаються.

Приклад (поля розділені табуляцією):

    my_genre	sf	My genre	Мой жанр	Мій жанр

Жанри, додані в редакторі, - «+» поряд із невідомим жанром на сторінці опису або «Додати власний
жанр...» у «Вибір жанру», - записуються сюди, в `my.genres.tsv`. Файли, які редактор не
використовує, перелічено з причиною в «Налаштування > Інше».
