/** Documents as the core answers them when it loads one (`doc.new`, `doc.open`, `doc.fromXml`). */

import type { Document } from '@/model/document';

import type { LoadReport } from './types';

/** The document model without the load report the core sends along with it. */
export function loadedDocument(document: Document & LoadReport): Document {
  const model: Document & LoadReport = { ...document };
  delete model.filledIn;
  delete model.templateIssue;
  return model;
}
