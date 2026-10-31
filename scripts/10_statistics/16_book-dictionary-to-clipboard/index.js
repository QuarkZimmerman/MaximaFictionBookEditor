// Converted from FictionBook Editor 2.7.9: Scripts/10_Статистика/16_Словарь книги - в буфер обмена.js
// Makes the dictionary of the book's main body (the first body; no annotation, no notes): every
// word with a Russian letter - Latin letters, digits and hyphens may be part of it, and stress
// marks - counted case-insensitively. A window gives the time, the number of words and of unique
// words and asks whether to send the list to the clipboard; Yes puts there one line per unique
// word, the most frequent first (words of one count in alphabetical order): "<count><Tab><Word>",
// the word with its first letter as found and the rest in lower case. Above 130,000 words it
// first asks whether to go on (the original's setting Preduprezhdenie_on_off = 1).
// Difference from the original: none in the list; the window's time leaves out the time of the
// questions, as the original's did. See docs/scripting/notes-279-drafts/10.md.
// The original's notice, kept as written (FR-029):
//----------------------------------------------------------------------------------------------------------------------------
//                     «Словарь книги – в буфер обмена»
//  Скрипт предназначен для создания списка уникальных слов книги (авторский словарь)
//----------------------------------------------------------------------------------------------------------------------------
//  Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//----------------------------------------------------------------------------------------------------------------------------
// v.1.0 — Создание скрипта — Александр Ка (22.02.2025)
// v.1.1 — Мелкие правки — Александр Ка (02.05.2025)
//----------------------------------------------------------------------------------------------------------------------------

const NumerusVersion = '1.1';

// ---------------------------------------------------------------
//  НАСТРОЙКИ (settings)
// ---------------------------------------------------------------
//     Показывать предупреждение о продолжительном времени вычислений ("0" — отключить,
//     "1" — показывать)
const Preduprezhdenie_on_off = 1;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

///  Функция склонения по падежам в зависимости от числа
function pad(Numer) {
  let ok = 2;
  const m1 = Numer % 10;
  const m2 = Numer % 100;
  if (m2 < 11 || m2 > 19) {
    if (m1 === 1) ok = 0;
    else if (m1 === 2 || m1 === 3 || m1 === 4) ok = 1;
  }
  return ok;
}

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);

