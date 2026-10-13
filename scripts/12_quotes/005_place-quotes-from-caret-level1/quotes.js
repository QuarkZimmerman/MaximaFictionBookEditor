// Shared engine of the "Расстановка елочек и лапок" scripts (group 12), converted from the
// FictionBook Editor originals. Straight quotes (") in the processed range are turned into
// «…» (level 0), „…“ (levels 1 and 2) by looking at up to four neighbouring characters;
// existing typographic quotes in the range are first normalised to straight ones. The
// nesting level is tracked across paragraphs: it must be 0 at the end of every section and
// unchanged at the end of every other block entered inside the range, otherwise the script
// stops with a message and puts the caret at the problem (like the original did).
//
// Differences from the original are listed in docs/scripting/conversion-notes-b.md (quotes
// inside footnote links are left alone; the whole run is one undo step).

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const NBSP = '\u00A0';
const LEFT_QUOTES = ['«', '„', '„', '‘'];
const RIGHT_QUOTES = ['»', '“', '“', '’'];

// Character classes of the original (kept verbatim, including the `w|` quirk of re4 whose
// `\w` had lost its backslash inside a string literal).
const RE1 = new RegExp(`\\s|[-–—(${NBSP}]`, 'i');
const RE2 = new RegExp(`\\w|[${"а-яёa-z?!)“,°ÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƏƒƠơƯưƷǤǥǦǧǨǩǪǫǮǯǺǻǼǽǾǿȘșȚțȨȩəʒΆΈΉΊΌΎΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѐђѓєѕіїјљњћќѝўџҐґҒғҖҗҚқҜҝҢңҮүҰұҲҳҸҹҺһӘәӨөḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼῂῃῄῆῇῈΈῊΉῌῐῑῒΐῖῗῘῙῚΊῠῡῢΰῤῥῦῧῨῩῪΎῬῲῳῴῶῷῸΌῺΏῼªº%‰©µ¶ℓ™℗⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉£¤¢¥€$¼½¾"}]`, 'i');
const RE3 = new RegExp(`[-?!,;–—)${NBSP}]|\\s`, 'i');
const RE4 = new RegExp(`w|[${"а-яёa-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƏƒƠơƯưƷǤǥǦǧǨǩǪǫǮǯǺǻǼǽǾǿȘșȚțȨȩəʒΆΈΉΊΌΎΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѐђѓєѕіїјљњћќѝўџҐґҒғҖҗҚқҜҝҢңҮүҰұҲҳҸҹҺһӘәӨөḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼῂῃῄῆῇῈΈῊΉῌῐῑῒΐῖῗῘῙῚΊῠῡῢΰῤῥῦῧῨῩῪΎῬῲῳῴῶῷῸΌῺΏῼªº©µ¶ℓ⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉£¤¢¥€$¼½¾"}]`, 'i');
const RE5 = /[-–—]/i;

function analyseSymbolOnTheLeft(ch) {
  if (ch === undefined) return 'left quotes';
  if (ch.search(RE1) === 0) return 'left quotes';
  if (ch.search(RE2) === 0) return 'right quotes';
  return undefined;
}

function analyseSymbolOnTheRight(ch) {
  if (ch === undefined) return 'right quotes';
  if (ch.search(RE3) === 0) return 'right quotes';
  if (ch.search(RE4) === 0) return 'left quotes';
  return undefined;
}

/** `n[-4..-1]` and `n[1..4]` are the neighbours; returns { left, right } booleans. */
function decideIsItLeftOrRightQuotes(n) {
  let left = false;
  let right = false;
  let anLeft;
  if (n[-1] === '.' && n[-2] === '.' && n[-3] !== '.') anLeft = analyseSymbolOnTheLeft(n[-3]);
  else if (n[-1] === '.' && n[-2] === '.' && n[-3] === '.') anLeft = analyseSymbolOnTheLeft(n[-4]);
  else if (n[-1] === '…') anLeft = analyseSymbolOnTheLeft(n[-2]);
  else anLeft = analyseSymbolOnTheLeft(n[-1]);
  if (anLeft === 'left quotes') left = true;
  else if (anLeft === 'right quotes') right = true;
  let anRight;
  if (n[1] === '.' && n[2] === '.' && n[3] === '.') anRight = analyseSymbolOnTheRight(n[4]);
  else if (n[1] === '…') anRight = analyseSymbolOnTheRight(n[2]);
  else anRight = analyseSymbolOnTheRight(n[1]);
  if (anRight === 'left quotes') left = true;
  else if (anRight === 'right quotes') right = true;
  if (n[-1] === '.' && n[1] === '.') right = true;
  if (n[-1] === '…' && n[1] === '…') right = true;
  if (n[1] === '.' && n[2] !== '.') right = true;
  if (n[-1] === '.' && n[-2] !== '.') right = true;
  if (right && left && ((n[1] === '.' && n[2] === '.' && n[3] === '.') || n[1] === '…')) return { left, right: false };
  if (right && left && ((n[-1] === '.' && n[-2] === '.' && n[-3] === '.') || n[-1] === '…')) return { left: false, right };
  if (right && left && n[1] !== undefined && n[1].search(RE5) >= 0) return { left, right: false };
  return { left, right };
}

