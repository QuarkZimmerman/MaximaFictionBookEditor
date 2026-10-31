// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/02_Унифицировать иллюстрации и вложения.js
// (Sclex, version 1.6; 2.7beta1's 02_Унификация вложений и иллюстраций.js, 1.4, before feature 007).
// Gives the binary objects uniform ids and points the pictures to them: the cover becomes
// cover.png / cover.jpg and the cover of the original edition cover_src.*, a binary that held
// such a name unused_cover.* (its pictures follow it); the binaries the pictures use become
// i_001.png, i_002.jpg... in the order of their first picture, the binaries nothing uses
// unused_<id> and those that are neither JPEG nor PNG nonjpegpng_<id>; a picture whose binary is
// missing gets the address #nobin_<id>. Without a cover, a binary called cover.png, cover.jpg or
// cover.jpeg becomes the cover (cover_src.* likewise). The pictures are those of FictionBook
// Editor's text view: the book's annotation, the history and every body. A message gives the
// counts (2.7.9: with the Russian plural forms) and the lists.
//
// LIMITATION (docs/scripting/conversion-notes-279-a.md, group 05): the script interface can
// neither rename nor reorder binary objects. The plan is computed as the original computes it and
// reported; applied is what needs no renaming: the #nobin_ addresses and a cover taken from a
// binary named cover.* (or cover_src.*) under its present name. The renames are applied as soon
// as a `mfbe.doc.renameBinary(id, newId)` call exists.
// The original's notice, kept as written (FR-029):
// Скрипт «Унифицировать иллюстрации и вложения»
// Автор Sclex

const TEXT_BLOCKS = ['p', 'subtitle', 'v', 'text-author', 'td', 'th'];

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The original's GetLocalHref: the id an address names, or null when it does not start with "#". */
function localHref(href) {
  if (typeof href !== 'string' || !href.startsWith('#')) return null;
  const main = /main\.html#/i.exec(href);
  return main ? href.slice(main.index + 10) : href.slice(1);
}

function isJpegPng(type) {
  return type === 'image/png' || type === 'image/jpeg';
}

/**
 * The renaming plan of the original, worked out on the names: `binaries` in the book's order,
 * `imageHrefs` the addresses of the pictures in the text view's order, `coverId` / `srcCoverId`
 * the binaries the covers name ('' for none, '"' for an address outside the book). Returns
 * `{ rename: Map id -> new id, covers: { title, src }, lists, counts }` or `{ error }`.
 */
