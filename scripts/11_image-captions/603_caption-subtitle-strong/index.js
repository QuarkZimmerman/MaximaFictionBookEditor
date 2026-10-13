// Converted from 11_Заголовки картинок в подписи/603_Заголовок картинки в подпись (subtitle, strong).js (FictionBook Editor).
// Every block image that carries a title attribute gets the title as a bold subtitle right
// after the image; the title attribute is removed. When the image is not followed by an empty
// line already, one is inserted after the caption (the original kept the caption apart from
// the following text that way).
import { captionsFromImageTitles } from './captions.js';

export default async function run(ctx) {
  await captionsFromImageTitles(ctx, { blockType: 'subtitle', mark: 'strong' });
}