/* ------------------------------------------------------------------------ */

function isNoteRun(run) {
  return run.type === 'text' && (run.marks ?? []).some((m) => m.type === 'link' && m.attrs?.type === 'note');
}

/** Characters of a block visible to the neighbour analysis: { ch, run, index, pos }. */
function visibleChars(content) {
  const out = [];
  let pos = 0;
  content.forEach((run, index) => {
    if (run.type !== 'text') {
      pos += 1; // inline image: one U+FFFC in the plain text
      return;
    }
    const text = run.text ?? '';
    if (!isNoteRun(run)) {
      for (let k = 0; k < text.length; k += 1) out.push({ ch: text[k], run: index, offset: k, pos: pos + k });
    }
    pos += text.length;
  });
  return out;
}

class QuoteError extends Error {
  constructor(message, caret) {
    super(message);
    this.caret = caret;
  }
}

export async function placeQuotes(ctx, options) {
  const ru = ctx.uiLanguage === 'ru';
  const onlyGuillemets = !!options.onlyGuillemets;
  const titleRu = onlyGuillemets ? 'Скрипт «Расстановка только елочек»\n\n' : 'Скрипт «Расстановка елочек и лапок»\n\n';
  const titleEn = onlyGuillemets ? 'Script "Guillemets only"\n\n' : 'Script "Guillemets and low quotes"\n\n';
  const versionStr = ru ? titleRu : titleEn;
  const leftCnt = [0, 0, 0, 0];
  const rightCnt = [0, 0, 0, 0];
  let notReplaced = 0;

  const infoStr = () => {
    if (onlyGuillemets) {
      return ru
        ? `Расставлено елочек:\n\n   левых – « – ${leftCnt[0]}\n   правых – » – ${rightCnt[0]}\n  ———————————\n   Всего: ${leftCnt[0] + rightCnt[0]}`
        : `Guillemets placed:\n\n   left – « – ${leftCnt[0]}\n   right – » – ${rightCnt[0]}\n  ———————————\n   Total: ${leftCnt[0] + rightCnt[0]}`;
    }
    const total = leftCnt.reduce((a, b) => a + b, 0) + rightCnt.reduce((a, b) => a + b, 0);
    const lvl = ru ? 'го уровня' : 'level';
    const lines = [];
    for (let i = 0; i < 3; i += 1) {
      lines.push(ru ? `${i}-${lvl} – ${LEFT_QUOTES[i]} – ${leftCnt[i]}` : `${lvl} ${i} – ${LEFT_QUOTES[i]} – ${leftCnt[i]}`);
      lines.push(ru ? `${i}-${lvl} – ${RIGHT_QUOTES[i]} – ${rightCnt[i]}` : `${lvl} ${i} – ${RIGHT_QUOTES[i]} – ${rightCnt[i]}`);
    }
    return `${ru ? 'Расставлено кавычек:' : 'Quotes placed:'}\n\n${lines.join('\n')}\n———————————\n${ru ? 'Всего' : 'Total'}: ${total}`;
  };

  /* ---- the range ---- */
  const snapshot = await mfbe.doc.get();
  const selection = await mfbe.selection.get();
  let start = null; // { nodeId, offset } or null = document start
  let end = null; //   { nodeId, offset } or null = document end
  if (options.fromCursor) {
    if (selection) {
      const same = selection.anchor.nodeId === selection.head.nodeId;
      const first = selection.nodes[0];
      start = same
        ? { nodeId: selection.anchor.nodeId, offset: Math.min(selection.anchor.offset, selection.head.offset) }
        : first && first.nodeId === selection.head.nodeId
          ? selection.head
          : selection.anchor;
    }
  } else if (selection && selection.text) {
    const first = selection.nodes[0];
    const last = selection.nodes[selection.nodes.length - 1];
    if (selection.anchor.nodeId === selection.head.nodeId) {
      const a = Math.min(selection.anchor.offset, selection.head.offset);
      const b = Math.max(selection.anchor.offset, selection.head.offset);
      start = { nodeId: selection.anchor.nodeId, offset: a };
      end = { nodeId: selection.anchor.nodeId, offset: b };
    } else if (first && last) {
      start = first.nodeId === selection.anchor.nodeId ? selection.anchor : selection.head;
      end = last.nodeId === selection.anchor.nodeId ? selection.anchor : selection.head;
    }
  }

  /* ---- the walk ---- */
  let level = options.startLevel ?? 0;
  let inRange = start === null;
  let finished = false;
  let lastBlockInRange = null; // { nodeId, length } for the "end of range" caret

  const fail = (message, caret) => {
    throw new QuoteError(message, caret);
  };

  const processBlock = async (node) => {
    const id = node.attrs.nodeId;
    let from = 0;
    let to = Infinity;
    if (start && start.nodeId === id) {
      inRange = true;
      from = start.offset;
    }
    if (!inRange) return;
    if (end && end.nodeId === id) to = end.offset;
    const content = (node.content ?? []).map((run) => (run.type === 'text' ? { ...run, text: run.text ?? '' } : run));
    const plainLength = content.reduce((n, run) => n + (run.type === 'text' ? run.text.length : 1), 0);
    lastBlockInRange = { nodeId: id, length: plainLength };
    let changed = false;
    // Step 1: existing typographic quotes in the range become straight ones.
    let pos = 0;
    for (const run of content) {
      if (run.type !== 'text') {
        pos += 1;
        continue;
      }
      let text = '';
      for (let k = 0; k < run.text.length; k += 1) {
        const ch = run.text[k];
        const p = pos + k;
        text += p >= from && p < to && '«»„“”'.includes(ch) ? '"' : ch;
      }
      if (text !== run.text) changed = true;
      run.text = text;
      pos += run.text.length;
    }
    // Step 2: decide every straight quote.
    const chars = visibleChars(content);
    const write = async () => {
      if (changed) await mfbe.doc.replaceNode({ nodeId: id, type: node.type }, { type: node.type, attrs: { ...node.attrs }, content });
    };
    const put = (entry, ch) => {
      const run = content[entry.run];
      run.text = run.text.slice(0, entry.offset) + ch + run.text.slice(entry.offset + 1);
      entry.ch = ch;
      changed = true;
    };
    for (let i = 0; i < chars.length; i += 1) {
      const entry = chars[i];
      if (entry.ch !== '"' || entry.pos < from || entry.pos >= to) continue;
      const n = {};
      for (let k = 1; k <= 4; k += 1) {
        if (chars[i - k]) n[-k] = chars[i - k].ch;
        if (chars[i + k]) n[k] = chars[i + k].ch;
      }
      const { left, right } = decideIsItLeftOrRightQuotes(n);
      const caret = { nodeId: id, offset: entry.pos };
      if (left && !right) {
        if (onlyGuillemets) {
          put(entry, '«');
          leftCnt[0] += 1;
        } else {
          level += 1;
          if (level > 3) {
            await write();
            fail(ru ? 'Ошибка:\n\nкавычка получается больше чем второго уровня вложения.' : 'Error:\n\nthe quote would be nested deeper than level 2.', caret);
          }
          put(entry, LEFT_QUOTES[level - 1]);
          leftCnt[level - 1] += 1;
        }
      } else if (!left && right) {
        if (onlyGuillemets) {
          put(entry, '»');
          rightCnt[0] += 1;
        } else {
          if (level === 0) {
            await write();
            fail(ru ? 'Ошибка:\n\nкавычка получается меньше чем нулевого уровня вложения.' : 'Error:\n\nthe quote would close below level 0.', caret);
          }
          put(entry, RIGHT_QUOTES[level - 1]);
          rightCnt[level - 1] += 1;
          level -= 1;
        }
      } else if (onlyGuillemets) {
        notReplaced += 1;
      } else {
        await write();
        fail(
          ru
            ? `Невозможно определить, какой нужен тип кавычки:\n\n${left ? 'кавычка получается и левой и правой.' : 'кавычка получается ни левой ни правой.'}`
            : `Cannot tell which quote is needed:\n\n${left ? 'the quote looks both left and right.' : 'the quote looks neither left nor right.'}`,
          caret,
        );
      }
    }
    await write();
    if (end && end.nodeId === id) finished = true;
  };

  const lastBlockOf = (node) => {
    let last = null;
    const visit = (n) => {
      if (!n || n.type === 'text') return;
      if (TEXT_BLOCK_TYPES.has(n.type)) {
        last = n;
        return;
      }
      for (const child of n.content ?? []) visit(child);
    };
    visit(node);
    return last;
  };

  const caretAtEnd = (node) => {
    const block = lastBlockOf(node) ?? lastBlockInRange;
    if (!block) return null;
    const length = (block.content ?? []).reduce((n, run) => n + (run.type === 'text' ? (run.text ?? '').length : 1), 0);
    return { nodeId: block.attrs.nodeId, offset: length };
  };

  const visitContainer = async (node) => {
    if (finished) return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      await processBlock(node);
      return;
    }
    const entered = inRange; // blocks entered inside the range remember their level
    const levelAtStart = options.resetBlockLevels ? 0 : level;
    for (const child of node.content ?? []) {
      if (child.type === 'text') continue;
      await visitContainer(child);
      if (finished) return;
      if (ctx.cancelled) return;
    }
    if (!inRange || onlyGuillemets) return;
    if (node.type === 'section' && level !== 0) {
      fail(
        ru
          ? 'Ошибка:\n\nВ конце секции получился ненулевой уровень вложенности кавычек.\nКурсор установлен в конец этой секции.'
          : 'Error:\n\nthe quote nesting level is not zero at the end of a section.\nThe caret was placed at the end of that section.',
        caretAtEnd(node),
      );
    }
    if (entered && node.type !== 'stanza' && level !== levelAtStart) {
      fail(
        ru
          ? 'Ошибка:\n\nВ конце элемента получился не тот же уровень вложенности кавычек, что в начале.\nКурсор установлен в конец этого элемента.'
          : 'Error:\n\nthe quote nesting level at the end of a block differs from the level at its start.\nThe caret was placed at the end of that block.',
        caretAtEnd(node),
      );
    }
  };

  try {
    for (const body of snapshot.bodies ?? []) {
      await visitContainer(body);
      if (finished || ctx.cancelled) break;
    }
    if (!onlyGuillemets && level !== 0) {
      fail(
        ru
          ? 'Ошибка:\n\nВ конце области документа, заданной для обработки, получился ненулевой уровень вложенности кавычек.\nКурсор установлен в конец этой области.'
          : 'Error:\n\nthe quote nesting level is not zero at the end of the processed range.\nThe caret was placed at the end of that range.',
        lastBlockInRange ? { nodeId: lastBlockInRange.nodeId, offset: lastBlockInRange.length } : null,
      );
    }
  } catch (error) {
    if (!(error instanceof QuoteError)) throw error;
    if (error.caret) {
      try {
        await mfbe.selection.set(error.caret);
        await mfbe.selection.scrollIntoView();
      } catch {
        // the caret position may be unavailable (e.g. a removed node); the message still helps
      }
    }
    await mfbe.ui.message(`${versionStr}${error.message}\n\n${infoStr()}`, { caption: ctx.script.name, icon: 'warning' });
    return;
  }

  if (onlyGuillemets && notReplaced > 0) {
    await mfbe.ui.message(
      ru
        ? `${versionStr}Елочки расставлены, но...\n\n...в некоторых случаях было непонятно,\nлевые или правые елочки нужно делать,\nпоэтому скрипт оставлял прямые кавычки.\n\n   Осталось прямых кавычек – " – ${notReplaced}\n\n${infoStr()}`
        : `${versionStr}Guillemets were placed, but...\n\n...in some places it was unclear whether a left or a right guillemet was needed, so the straight quote was kept.\n\n   Straight quotes left – " – ${notReplaced}\n\n${infoStr()}`,
      { caption: ctx.script.name, icon: 'info' },
    );
    return;
  }
  await mfbe.ui.message(
    ru ? `${versionStr}Ура! Расстановка кавычек прошла без ошибок.\n\n${infoStr()}` : `${versionStr}Done: all quotes were placed without errors.\n\n${infoStr()}`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
