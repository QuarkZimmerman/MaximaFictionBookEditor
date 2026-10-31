// Test package of the suite (not bundled): runs the template 22/change-description-source-template with the data below,
// filled in as a user fills in the template's sections (the same names and the same k scheme).
export default async function run(ctx) {
  const a = {};
  for (const name of ["titleInfoGenre", "titleInfoAuthorFirstName", "titleInfoAuthorMiddleName", "titleInfoAuthorLastName", "titleInfoAuthorNickname", "titleInfoAuthorEmail", "titleInfoAuthorHomePage", "titleInfoAuthorID", "titleInfoTranslatorFirstName", "titleInfoTranslatorMiddleName", "titleInfoTranslatorLastName", "titleInfoTranslatorNickname", "titleInfoTranslatorEmail", "titleInfoTranslatorHomePage", "titleInfoAnnotation", "srcTitleInfoGenre", "srcTitleInfoAuthorFirstName", "srcTitleInfoAuthorMiddleName", "srcTitleInfoAuthorLastName", "srcTitleInfoAuthorNickname", "srcTitleInfoAuthorEmail", "srcTitleInfoAuthorHomePage", "srcTitleInfoAuthorID", "srcTitleInfoTranslatorFirstName", "srcTitleInfoTranslatorMiddleName", "srcTitleInfoTranslatorLastName", "srcTitleInfoTranslatorNickname", "srcTitleInfoTranslatorEmail", "srcTitleInfoTranslatorHomePage", "documentInfoAuthorFirstName", "documentInfoAuthorMiddleName", "documentInfoAuthorLastName", "documentInfoAuthorNickname", "documentInfoAuthorEmail", "documentInfoAuthorHomePage", "customInfoType", "customInfo"]) a[name] = [];
  let k = 0;
  a.titleInfoGenre[k++] = "";
  a.titleInfoAuthorFirstName[k] = ""; k++;
  a.titleInfoTranslatorFirstName[k] = ""; k++;
  a.titleInfoAnnotation[k++] = "Только <sup>новая</sup> строка";
  a.srcTitleInfoGenre[k++] = "";
  a.srcTitleInfoAuthorFirstName[k] = ""; k++;
  a.srcTitleInfoTranslatorFirstName[k] = ""; k++;
  a.documentInfoAuthorFirstName[k] = ""; k++;
  a.customInfoType[k] = ""; a.customInfo[k] = ""; k++;
  return mfbe.scripts.run("22/change-description-source-template", { ...a, ...({"ShablonName": "«Тест: очистка»", "ClearAnnotation": 0, "ClearHistory": 0, "ChangeID": 0, "Version_on_off": 1, "today": "2026-10-31"}) });
}
