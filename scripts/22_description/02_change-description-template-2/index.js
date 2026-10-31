// Converted from FictionBook Editor 2.7.9: Scripts/22_Дескрипшен/02_Изменить дескрипшен - шаблон 2.js
// Template 2: one of the five copies of the template «Изменить дескрипшен» that 2.7.9 ships empty,
// for five templates of one's own; they are its version 1.2, while the source template is 1.4. It
// writes the data filled in below into the book's description: genres, authors, title, keywords,
// dates, languages, translators, sequence and annotation of <title-info> and <src-title-info>,
// version, id, authors, programs, dates, source OCR and URL and history of <document-info>, the
// fields of <publish-info> and <custom-info>; optionally it raises the file's version and writes a
// history line. As shipped, all data are empty and it changes nothing. Its window lists what it
// changed. Version 1.2 takes the annotation and history texts as HTML, clears an author's id that
// the data leave empty and lists every field it wrote, changed or not.
// How to use it: a bundled script cannot be edited. Copy this folder into your scripts folder
// (Scripts > Open scripts folder), give the copy a new "id" (and a new name) in its script.json,
// fill in the two sections "НАСТРОЙКИ" (settings) and "ДОБАВЛЯЕМЫЕ ДАННЫЕ" (data to add) below
// and choose Scripts > Reload scripts. The sections keep the original's names and form, so a
// section filled in for FictionBook Editor can be pasted here unchanged.
// Differences from 2.7.9: the work is done on the document's description (lib/change-description.js);
// the name of main.js's "fbeUserName" is not read (there is no main.js); a language code outside
// FictionBook Editor's list is written as given; a sequence number that is not an integer is left
// out (FB2 numbers are integers); the window's hint says how to fill in a copy. Another script may
// run this one with settings and data of its own (the names below) and "today" (YYYY-MM-DD) in the
// args of mfbe.scripts.run. Fixed: texts are looked for in the history and the annotation as
// written and as the page shows them, not as regular expressions over the template's HTML.
// The original's notice, kept as written (FR-029):
//------------------------------------------------------------------------------------------
//             «Изменить дескрипшен»
//  Скрипт предназначен для пользовательской замены данных в разделе <description>
//  * Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
// v.1.0 — Создание скрипта — Александр Ка (17.05.2025)
// v.1.1 — Добавление обработки аннотации  — Александр Ка (20.05.2025)
// v.1.2 — Исправлены две мелкие ошибки  — Александр Ка (21.05.2025)
//------------------------------------------------------------------------------------------

import { applyTemplate } from './lib/change-description.js';