/** The innerText of a body as FictionBook Editor gave it: its paragraphs, a line each. */
function innerTextOf(body) {
  const lines = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      lines.push((node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(''));
      return;
    }
    if (node.type === 'empty-line') {
      lines.push('');
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(body);
  return lines.join('\r\n');
}

async function askYesNo(ctx, text) {
  return (await MsgBox(text, ctx.script.name, 4 + 32)) === 6;
}

export default async function run(ctx) {
  const Ts = Date.now();
  let T_pause = 0;

  //   Получение всех слов из <body>
  const { bodies } = await mfbe.doc.get();
  const Txt = bodies?.length ? innerTextOf(bodies[0]).toUpperCase() : '';
  const mSlovo1 = Txt.match(/[A-Z0-9-]*[А-ЯЁ][А-Я́ЁA-Z0-9-]*/g);
  if (Txt.search(/[А-Я́Ё]+/) === -1 || !mSlovo1) {
    await mfbe.ui.message(
      t(ctx, '   В разделе <body> нет слов.                 ', '   The <body> has no words.                 '),
      { caption: ctx.script.name, icon: 'info' },
    );
    return;
  }

  //  Проверка на сложность вычислений
  const count_Slovo = mSlovo1.length;
  const slov = [' слово', ' слова', ' слов'];
  const thousands = `${count_Slovo}`.replace(/(\d)(?=(\d\d\d)+$)/g, t(ctx, '$1.', '$1,'));
  if (Preduprezhdenie_on_off === 1 && count_Slovo >= 130000 && count_Slovo < 200000) {
    T_pause -= Date.now();
    const go = await askYesNo(
      ctx,
      t(
        ctx,
        `В разделе <body> найдено ${thousands}${slov[pad(count_Slovo)]}.              \nДля такого количества, дальнейшее              \nсоставление списка уникальных слов              \nможет занять продолжительное время.              \n\n                    Продолжить?\n\n`,
        `The <body> holds ${thousands} words.              \nFor so many, making the list              \nof unique words              \nmay take a long time.              \n\n                    Go on?\n\n`,
      ),
    );
    if (!go) return;
    T_pause += Date.now();
  }
  if (Preduprezhdenie_on_off === 1 && count_Slovo >= 200000) {
    T_pause -= Date.now();
    const go = await askYesNo(
      ctx,
      t(
        ctx,
        `В разделе <body> найдено ${thousands}${slov[pad(count_Slovo)]}.              \n     Для дальнейшего составления\n           списка уникальных слов\nможет  потребоваться  значительный\n             промежуток  времени.\n\n                    Продолжить?\n\n`,
        `The <body> holds ${thousands} words.              \n     Making the list\n           of unique words\nmay  need  a  considerable\n             time.\n\n                    Go on?\n\n`,
      ),
    );
    if (!go) return;
    T_pause += Date.now();
  }

  //  Первая сортировка (получение массива с уникальными словами - сортировка по алфавиту)
  const mSlovo2 = [' ', '№'];
  const m_Count_Slovo2 = [0, 0];
  aaa: for (let n = 0; n < count_Slovo; n += 1) {
    if (n % 5000 === 4999) {
      if (ctx.cancelled) return;
      await mfbe.ui.progress(n, count_Slovo, ctx.script.name);
    }
    let k1 = 0;
    let k2 = m_Count_Slovo2.length - 1;
    while (k2 - k1 !== 1) {
      const kMidi = Math.floor((k2 + k1) / 2);
      if (mSlovo1[n] === mSlovo2[kMidi]) {
        m_Count_Slovo2[kMidi] += 1;
        continue aaa;
      }
      if (mSlovo1[n] > mSlovo2[kMidi]) k1 = kMidi;
      else k2 = kMidi;
    }
    mSlovo2.splice(k2, 0, mSlovo1[n]);
    m_Count_Slovo2.splice(k2, 0, 1);
  }
  mSlovo2.pop();
  mSlovo2.shift();
  m_Count_Slovo2.pop();
  m_Count_Slovo2.shift();

  //  Вторая сортировка (получение полностью отсортированного массива с уникальными словами)
  const count_dict = m_Count_Slovo2.length;
  const mSlovo3 = ['', ''];
  const m_Count_Slovo3 = [1000000, 0];
  for (let n = 0; n < count_dict; n += 1) {
    let k1 = 0;
    let k2 = m_Count_Slovo3.length - 1;
    while (k2 - k1 !== 1) {
      const kMidi = Math.floor((k2 + k1) / 2);
      if (m_Count_Slovo2[n] <= m_Count_Slovo3[kMidi]) k1 = kMidi;
      else k2 = kMidi;
    }
    mSlovo3.splice(k2, 0, mSlovo2[n]);
    m_Count_Slovo3.splice(k2, 0, m_Count_Slovo2[n]);
  }
  mSlovo3.pop();
  mSlovo3.shift();
  m_Count_Slovo3.pop();
  m_Count_Slovo3.shift();

  /// ОКНО РЕЗУЛЬТАТОВ  :  Текущее время и дата
  const now = new Date();
  const currentMinutes = `${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
  const currentSeconds = `${now.getSeconds() < 10 ? '0' : ''}${now.getSeconds()}`;
  const currentMonth = `${1 + now.getMonth() < 10 ? '0' : ''}${1 + now.getMonth()}`;
  const currentYear = `${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const currentTime = `${now.getHours()}:${currentMinutes}:${currentSeconds}`;
  const currentDate = `${now.getDate()}.${currentMonth}.${currentYear}`;

  /// Подсчет чистого компьютерного времени, потраченного на обработку текста
  const T2 = Date.now() - Ts - T_pause;
  const Tmin = Math.floor(T2 / 60000);
  const TsecD = (T2 % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  let tempus;
  if (Tmin === 0) {
    const seconds = `${+`${TsecD}`.replace(/(.{1,5}).*/g, '$1')}`;
    tempus = t(ctx, `${seconds.replace('.', ',')} сек`, `${seconds} s`);
  } else {
    tempus = `${Tmin}${t(ctx, ' мин', ' min')}`;
    if (Tsec !== 0) tempus += ` ${Tsec}${t(ctx, ' с', ' s')}`;
  }

  /// Сборка массива с результатами обработки
  const protsentValue = `${Math.round((count_dict / count_Slovo) * 1000) / 10}`;
  const protsent = t(ctx, protsentValue.replace('.', ','), protsentValue);
  const mSt = [];
  mSt.push(t(ctx, ` «Словарь книги – в буфер обмена» v.${NumerusVersion}`, ` «Book dictionary to the clipboard» v.${NumerusVersion}`));
  mSt.push('--------------------------------------------------------');
  mSt.push('\t\t\t\t\t   ');
  mSt.push(t(ctx, '• СТАТИСТИКА:\t\t\t\t', '• STATISTICS:\t\t\t\t'));
  mSt.push(`${t(ctx, '   Время выполнения  .  .  .  .  .  .  .  .\t', '   Time  .  .  .  .  .  .  .  .  .  .  .  .\t')}${tempus}`);
  mSt.push(`${t(ctx, '   Всего слов  .  .  .  .  .  .  .  .  .  .  .  .\t', '   Words  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_Slovo}`);
  mSt.push(`${t(ctx, '   Уникальных слов .  .  .  .  .  .  .  .  .\t', '   Unique words  .  .  .  .  .  .  .  .  .\t')}${count_dict} (${protsent}%)`);
  mSt.push('');
  mSt.push(`• ${currentDate} • ${currentTime} •`);
  mSt.push('');
  mSt.push('--------------------------------------------------------');
  mSt.push(t(ctx, ' ◊  Отправить список уникальных слов', ' ◊  Send the list of unique words'));
  mSt.push(t(ctx, '                  в буфер обмена?\n', '                  to the clipboard?\n'));

  //  Вывод окна результатов (и вопроса о сохранении в буфер)
  const st2 = mSt.map((line) => `${line}\n`).join('');
  if (!(await askYesNo(ctx, st2))) return;

  /// СОХРАНЕНИЕ СПИСКА
  let Txt2 = t(ctx, 'Число слов в тексте\tСлово\n', 'Occurrences\tWord\n');
  for (let n = 0; n < count_dict; n += 1) {
    Txt2 += `${m_Count_Slovo3[n]}\t${mSlovo3[n].replace(/(.).*/g, '$1')}${mSlovo3[n].replace(/^(.)/g, '').toLowerCase()}\n`;
  }
  await mfbe.clipboard.writeText(Txt2);
}
