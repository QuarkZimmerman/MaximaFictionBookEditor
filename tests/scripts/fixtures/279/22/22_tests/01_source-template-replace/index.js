// Test package of the suite (not bundled): runs the template 22/change-description-source-template with the data below,
// filled in as a user fills in the template's sections (the same names and the same k scheme).
export default async function run(ctx) {
  const a = {};
  for (const name of ["titleInfoGenre", "titleInfoAuthorFirstName", "titleInfoAuthorMiddleName", "titleInfoAuthorLastName", "titleInfoAuthorNickname", "titleInfoAuthorEmail", "titleInfoAuthorHomePage", "titleInfoAuthorID", "titleInfoTranslatorFirstName", "titleInfoTranslatorMiddleName", "titleInfoTranslatorLastName", "titleInfoTranslatorNickname", "titleInfoTranslatorEmail", "titleInfoTranslatorHomePage", "titleInfoAnnotation", "srcTitleInfoGenre", "srcTitleInfoAuthorFirstName", "srcTitleInfoAuthorMiddleName", "srcTitleInfoAuthorLastName", "srcTitleInfoAuthorNickname", "srcTitleInfoAuthorEmail", "srcTitleInfoAuthorHomePage", "srcTitleInfoAuthorID", "srcTitleInfoTranslatorFirstName", "srcTitleInfoTranslatorMiddleName", "srcTitleInfoTranslatorLastName", "srcTitleInfoTranslatorNickname", "srcTitleInfoTranslatorEmail", "srcTitleInfoTranslatorHomePage", "documentInfoAuthorFirstName", "documentInfoAuthorMiddleName", "documentInfoAuthorLastName", "documentInfoAuthorNickname", "documentInfoAuthorEmail", "documentInfoAuthorHomePage", "customInfoType", "customInfo"]) a[name] = [];
  let k = 0;
  a.titleInfoGenre[k++] = "sf_fantasy";
  a.titleInfoGenre[k++] = "adventure";
  a.titleInfoAuthorFirstName[k] = "Мария"; a.titleInfoAuthorLastName[k] = "Иванова"; a.titleInfoAuthorID[k] = ""; k++;
  a.titleInfoAuthorNickname[k] = "Гость"; a.titleInfoAuthorEmail[k] = "guest@example.com"; a.titleInfoAuthorID[k] = "AUTHOR-NEW"; k++;
  a.titleInfoAuthorFirstName[k] = "Третий"; a.titleInfoAuthorLastName[k] = "Автор"; k++;
  a.titleInfoTranslatorFirstName[k] = "Отто"; a.titleInfoTranslatorLastName[k] = "Шмидт"; k++;
  a.titleInfoAnnotation[k++] = "";
  a.titleInfoAnnotation[k++] = "Новая <strong>жирная</strong> строка & <emphasis>курсив</emphasis>";
  a.titleInfoAnnotation[k++] = "  ";
  a.srcTitleInfoGenre[k++] = "";
  a.srcTitleInfoAuthorFirstName[k] = "John"; a.srcTitleInfoAuthorLastName[k] = "Smith"; k++;
  a.srcTitleInfoTranslatorFirstName[k] = ""; k++;
  a.documentInfoAuthorFirstName[k] = "Новый"; a.documentInfoAuthorLastName[k] = "Верстальщик"; k++;
  a.customInfoType[k] = "template"; a.customInfo[k] = "Строка 1\nСтрока 2\n"; k++;
  return mfbe.scripts.run("22/change-description-source-template", { ...a, ...({"ShablonName": "«Тест: замена»", "ChangeAuthor": 0, "titleInfoBookTitle": "Новое название", "titleInfoDate": "2026", "titleInfoDateValue": "2026-01-01", "titleInfoSrcLang": "de", "titleInfoSequenceName": "Новая серия", "titleInfoSequenceNumber": "3", "srcTitleInfoBookTitle": "Original Title", "srcTitleInfoLang": "en", "documentInfoDate": "сегодня", "documentInfoDateValue": "сегодня", "documentInfoSrcUrl": "http://new.example", "documentInfoHistory": "v.1.4 — Правка по шаблону <тест> — Зорро", "publishInfoPublisher": "Новое издательство", "publishInfoYear": "2026", "publishInfoSequenceName": "Серия издательства", "publishInfoSequenceNumber": "", "today": "2026-10-31"}) });
}