export function planUnification(binaries, imageHrefs, coverId, srcCoverId, labels) {
  const typeById = new Map();
  for (const b of binaries) {
    if (typeById.has(b.id)) return { error: 'duplicate', id: b.id };
    typeById.set(b.id, b.contentType);
  }
  const lists = { unused: [], nobin: [], nonLocal: [], nonJpegPng: [] };
  const counts = { images: 0, covers: 0, nonLocal: 0, unused: 0, nobin: 0, nonJpegPng: 0 };
  for (const type of typeById.values()) if (!isJpegPng(type)) counts.nonJpegPng += 1;

  // The pictures: those with a binary are counted, the binaries in the order of their first
  // picture; those without one are listed with the prefix nobin_; the others are not local.
  const usedInOrder = [];
  for (const href of imageHrefs) {
    const id = localHref(href);
    if (id === null) {
      counts.nonLocal += 1;
      lists.nonLocal.push(href);
    } else if (typeById.has(id)) {
      counts.images += 1;
      if (!usedInOrder.includes(id)) usedInOrder.push(id);
    } else {
      counts.nobin += 1;
      lists.nobin.push(id.startsWith('nobin_') ? id : `nobin_${id}`);
    }
  }

  // The names as the original's BinById holds them while it renames: current name -> id.
  const holder = new Map([...typeById.keys()].map((id) => [id, id]));
  const nameOf = new Map([...typeById.keys()].map((id) => [id, id]));
  const move = (id, name) => {
    if (holder.get(nameOf.get(id)) === id) holder.delete(nameOf.get(id));
    holder.set(name, id);
    nameOf.set(id, name);
  };
  const idUsed = new Set(); // the original's IdUsed: names the later steps leave alone

  // The covers: cover.png / cover.jpg (cover_src.*); a binary holding that name becomes
  // unused_<name>; a cover that is neither JPEG nor PNG keeps its id and is listed.
  const covers = { title: '', src: '' };
  const cover = (address, base, label, key) => {
    if (!address || !holder.has(address)) return;
    const id = holder.get(address);
    const type = typeById.get(id);
    let name = address;
    if (type === 'image/png') name = `${base}.png`;
    else if (type === 'image/jpeg') name = `${base}.jpg`;
    else lists.nonJpegPng.push(`${address} (${label})`);
    if (name !== address) {
      if (holder.has(name)) {
        const other = holder.get(name);
        move(other, `unused_${name}`);
        idUsed.add(`unused_${name}`);
      }
      move(id, name);
      counts.covers += 1;
    }
    idUsed.add(name);
    covers[key] = name;
  };
  cover(coverId, 'cover', labels.cover, 'title');
  cover(srcCoverId, 'cover_src', labels.srcCover, 'src');

  // Every other binary goes through a temporary name first, so the names given below never meet
  // an old one; but a name that was the id of such a binary still counts as taken when the
  // original looks for a free unused_ or nonjpegpng_ name (its BinById keeps the temporary
  // entries).
  const tempOriginals = new Set([...typeById.keys()].filter((id) => !idUsed.has(nameOf.get(id))));
  const free = (wanted) => {
    let name = wanted;
    for (let n = 0; holder.has(name) || tempOriginals.has(name); n += 1) name = `${wanted}_${n}`;
    return name;
  };
  const done = new Set();

  // The binaries the pictures use, JPEG and PNG: i_001.png, i_002.jpg ... in picture order.
  let cnt = 0;
  for (const id of usedInOrder) {
    if (!tempOriginals.has(id) || !isJpegPng(typeById.get(id))) continue;
    cnt += 1;
    move(id, `i_${String(cnt).padStart(3, '0')}${typeById.get(id) === 'image/png' ? '.png' : '.jpg'}`);
    done.add(id);
  }
  // The JPEG and PNG binaries nothing uses: unused_<id>, unless the id has the prefix already.
  for (const [id, type] of typeById) {
    if (!tempOriginals.has(id) || done.has(id) || !isJpegPng(type)) continue;
    const name = id.startsWith('unused_') ? id : free(`unused_${id}`);
    move(id, name);
    done.add(id);
    counts.unused += 1;
    lists.unused.push(name);
  }
  // The binaries that are neither JPEG nor PNG (the covers aside): nonjpegpng_<id>.
  for (const [id, type] of typeById) {
    if (!tempOriginals.has(id) || isJpegPng(type)) continue;
    const name = id.startsWith('nonjpegpng_') ? id : free(`nonjpegpng_${id}`);
    move(id, name);
    lists.nonJpegPng.push(name);
  }

  const rename = new Map();
  for (const [id, name] of nameOf) if (name !== id) rename.set(id, name);
  return { rename, covers, lists, counts };
}

/** The original's units(): the Russian word form for a number (nominative, genitive, plural). */
function units(num, [nom, gen, plu]) {
  const n = Math.abs(num);
  if (n % 10 === 1 && n % 100 !== 11) return nom;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return gen;
  return plu;
}

/** The original's time string. */
function timeString(ctx, ms) {
  const Tmin = Math.floor(ms / 60000);
  const Tsec = Math.ceil(ms / 1000 - Tmin * 60);
  const Tsek = Math.ceil(10 * (ms / 1000 - Tmin * 60)) / 10;
  const Tssek = Math.ceil(100 * (ms / 1000 - Tmin * 60)) / 100;
  const Tsssek = Math.ceil(1000 * (ms / 1000 - Tmin * 60)) / 1000;
  const s = t(ctx, 'с', 's');
  if (Tssek < 1 && Tmin < 1) return `${Tsssek} ${s}`;
  if (Tsek < 10 && Tmin < 1) return `${Tssek} ${s}`;
  if (Tmin < 1) return `${Tsek} ${s}`;
  return `${Tmin} ${t(ctx, 'мин', 'min')} ${Tsec} ${s}`;
}

/**
 * Points the first cover of a title-info or src-title-info to `name`, as the original set the
 * first cover list of its form (the other entries stay); returns null when nothing changes.
 */
function withCover(info, name) {
  const [first, ...rest] = info.coverpage ?? [];
  if (!name || first?.href === `#${name}`) return null;
  return { ...info, coverpage: [{ ...(first ?? {}), href: `#${name}` }, ...rest] };
}