export default async function run(ctx) {

 var ScriptName="«Изменить дескрипшен»";
 var NumerusVersion="1.2";
 var titleInfoGenre=[], titleInfoAuthorFirstName=[], titleInfoAuthorMiddleName=[], titleInfoAuthorLastName=[], titleInfoAuthorNickname=[], titleInfoAuthorEmail=[], titleInfoAuthorHomePage=[], titleInfoAuthorID=[], titleInfoTranslatorFirstName=[], titleInfoTranslatorMiddleName=[], titleInfoTranslatorLastName=[], titleInfoTranslatorNickname=[], titleInfoTranslatorEmail=[], titleInfoTranslatorHomePage=[], titleInfoAnnotation=[], srcTitleInfoGenre=[], srcTitleInfoAuthorFirstName=[], srcTitleInfoAuthorMiddleName=[], srcTitleInfoAuthorLastName=[], srcTitleInfoAuthorNickname=[], srcTitleInfoAuthorEmail=[], srcTitleInfoAuthorHomePage=[], srcTitleInfoAuthorID=[], srcTitleInfoTranslatorFirstName=[], srcTitleInfoTranslatorMiddleName=[], srcTitleInfoTranslatorLastName=[], srcTitleInfoTranslatorNickname=[], srcTitleInfoTranslatorEmail=[], srcTitleInfoTranslatorHomePage=[], documentInfoAuthorFirstName=[], documentInfoAuthorMiddleName=[], documentInfoAuthorLastName=[], documentInfoAuthorNickname=[], documentInfoAuthorEmail=[], documentInfoAuthorHomePage=[], customInfoType=[], customInfo=[];
 var titleInfoBookTitle, titleInfoKeywords, titleInfoDate, titleInfoDateValue, titleInfoLang, titleInfoSrcLang, titleInfoSequenceName, titleInfoSequenceNumber, srcTitleInfoBookTitle, srcTitleInfoKeywords, srcTitleInfoDate, srcTitleInfoDateValue, srcTitleInfoLang, srcTitleInfoSrcLang, srcTitleInfoSequenceName, srcTitleInfoSequenceNumber, documentInfoVersion, documentInfoProgramUsed, documentInfoDate, documentInfoDateValue, documentInfoSrcOcr, documentInfoSrcUrl, documentInfoHistory, publishInfoBookName, publishInfoPublisher, publishInfoCity, publishInfoYear, publishInfoISBN, publishInfoSequenceName, publishInfoSequenceNumber;
 var k=0;

// ---------------------------------------------------------------
                 ///  НАСТРОЙКИ
                 ///  SETTINGS
// ---------------------------------------------------------------

 //   Название шаблона
 //   The template's name (shown in the window of results)
 var ShablonName="«Без изменений»";      // текст //


         //  Добавление данных
         //  Adding data

 //   Сохранение авторов fb2-файла
 //   The authors of the fb2 file (<document-info>)
 var ChangeAuthor = 1;      // 0 ; 1 //      ("0" — разрешить замену авторов, "1" — добавлять новые имена авторов к уже существующим)
 //                                          ("0" — replace the authors, "1" — add the new names to the existing ones)

 //   Сохранение  ID  fb2-файла
 //   The ID of the fb2 file
 var ChangeID = 1;      // 0 ; 1 //      ("0" — заменить на новый ID,  "1" — сохранить оригинальный ID)
 //                                      ("0" — replace it by a new ID, "1" — keep the original ID)

//    Сохранение истории изменений файла
//    The history of the file
 var ClearHistory = 1;      // 0 ; 1 //      ("0" — удалить, "1" — сохранить историю)
 //                                          ("0" — delete it, "1" — keep the history)

//    Сохранение аннотации
//    The annotation
 var ClearAnnotation = 1;      // 0 ; 1 //      ("0" — удалить, "1" — сохранить аннотацию)
 //                                             ("0" — delete it, "1" — keep the annotation)


         //  Автоматическое повышение версии файла и запись в историю изменений
         //  Raising the file's version and writing a line into its history

 var Version_on_off = 0;      // 0 ; 1 //      ("0" — отключить, "1" — включить)     //  включение этой функции не отменяет обычное "добавление данных"
 //                                            ("0" — off, "1" — on)     //  it does not stop the usual "adding data"

//   Основной текст, добавляемый в строку истории
//   The text of the history line
 var TextHistory = "Общая правка";      // текст //

//   Имя используемое в добавленной записи
//   The name written in the history line
 var youName = "Зорро";      // текст //

// ---------------------------------------------------------------
                 ///  ДОБАВЛЯЕМЫЕ ДАННЫЕ
                 ///  DATA TO ADD
// ---------------------------------------------------------------

//  Здесь можно указать какие данные в разделе <description> следует изменить.
//  Все заполненные значения добавляемых данных полностью заменяют исходные данные в fb2-файле.
//  * Исключаются только поля с авторами файла, строки аннотации и истории изменений файла. Но и это исключение можно отменить, изменив "настройки".
//  Вносить изменения в скрипт лучше при включенной программе FBE (чтобы не было проблем в случае ошибочного заполнения).
//  Here you say which data of the <description> section to change. Every value filled in
//  replaces the book's value; only the authors of the file and the lines of the annotation and
//  of the history are added to (the settings above change that too).

//  Пустые кавычки означают, что данные останутся не измененными.
//  Если кавычки не пустые, то текст из этих кавычек будет отправлен в соответствующий раздел <description>.
//  Если внутрь кавычек необходимо вписать другую кавычку, то её следует экранировать обратным слэшем: «\"».
//  Сам обратный слэш, экранируется точно так же: «\\».
//  Разрыв строки, который может быть в <custom-info> записывается символами «\n».
//  Чтобы не мешались, можно свободно удалять любые незаполненные разделы, и строки комментариев (они начинаются символами «//»).
//  Empty quotes leave a value unchanged; a text in the quotes goes into its field. Write a quote
//  inside the quotes as \" and a backslash as \\; a line break of <custom-info> is \n. Unfilled
//  sections and comment lines may be deleted.


         ///   Книга  ::  <title-info>

 //  Жанры  ::  для добавления нескольких жанров, эту строку можно размножить
 //  Genres  ::  repeat this line for more genres
 titleInfoGenre[k++] =  "";

 //  Авторы  ::  для добавления нескольких авторов, этот блок строк можно размножить
 //  Authors  ::  repeat this block for more authors
 titleInfoAuthorFirstName[k] =  "";
 titleInfoAuthorMiddleName[k] =  "";
 titleInfoAuthorLastName[k] =  "";
 titleInfoAuthorNickname[k] =  "";
 titleInfoAuthorEmail[k] =  "";
 titleInfoAuthorHomePage[k] =  "";
 titleInfoAuthorID[k] =  "";
 k++;

 //  Название
 //  Title
 titleInfoBookTitle =  "";

 //  Ключевые слова
 //  Keywords
 titleInfoKeywords =  "";

 //  Дата текстом ; Значение даты
 //  Date as text ; date value
 titleInfoDate =  "";
 titleInfoDateValue =  "";

 //  Язык ; Язык оригинала
 //  Language ; source language
 titleInfoLang =  "";
 titleInfoSrcLang =  "";

 //  Переводчики  ::  для добавления нескольких переводчиков, этот блок строк можно размножить
 //  Translators  ::  repeat this block for more translators
 titleInfoTranslatorFirstName[k] =  "";
 titleInfoTranslatorMiddleName[k] =  "";
 titleInfoTranslatorLastName[k] =  "";
 titleInfoTranslatorNickname[k] =  "";
 titleInfoTranslatorEmail[k] =  "";
 titleInfoTranslatorHomePage[k] =  "";
 k++;

 //  Серия
 //  Sequence
 titleInfoSequenceName =  "";
 titleInfoSequenceNumber =  "";

 //  Аннотация  ::  для добавления нескольких строк, строку ниже можно размножить  ::  допускается использование тегов  "<strong>", "<emphasis>", "<sup>", "<sub>"
 //  Annotation  ::  repeat the line below for more lines  ::  the tags "<strong>", "<emphasis>", "<sup>", "<sub>" may be used
 titleInfoAnnotation[k++] =  "";



         ///   Информация об оригинале книги  ::  <src-title-info>

 //  Жанры  ::  эту строку можно размножить
 //  Genres  ::  this line may be repeated
 srcTitleInfoGenre[k++] =  "";

 //  Авторы  ::  для добавления нескольких авторов, этот блок строк можно размножить
 //  Authors  ::  repeat this block for more authors
 srcTitleInfoAuthorFirstName[k] =  "";
 srcTitleInfoAuthorMiddleName[k] =  "";
 srcTitleInfoAuthorLastName[k] =  "";
 srcTitleInfoAuthorNickname[k] =  "";
 srcTitleInfoAuthorEmail[k] =  "";
 srcTitleInfoAuthorHomePage[k] =  "";
 srcTitleInfoAuthorID[k] =  "";
 k++;

 //  Название
 //  Title
 srcTitleInfoBookTitle =  "";

 //  Ключевые слова
 //  Keywords
 srcTitleInfoKeywords =  "";

 //  Дата текстом ; Значение даты
 //  Date as text ; date value
 srcTitleInfoDate =  "";
 srcTitleInfoDateValue =  "";

 //  Язык ; Язык оригинала
 //  Language ; source language
 srcTitleInfoLang =  "";
 srcTitleInfoSrcLang =  "";

 //  Переводчики  ::  для добавления нескольких переводчиков, этот блок строк можно размножить
 //  Translators  ::  repeat this block for more translators
 srcTitleInfoTranslatorFirstName[k] =  "";
 srcTitleInfoTranslatorMiddleName[k] =  "";
 srcTitleInfoTranslatorLastName[k] =  "";
 srcTitleInfoTranslatorNickname[k] =  "";
 srcTitleInfoTranslatorEmail[k] =  "";
 srcTitleInfoTranslatorHomePage[k] =  "";
 k++;

 //  Серия
 //  Sequence
 srcTitleInfoSequenceName =  "";
 srcTitleInfoSequenceNumber =  "";



         ///   FB2 документ  ::  <document-info>

 //  Версия  ::  Добавление текста отключает "Автоматическое повышение версии файла"
 //  Version  ::  a text here turns the raising of the version off
 documentInfoVersion =  "";

 //  Авторы  ::  для добавления нескольких авторов, этот блок строк можно размножить  ::  в настройках можно выбрать режим "добавления" или "замены"
 //  Authors  ::  repeat this block for more authors  ::  the settings choose "adding" or "replacing"
 documentInfoAuthorFirstName[k] =  "";
 documentInfoAuthorMiddleName[k] =  "";
 documentInfoAuthorLastName[k] =  "";
 documentInfoAuthorNickname[k] =  "";
 documentInfoAuthorEmail[k] =  "";
 documentInfoAuthorHomePage[k] =  "";
 k++;

 //  Использованы программы
 //  Programs used
 documentInfoProgramUsed =  "";

 //  Дата текстом ; Значение даты  ::  Если дата равна "сегодня", то скрипт впишет сегодняшнее число
 //  Date as text ; date value  ::  "сегодня" (today) writes today's date
 documentInfoDate =  "";
 documentInfoDateValue =  "";

 //  Source OCR
 documentInfoSrcOcr =  "";

 //  Source URLs
 documentInfoSrcUrl =  "";

 //  История изменений файла  ::  Добавление текста отключает функцию "Автоматическое повышение версии файла и запись в историю изменений"
 //  History  ::  a text here turns the raising of the version and its history line off
 documentInfoHistory =  "";



         ///   Бумажная книга  ::  <publish-info>

 //  Заголовок книги
 //  Book name
 publishInfoBookName =  "";

 //  Издатель
 //  Publisher
 publishInfoPublisher =  "";

 //  Город
 //  City
 publishInfoCity =  "";

 //  Год
 //  Year
 publishInfoYear =  "";

 //  ISBN
 publishInfoISBN =  "";

 //  Серия
 //  Sequence
 publishInfoSequenceName =  "";
 publishInfoSequenceNumber =  "";



         ///   Дополнительная информация  ::  <custom-info>

 //  Тип / Значение  ::  для добавления нескольких текстов, этот блок строк можно размножить; а количество строк в "customInfo" - увеличить или уменьшить
 //  Type / value  ::  repeat this block for more texts; "customInfo" may have more or fewer lines
 customInfoType[k] =  "";
 customInfo[k]  =
         "" + "\n"+
         "" + "\n"+
         "" + "\n"+
         "";
 k++;

// ---------------------------------------------------------------
// ----------------------------------------------
// -----------------------------

 return applyTemplate(ctx, {
   ScriptName, NumerusVersion, ShablonName, ChangeAuthor, ChangeID, ClearHistory, ClearAnnotation, Version_on_off, TextHistory, youName,
   titleInfoGenre, titleInfoAuthorFirstName, titleInfoAuthorMiddleName, titleInfoAuthorLastName, titleInfoAuthorNickname, titleInfoAuthorEmail, titleInfoAuthorHomePage, titleInfoAuthorID,
   titleInfoBookTitle, titleInfoKeywords, titleInfoDate, titleInfoDateValue, titleInfoLang, titleInfoSrcLang,
   titleInfoTranslatorFirstName, titleInfoTranslatorMiddleName, titleInfoTranslatorLastName, titleInfoTranslatorNickname, titleInfoTranslatorEmail, titleInfoTranslatorHomePage,
   titleInfoSequenceName, titleInfoSequenceNumber, titleInfoAnnotation,
   srcTitleInfoGenre, srcTitleInfoAuthorFirstName, srcTitleInfoAuthorMiddleName, srcTitleInfoAuthorLastName, srcTitleInfoAuthorNickname, srcTitleInfoAuthorEmail, srcTitleInfoAuthorHomePage, srcTitleInfoAuthorID,
   srcTitleInfoBookTitle, srcTitleInfoKeywords, srcTitleInfoDate, srcTitleInfoDateValue, srcTitleInfoLang, srcTitleInfoSrcLang,
   srcTitleInfoTranslatorFirstName, srcTitleInfoTranslatorMiddleName, srcTitleInfoTranslatorLastName, srcTitleInfoTranslatorNickname, srcTitleInfoTranslatorEmail, srcTitleInfoTranslatorHomePage,
   srcTitleInfoSequenceName, srcTitleInfoSequenceNumber,
   documentInfoVersion, documentInfoAuthorFirstName, documentInfoAuthorMiddleName, documentInfoAuthorLastName, documentInfoAuthorNickname, documentInfoAuthorEmail, documentInfoAuthorHomePage,
   documentInfoProgramUsed, documentInfoDate, documentInfoDateValue, documentInfoSrcOcr, documentInfoSrcUrl, documentInfoHistory,
   publishInfoBookName, publishInfoPublisher, publishInfoCity, publishInfoYear, publishInfoISBN, publishInfoSequenceName, publishInfoSequenceNumber,
   customInfoType, customInfo,
 }, '1.2');

 }

