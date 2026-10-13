// Document statistics and binary metadata (the "Статистика" scripts).
// Capabilities: doc.stats, doc.binaries, env.docLanguage, env.settings, edit.symbols.
export default async function run() {
  const stats = await mfbe.doc.stats();
  const binaries = await mfbe.doc.binaries();
  const language = await mfbe.doc.stats().then(() => mfbe.env.docLanguage());
  const settings = await mfbe.env.settings();
  const symbols = await mfbe.edit.symbols();
  const biggest = binaries.slice().sort((a, b) => b.size - a.size)[0];
  const lines = [
    `Language: ${language}`,
    `Characters: ${stats.characters}`,
    `Words: ${stats.words}`,
    `Paragraphs: ${stats.paragraphs}, sections: ${stats.sections}, notes: ${stats.notes}`,
    `Images: ${stats.images}, binary bytes: ${stats.binaryBytes}`,
    biggest ? `Largest binary: ${biggest.id} (${biggest.size} bytes, ${biggest.contentType})` : 'No binaries',
    `Paste format: ${settings.pasteImageFormat} (${settings.jpegQuality}), UI: ${settings.uiLanguage}`,
    `${symbols.length} symbols in the symbol table, nbsp shown as "${settings.nbspDisplayChar}"`,
  ];
  await mfbe.ui.message(lines.join('\n'), { caption: 'Statistics', icon: 'info' });
}
