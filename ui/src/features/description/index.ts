/**
 * Description forms feature registrar (US3, T075-T077). Called once by `createAppServices()`
 * after the editing feature: creates the per-store `DescriptionController` (the form state that
 * survives view switches), registers its undo adapter as the `description` view of the undo
 * coordinator, its caret provider and its Find / Replace target (the plain text fields of the
 * Description view, FR-035) with the search session created by the editing feature.
 */

import type { FeatureContext } from '@/app/services';
import {
  DESCRIPTION_UNDO_VIEW,
  descriptionControllerFor,
  type DescriptionController,
} from '@/views/description/binding';

import { getSearchSession } from '../search/search';

export { DESCRIPTION_UNDO_VIEW, descriptionControllerFor } from '@/views/description/binding';

export function registerDescriptionFeature(ctx: FeatureContext): DescriptionController {
  const { store, undo, carets } = ctx;
  const controller = descriptionControllerFor(store, undo);
  undo.registerView(DESCRIPTION_UNDO_VIEW, controller.undoAdapter);
  carets.register('description', controller.caretProvider);
  getSearchSession(store, undo).registerTarget(controller.searchTarget);
  return controller;
}
