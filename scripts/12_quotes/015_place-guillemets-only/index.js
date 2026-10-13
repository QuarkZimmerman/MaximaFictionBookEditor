// Converted from 12_Обработка кавычек/015_Расстановка только елочек.js (FictionBook Editor).
// Turns straight quotes into typographic ones in the selection (or the whole book); ambiguous quotes are left straight; see quotes.js for the rules.
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, { onlyGuillemets: true });
}
