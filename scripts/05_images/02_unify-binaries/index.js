// Converted from 05_Иллюстрации/02_Унификация вложений и иллюстраций.js (FictionBook Editor 2.7),
// Tier 2. Gives the binary objects uniform ids and updates the images that use them:
//   cover -> cover.png/cover.jpg, cover of the original edition -> cover_src.*, illustrations in
//   order of appearance -> i_001.png, i_002.jpg..., binaries nobody uses -> unused_<id>,
//   binaries that are neither JPEG nor PNG -> nonjpegpng_<id>, images without a binary ->
//   #nobin_<id>; then reports the counts and lists.
//
// LIMITATION (documented in docs/scripting/conversion-notes-a.md): the script API has no call
// to rename a binary object, so the renaming plan is computed and reported but only the parts
// that do not touch binaries are applied (the "nobin_" prefix of images without a binary). The
// renames are applied automatically as soon as a `mfbe.doc.renameBinary(id, newId)` call exists.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// Унификация вложений и картинок
// автор Sclex

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function localHref(href) {
  if (typeof href !== 'string' || !href.startsWith('#')) return null;
  return href.slice(1);
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  return null;
}

/** Computes the renaming plan: Map oldId -> newId, the lists for the report and the new cover ids. */
export function planUnification(binaries, imageHrefs, coverId, srcCoverId) {
  const typeById = new Map();
  for (const b of binaries) {
    if (typeById.has(b.id)) return { error: 'duplicate', id: b.id };
    typeById.set(b.id, b.contentType);
  }
  const lists = { unused: [], nobin: [], nonLocal: [], nonJpegPng: [] };
  const counts = { images: 0, covers: 0, nonLocal: 0, unused: 0, nobin: 0, nonJpegPng: 0 };
  const rename = new Map();
  const imageHrefChanges = new Map(); // old href -> new href
  const order = []; // referenced binary ids in order of first appearance
  for (const href of imageHrefs) {
    const id = localHref(href);
    if (id === null) {
      counts.nonLocal += 1;
      lists.nonLocal.push(href);
      continue;
    }
    if (typeById.has(id)) {
      counts.images += 1;
      if (!order.includes(id)) order.push(id);
    } else {
      const fixed = id.startsWith('nobin_') ? id : `nobin_${id}`;
      counts.nobin += 1;
      lists.nobin.push(fixed);
      if (fixed !== id) imageHrefChanges.set(href, `#${fixed}`);
    }
  }
  const taken = new Set();
  /** First free variant of `wanted` (`wanted`, `wanted_0`, `wanted_1`...); `selfId` may keep its own name. */
  const take = (wanted, selfId = null) => {
    let name = wanted;
    let n = 0;
    while (taken.has(name) || (typeById.has(name) && name !== selfId)) {
      name = `${wanted}_${n}`;
      n += 1;
    }
    taken.add(name);
    return name;
  };
  // Covers first; a binary already holding the wanted name becomes unused_<name>.
  const displaced = [];
  const assignCover = (id, base) => {
    if (!id || !typeById.has(id)) return;
    const ext = extensionFor(typeById.get(id));
    if (!ext) {
      lists.nonJpegPng.push(`${id} (${base === 'cover' ? 'обложка' : 'обложка ориг. изд.'})`);
      taken.add(id);
      rename.set(id, id);
      return;
    }
    const wanted = `${base}${ext}`;
    if (wanted !== id && typeById.has(wanted)) {
      const moved = take(`unused_${wanted}`);
      rename.set(wanted, moved);
      displaced.push(wanted);
    }
    taken.add(wanted);
    rename.set(id, wanted);
    if (wanted !== id) counts.covers += 1;
  };
  assignCover(coverId, 'cover');
  assignCover(srcCoverId, 'cover_src');
  // Illustrations in order of appearance.
  let n = 0;
  for (const id of order) {
    if (rename.has(id)) continue;
    const ext = extensionFor(typeById.get(id));
    if (!ext) continue; // handled below with the other non-JPEG/PNG binaries
    n += 1;
    rename.set(id, take(`i_${String(n).padStart(3, '0')}${ext}`, id));
  }
  // Binaries nobody uses, then the non-JPEG/PNG ones.
  for (const [id, type] of typeById) {
    if (rename.has(id) || displaced.includes(id)) continue;
    if (!extensionFor(type)) continue;
    const name = take(id.startsWith('unused_') ? id : `unused_${id}`, id);
    rename.set(id, name);
    counts.unused += 1;
    lists.unused.push(name);
  }
  for (const [id, type] of typeById) {
    if (rename.has(id) || displaced.includes(id) || extensionFor(type)) continue;
    const name = take(id.startsWith('nonjpegpng_') ? id : `nonjpegpng_${id}`, id);
    rename.set(id, name);
    counts.nonJpegPng += 1;
    lists.nonJpegPng.push(name);
  }
  for (const id of displaced) lists.unused.push(rename.get(id));
  for (const [id, newId] of rename) if (id === newId) rename.delete(id);
  return { rename, imageHrefChanges, lists, counts };
}