export default async function run(ctx) {
  const started = Date.now();
  const doc = await mfbe.doc.get();
  // The pictures in the order of the original's text view: the book's annotation, the history,
  // then every body. `owner` is the block replaced in a body (null in the description).
  const pictures = [];
  const visit = (node, owner, inDescription) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') {
      pictures.push({ node, owner: inDescription ? null : owner ?? node });
    }
    const block = owner ?? (TEXT_BLOCKS.includes(node.type) ? node : null);
    for (const child of node.content ?? []) visit(child, block, inDescription);
  };
  visit(doc.description.titleInfo?.annotation, null, true);
  visit(doc.description.documentInfo?.history, null, true);
  for (const body of doc.bodies) visit(body, null, false);

  // The covers as the description form lists them; without one, a binary named cover.png,
  // cover.jpg or cover.jpeg (cover_src.*) is taken.
  const byId = new Map(doc.binaries.map((b) => [b.id, b]));
  const coverOf = (info) => {
    const href = info?.coverpage?.[0]?.href ?? '';
    return href === '' ? '' : localHref(href) ?? '"';
  };
  const adopt = (base) => ['png', 'jpg', 'jpeg'].map((e) => `${base}.${e}`).find((id) => byId.has(id)) ?? '';
  const titleCover = coverOf(doc.description.titleInfo);
  const srcCover = coverOf(doc.description.srcTitleInfo);
  const effectiveCover = titleCover || adopt('cover');
  const effectiveSrcCover = srcCover || adopt('cover_src');
  if (effectiveCover && effectiveCover === effectiveSrcCover) {
    await mfbe.ui.message(
      t(ctx, 'Ошибка.\nОбложка книги и обложка оригинального издания ссылаются на одно вложение.\nТакая ситуация не обрабатывается данным скриптом.',
        'Error.\nThe book cover and the cover of the original edition use the same binary object.\nThis script does not handle that case.'),
      { icon: 'error' },
    );
    return;
  }
  const plan = planUnification(doc.binaries, pictures.map((p) => p.node.attrs?.href ?? ''), effectiveCover, effectiveSrcCover, {
    cover: t(ctx, 'обложка', 'cover'),
    srcCover: t(ctx, 'обложка ориг. изд.', 'cover of the original edition'),
  });
  if (plan.error === 'duplicate') {
    await mfbe.ui.message(t(ctx, `Ошибка. Два вложения имеют одинаковый id: ${plan.id}`, `Error: two binary objects share the id ${plan.id}`), { icon: 'error' });
    return;
  }

  const canRename = typeof mfbe.doc.renameBinary === 'function';
  if (canRename) {
    // Through temporary names, as the original did, so that no new name meets an old one.
    const temp = new Map();
    let n = 0;
    for (const id of plan.rename.keys()) {
      let name;
      do { n += 1; name = `unify_${n}_${id}`; } while (byId.has(name));
      temp.set(id, name);
      await mfbe.doc.renameBinary(id, name);
    }
    for (const [id, name] of plan.rename) await mfbe.doc.renameBinary(temp.get(id), name);
  }
  // A picture follows its binary; one whose binary is missing gets #nobin_<id>.
  const newHref = (href) => {
    const id = localHref(href);
    if (id === null) return href;
    if (byId.has(id)) return canRename && plan.rename.has(id) ? `#${plan.rename.get(id)}` : href;
    return `#${id.startsWith('nobin_') ? id : `nobin_${id}`}`;
  };
  let descriptionChanged = false;
  const changedOwners = new Set();
  for (const picture of pictures) {
    const href = picture.node.attrs?.href ?? '';
    const next = newHref(href);
    if (next === href) continue;
    picture.node.attrs = { ...picture.node.attrs, href: next };
    if (picture.owner) changedOwners.add(picture.owner);
    else descriptionChanged = true;
  }
  for (const owner of changedOwners) await mfbe.doc.replaceNode(owner.attrs.nodeId, owner);
  // The covers get their new names; without the rename call only a cover taken from a binary
  // named cover.* (cover_src.*) is set, under its present name. A book without a src-title-info
  // gets none (FictionBook Editor wrote one with empty required fields).
  const description = doc.description;
  const titleInfo = withCover(description.titleInfo, canRename ? plan.covers.title : titleCover ? '' : effectiveCover);
  if (titleInfo) {
    description.titleInfo = titleInfo;
    descriptionChanged = true;
  }
  const srcTitleInfo = description.srcTitleInfo
    && withCover(description.srcTitleInfo, canRename ? plan.covers.src : srcCover ? '' : effectiveSrcCover);
  if (srcTitleInfo) {
    description.srcTitleInfo = srcTitleInfo;
    descriptionChanged = true;
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);

  const time = timeString(ctx, Date.now() - started);
  const column = (items) => items.map((x) => `\n   "${x}"`).join('');
  let lists = '';
  if (plan.lists.unused.length) lists += t(ctx, '\nНеиспользуемые бинарные объекты:', '\nUnused binary objects:') + column(plan.lists.unused);
  if (plan.lists.nobin.length) lists += t(ctx, '\nБезбинарные иллюстрации:', '\nIllustrations without a binary:') + column(plan.lists.nobin);
  if (plan.lists.nonLocal.length) lists += t(ctx, '\nИзображения с нелокальными адресами:', '\nPictures with non-local addresses:') + column(plan.lists.nonLocal);
  if (plan.lists.nonJpegPng.length) lists += t(ctx, '\nВложения не image/jpg, не image/png:', '\nBinary objects neither image/jpg nor image/png:') + column(plan.lists.nonJpegPng);
  if (lists) lists = `\n${lists}`;
  let renames = '';
  if (!canRename && plan.rename.size > 0) {
    renames = t(ctx,
      '\n\nВНИМАНИЕ: интерфейс скриптов этой версии не умеет переименовывать вложения; запланированные переименования не применены:',
      '\n\nNOTE: the script interface of this version cannot rename binary objects; the planned renames were not applied:');
    for (const [id, newId] of plan.rename) renames += `\n   "${id}" -> "${newId}"`;
  }
  const c = plan.counts;
  const en = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  await mfbe.ui.message(
    t(ctx,
      '            –= Sclex Script =–\n "Унифицировать иллюстрации и вложения"\n                          v1.6\n\n' +
        `${units(c.images, ['Переименована', 'Переименованы', 'Переименовано'])} ${c.images} ${units(c.images, ['иллюстрация', 'иллюстрации', 'иллюстраций'])}.\n` +
        `${units(c.covers, ['Переименована', 'Переименованы', 'Переименовано'])} ${c.covers} ${units(c.covers, ['обложка', 'обложки', 'обложек'])}.\n` +
        `${units(c.nonLocal, ['Обнаружено', 'Обнаружены', 'Обнаружено'])} ${c.nonLocal} ${units(c.nonLocal, ['изображение', 'изображения', 'изображений'])} с нелокальным адресом.\n` +
        `${units(c.unused, ['Обнаружен', 'Обнаружены', 'Обнаружено'])} ${c.unused} ${units(c.unused, ['неиспользуемый бинарный объект', 'неиспользуемых бинарных объекта', 'неиспользуемых бинарных объектов'])}.\n` +
        `${units(c.nobin, ['Обнаружена', 'Обнаружены', 'Обнаружено'])} ${c.nobin} ${units(c.nobin, ['безбинарная иллюстрация', 'безбинарные иллюстрации', 'безбинарных иллюстраций'])}.\n` +
        `${units(c.nonJpegPng, ['Обнаружена', 'Обнаружены', 'Обнаружено'])} ${c.nonJpegPng} ${units(c.nonJpegPng, ['иллюстрация', 'иллюстрации', 'иллюстраций'])} с типом не image/jpeg, не image/png.\n\n` +
        `Время выполнения: ${time}.${lists}${renames}`,
      '            –= Sclex Script =–\n "Unify the illustrations and binary objects"\n                          v1.6\n\n' +
        `${en(c.images, 'illustration', 'illustrations')} renamed.\n` +
        `${en(c.covers, 'cover', 'covers')} renamed.\n` +
        `${en(c.nonLocal, 'picture', 'pictures')} with a non-local address found.\n` +
        `${en(c.unused, 'unused binary object', 'unused binary objects')} found.\n` +
        `${en(c.nobin, 'illustration', 'illustrations')} without a binary found.\n` +
        `${en(c.nonJpegPng, 'illustration', 'illustrations')} of a type other than image/jpeg and image/png found.\n\n` +
        `Time taken: ${time}.${lists}${renames}`),
  );
}
