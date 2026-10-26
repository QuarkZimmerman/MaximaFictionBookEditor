import { registerAiFeature } from '@/ai';
import type { FeatureContext } from '@/app/services';

import { registerDescriptionFeature } from './description';
import { registerEditingFeature } from './editing';
import { registerHelpFeature } from './help';
import { registerImagesFeature } from './images';
import { registerScriptsFeature } from './scripts';
import { registerSettingsFeature } from './settings';
import { registerSourceFeature } from './source';
import { registerSpellFeature } from './spell';
import { registerTablesFeature } from './tables';
import { registerTransferFeature } from './transfer';
import { registerTreeFeature } from './tree';
import { registerWordsFeature } from './words';

/**
 * Feature registrars, called once by createAppServices() in this order. Each feature lives in
 * its own directory under src/features/ (the AI assistant under src/ai/, whose other modules
 * form the lazy `ai-assistant` chunk) and must only register commands, undo adapters, caret
 * providers or store subscriptions here - UI components are mounted by App.tsx. The AI
 * assistant comes last: it registers nothing until the first settings snapshot and takes its
 * stubs over from the registry the other features have finished with (feature 005 FR-096).
 */
export const featureRegistrars: Array<(ctx: FeatureContext) => void> = [
  registerEditingFeature,
  registerSourceFeature,
  registerDescriptionFeature,
  registerTreeFeature,
  registerSpellFeature,
  registerImagesFeature,
  // Feature 006 (data-model §9.1): takes over the table commands' stubs after the images feature.
  registerTablesFeature,
  registerWordsFeature,
  registerTransferFeature,
  registerSettingsFeature,
  registerScriptsFeature,
  registerHelpFeature,
  registerAiFeature,
];
