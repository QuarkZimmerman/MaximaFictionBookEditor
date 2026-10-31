// Test package of the suite (not bundled): runs the template 22/change-description-source-template with the data below,
// filled in as a user fills in the template's sections (the same names and the same k scheme).
export default async function run(ctx) {
  const a = {};
  for (const name of ["titleInfoGenre", "titleInfoAuthorFirstName", "titleInfoAuthorMiddleName", "titleInfoAuthorLastName", "titleInfoAuthorNickname", "titleInfoAuthorEmail", "titleInfoAuthorHomePage", "titleInfoAuthorID", "titleInfoTranslatorFirstName", "titleInfoTranslatorMiddleName", "titleInfoTranslatorLastName", "titleInfoTranslatorNickname", "titleInfoTranslatorEmail", "titleInfoTranslatorHomePage", "titleInfoAnnotation", "srcTitleInfoGenre", "srcTitleInfoAuthorFirstName", "srcTitleInfoAuthorMiddleName", "srcTitleInfoAuthorLastName", "srcTitleInfoAuthorNickname", "srcTitleInfoAuthorEmail", "srcTitleInfoAuthorHomePage", "srcTitleInfoAuthorID", "srcTitleInfoTranslatorFirstName", "srcTitleInfoTranslatorMiddleName", "srcTitleInfoTranslatorLastName", "srcTitleInfoTranslatorNickname", "srcTitleInfoTranslatorEmail", "srcTitleInfoTranslatorHomePage", "documentInfoAuthorFirstName", "documentInfoAuthorMiddleName", "documentInfoAuthorLastName", "documentInfoAuthorNickname", "documentInfoAuthorEmail", "documentInfoAuthorHomePage", "customInfoType", "customInfo"]) a[name] = [];
  let k = 0;
  a.titleInfoGenre[k++] = "";
  a.titleInfoAuthorFirstName[k] = ""; k++;
  a.titleInfoTranslatorFirstName[k] = ""; k++;
  a.titleInfoAnnotation[k++] = "";
  a.srcTitleInfoGenre[k++] = "";
  a.srcTitleInfoAuthorFirstName[k] = ""; k++;
  a.srcTitleInfoTranslatorFirstName[k] = ""; k++;
  a.documentInfoAuthorNickname[k] = "Зорро"; k++;
  a.documentInfoAuthorFirstName[k] = "Новый"; a.documentInfoAuthorLastName[k] = "Верстальщик"; k++;
  a.customInfoType[k] = ""; a.customInfo[k] = "\n\n\n"; k++;
  return mfbe.scripts.run("22/change-description-source-template", { ...a, ...({"ShablonName": "«Тест: добавление и история»", "ChangeAuthor": 1, "Version_on_off": 1, "titleInfoKeywords": "шаблон, дескрипшен", "titleInfoLang": "ru", "today": "2026-10-31"}) });
}
