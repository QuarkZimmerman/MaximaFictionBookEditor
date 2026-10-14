// Converted from 11_Заголовки картинок в подписи/604_Заголовок картинки в подпись (subtitle, emphasis).js (FictionBook Editor).
// Every block image that carries a title attribute gets the title as an italic subtitle right
// after the image; the title attribute is removed. When the image is not followed by an empty
// line already, one is inserted after the caption (the original kept the caption apart from
// the following text that way).
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//author: Sclex
//version: 1.1
//Sclex, не забывай изменять номер версии в переменной versionStr
import { captionsFromImageTitles } from './captions.js';

export default async function run(ctx) {
  await captionsFromImageTitles(ctx, { blockType: 'subtitle', mark: 'emphasis' });
}
