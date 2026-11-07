/** Rules of the picture chooser (feature 010, US2), kept apart from the component. */

import type { BinaryMeta } from '@/model/document';

/** The pictures whose id contains `filter` (case-insensitive), in the given order. */
export function filterPictures(binaries: BinaryMeta[], filter: string): BinaryMeta[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return binaries;
  return binaries.filter((binary) => binary.id.toLowerCase().includes(needle));
}
