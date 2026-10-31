// Shared helpers of the "Регистр" (Case) scripts. Every script folder carries its own copy
// because the sandbox only allows imports from the script's own folder.
//
// The legacy scripts walked the IE DOM between two marker elements pasted at the selection
// boundaries and changed every text node in between, which kept the inline formatting intact.
// Here the same effect is obtained by rewriting the selected part of every text node of the
// selected blocks (marks are copied), one `doc.replaceNode` per changed block.

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Picks the Russian or English variant of a user-facing string. */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export const NO_SELECTION = {
  ru: 'Нет выделения.\n\nПеред запуском скрипта нужно выделить текст, который будет обработан.',
  en: 'Nothing is selected.\n\nSelect the text to process before running the script.',
};

/**
 * The current selection in document order, split per text block:
 * `{ blocks: [{ nodeId, text, from, to }], collapsed, start, end }` or null when the Body view
 * has no text selection. A collapsed caret is expanded to the word around it when `expandWord`
 * is set (the legacy `TextRange.expand("word")`).
 */
export async function selectedBlocks(expandWord = false) {
  const sel = await mfbe.selection.get();
  if (!sel || sel.nodes.length === 0) return null;
  const { anchor, head, nodes } = sel;
  let start = anchor;
  let end = head;
  if (anchor.nodeId === head.nodeId) {
    if (anchor.offset > head.offset) [start, end] = [head, anchor];
  } else if (nodes[0].nodeId !== anchor.nodeId) {
    [start, end] = [head, anchor];
  }
  const blocks = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const text = await mfbe.doc.textOf(nodes[i]);
    blocks.push({
      nodeId: nodes[i].nodeId,
      text,
      from: i === 0 ? Math.min(start.offset, text.length) : 0,
      to: i === nodes.length - 1 ? Math.min(end.offset, text.length) : text.length,
    });
  }
  const collapsed = blocks.length === 1 && blocks[0].from === blocks[0].to;
  if (collapsed && expandWord) {
    const b = blocks[0];
    while (b.from > 0 && WORD_CHAR.test(b.text[b.from - 1])) b.from -= 1;
    while (b.to < b.text.length && WORD_CHAR.test(b.text[b.to])) b.to += 1;
  }
  return { blocks, collapsed, start, end };
}

/** The selected text (all blocks joined, in document order). */
export function selectedText(selection) {
  return selection.blocks.map((b) => b.text.slice(b.from, b.to)).join('\n');
}

/**
 * Rewrites the selected part of every text node of the selected blocks. `fn(chunk, state)`
 * receives the selected text of one text node (its marks are kept) and returns the replacement;
 * `state` is shared by all chunks and `onBlock(state)` is called when a new block starts (the
 * legacy scripts reset their per-paragraph flags there).
 */
export async function transformSelection(selection, fn, state = {}, onBlock = null) {
  for (const block of selection.blocks) {
    if (block.from >= block.to) continue;
    if (onBlock) onBlock(state);
    const node = await mfbe.doc.getNode(block.nodeId);
    const content = [];
    let pos = 0;
    let changed = false;
    for (const child of node.content ?? []) {
      if (child.type !== 'text') {
        content.push(child);
        pos += 1; // inline images and unknown inline elements count as one character
        continue;
      }
      const len = child.text.length;
      const a = Math.max(block.from, pos);
      const z = Math.min(block.to, pos + len);
      pos += len;
      if (a >= z) {
        content.push(child);
        continue;
      }
      const middle = child.text.slice(a - (pos - len), z - (pos - len));
      const replaced = fn(middle, state);
      if (replaced !== middle) changed = true;
      const before = child.text.slice(0, a - (pos - len));
      const after = child.text.slice(z - (pos - len));
      if (before) content.push({ ...child, text: before });
      if (replaced) content.push({ ...child, text: replaced });
      if (after) content.push({ ...child, text: after });
    }
    if (changed) await mfbe.doc.replaceNode(block.nodeId, { ...node, content });
  }
  // The legacy scripts re-selected the processed text (or put the caret back).
  await mfbe.selection.set(selection.start, selection.end);
}

/**
 * Letters recognised by the capitalisation scripts (copied verbatim from the originals: Latin
 * with diacritics, Greek, Cyrillic incl. extended letters, Latin Extended Additional, Greek
 * Extended).
 */
export const LETTERS =
  'а-яёa-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ́ßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƏƒƠơƯưƷǤǥǦǧǨǩǪǫǮǯǺǻǼǽǾǿȘșȚțȨȩəʒ' +
  'ΆΈΉΊΌΎΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏ' +
  'ѐђѓєѕіїјљњћќѝўџҐґҒғҖҗҚқҜҝҢңҮүҰұҲҳҸҹҺһӘәӨө' +
  'ḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼ' +
  'ῂῃῄῆῇῈΈῊΉῌ' +
  'ῐῑῒΐῖῗῘῙῚΊῠῡῢΰῤῥῦῧῨῩῪΎῬῲῳῴῶῷῸΌῺΏῼµ';

/** Capitalises one word: first letter upper case, the rest lower case. */
export function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