export default async function run(ctx) {
  const started = Date.now();
  const doc = await mfbe.doc.get();
  const images = []; // { nodeId (block), node, hrefs } for every block holding images
  const imageHrefs = [];
  const visit = (node, block) => {
    if (node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') {
      imageHrefs.push(node.attrs?.href ?? '');
      images.push({ owner: block ?? node, node });
    }
    for (const child of node.content ?? []) visit(child, block ?? (['p', 'subtitle', 'v', 'text-author', 'td', 'th'].includes(node.type) ? node : null));
  };
  for (const body of doc.bodies) visit(body, null);

  const coverId = localHref(doc.description.titleInfo.coverpage?.[0]?.href ?? '') ?? '';
  const srcCoverId = localHref(doc.description.srcTitleInfo?.coverpage?.[0]?.href ?? '') ?? '';
  // Without a cover the original adopted a binary called cover.png/jpg/jpeg (cover_src.* likewise).
  const byId = new Map(doc.binaries.map((b) => [b.id, b]));
  const adopt = (base) => ['png', 'jpg', 'jpeg'].map((e) => `${base}.${e}`).find((id) => byId.has(id)) ?? '';
  const effectiveCover = coverId || adopt('cover');
  const effectiveSrcCover = srcCoverId || adopt('cover_src');
  if (effectiveCover && effectiveCover === effectiveSrcCover) {
    await mfbe.ui.message(
      t(ctx, 'Ошибка.\nОбложка книги и обложка оригинального издания ссылаются на одно вложение.\nТакая ситуация не обрабатывается данным скриптом.',
        'Error.\nThe book cover and the cover of the original edition use the same binary object.\nThis script does not handle that case.'),
      { icon: 'error' },
    );
    return;
  }
  const plan = planUnification(doc.binaries, imageHrefs, effectiveCover, effectiveSrcCover);
  if (plan.error === 'duplicate') {
    await mfbe.ui.message(t(ctx, `Ошибка. Два вложения имеют одинаковый id: ${plan.id}`, `Error: two binary objects share the id ${plan.id}`), { icon: 'error' });
    return;
  }

  const canRename = typeof mfbe.doc.renameBinary === 'function';
  const hrefChanges = new Map(plan.imageHrefChanges);
  if (canRename) {
    for (const [id, newId] of plan.rename) {
      await mfbe.doc.renameBinary(id, newId);
      hrefChanges.set(`#${id}`, `#${newId}`);
    }
  }
  // Images: rewrite the hrefs that changed, one replaceNode per block / block image.
  const touched = new Set();
  for (const { owner } of images) {
    if (touched.has(owner.attrs.nodeId)) continue;
    touched.add(owner.attrs.nodeId);
    let changed = false;
    const fix = (node) => {
      if (node.type === 'text') return node;
      let next = node;
      if ((node.type === 'image' || node.type === 'inline-image') && hrefChanges.has(node.attrs?.href)) {
        next = { ...node, attrs: { ...node.attrs, href: hrefChanges.get(node.attrs.href) } };
        changed = true;
      }
      if (next.content) next = { ...next, content: next.content.map(fix) };
      return next;
    };
    const fixed = fix(owner);
    if (changed) await mfbe.doc.replaceNode(owner.attrs.nodeId, fixed);
  }
  if (canRename) {
    const description = doc.description;
    const newCover = plan.rename.get(effectiveCover) ?? effectiveCover;
    const newSrcCover = plan.rename.get(effectiveSrcCover) ?? effectiveSrcCover;
    const titleInfo = { ...description.titleInfo, coverpage: newCover ? [{ href: `#${newCover}` }] : description.titleInfo.coverpage };
    const srcTitleInfo = description.srcTitleInfo
      ? { ...description.srcTitleInfo, coverpage: newSrcCover ? [{ href: `#${newSrcCover}` }] : description.srcTitleInfo.coverpage }
      : undefined;
    await mfbe.doc.setDescription({ ...description, titleInfo, ...(srcTitleInfo ? { srcTitleInfo } : {}) });
  }

  const ms = Date.now() - started;
  const time = `${ms < 1000 ? Math.ceil(ms) / 1000 : Math.ceil(ms / 100) / 10} ${t(ctx, 'с', 's')}`;
  const column = (items) => items.map((x) => `\n   "${x}"`).join('');
  let lists = '';
  if (plan.lists.unused.length) lists += t(ctx, '\nВложения, на которые нет ссылки:', '\nBinary objects nothing refers to:') + column(plan.lists.unused);
  if (plan.lists.nobin.length) lists += t(ctx, '\nРисунки, для которых нет вложения:', '\nImages without a binary object:') + column(plan.lists.nobin);
  if (plan.lists.nonLocal.length) lists += t(ctx, '\nКартинки с нелокальными ссылками:', '\nImages with external addresses:') + column(plan.lists.nonLocal);
  if (plan.lists.nonJpegPng.length) lists += t(ctx, '\nВложения не image/jpg, не image/png:', '\nBinary objects that are neither image/jpeg nor image/png:') + column(plan.lists.nonJpegPng);
  if (lists) lists = `\n${lists}`;
  let renames = '';
  if (!canRename && plan.rename.size > 0) {
    renames = t(ctx,
      '\n\nВНИМАНИЕ: интерфейс скриптов этой версии не умеет переименовывать вложения; запланированные переименования не применены:',
      '\n\nNOTE: the script interface of this version cannot rename binary objects; the planned renames were not applied:');
    for (const [id, newId] of plan.rename) renames += `\n   "${id}" -> "${newId}"`;
  }
  const c = plan.counts;
  await mfbe.ui.message(
    t(ctx,
      `            –= Sclex Script =–\n "Унификация вложений и картинок"\n                          v1.4\n\nПереименовано иллюстраций: …… ${c.images}\n    Переименовано обложек:  ……… ${c.covers}\n    Нездешние изображения:  ……… ${c.nonLocal}\n    Лишние бинарные объекты: …… ${c.unused}\n    Безбинарные иллюстрации: …… ${c.nobin}\n   Не image/jpeg, не image/png: …… ${c.nonJpegPng}\n\nВремя выполнения: ${time}.${lists}${renames}`,
      `            –= Sclex Script =–\n "Unification of binaries and images"\n                          v1.4\n\nIllustrations renamed: …… ${c.images}\n    Covers renamed:  ……… ${c.covers}\n    External images:  ……… ${c.nonLocal}\n    Unused binary objects: …… ${c.unused}\n    Images without binary: …… ${c.nobin}\n   Not image/jpeg, not image/png: …… ${c.nonJpegPng}\n\nTime taken: ${time}.${lists}${renames}`),
  );
}
