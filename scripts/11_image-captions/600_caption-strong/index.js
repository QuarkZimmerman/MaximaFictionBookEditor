// Converted from 11_Заголовки картинок в подписи/600_Заголовок картинки в подпись (strong).js (FictionBook Editor).
// Every block image that carries a title attribute gets the title as a bold paragraph right
// after the image; the title attribute is removed. When the image is not followed by an empty
// line already, one is inserted after the caption (the original kept the caption apart from
// the following text that way).
import { captionsFromImageTitles } from './captions.js';

export default async function run(ctx) {
  await captionsFromImageTitles(ctx, { blockType: 'p', mark: 'strong' });
}
