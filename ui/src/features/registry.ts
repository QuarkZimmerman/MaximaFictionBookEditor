import type { FeatureContext } from '@/app/services';

import { registerDescriptionFeature } from './description';
import { registerEditingFeature } from './editing';
import { registerHelpFeature } from './help';
import { registerImagesFeature } from './images';
import { registerScriptsFeature } from './scripts';
import { registerSettingsFeature } from './settings';
import { registerSourceFeature } from './source';
import { registerSpellFeature } from './spell';
import { registerTreeFeature } from './tree';
import { registerWordsFeature } from './words';

/**
 * Feature registrars, called once by createAppServices() in this order. Each feature lives in
 * its own directory under src/features/ and must only register commands, undo adapters, caret
 * providers or store subscriptions here - UI components are mounted by App.tsx.
 */
export const featureRegistrars: Array<(ctx: FeatureContext) => void> = [
  registerEditingFeature,
  registerSourceFeature,
  registerDescriptionFeature,
  registerTreeFeature,
  registerSpellFeature,
  registerImagesFeature,
  registerWordsFeature,
  registerSettingsFeature,
  registerScriptsFeature,
  registerHelpFeature,
];
