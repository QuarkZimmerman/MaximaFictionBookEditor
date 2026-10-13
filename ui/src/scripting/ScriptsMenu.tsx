/**
 * Scripts menu integration (T105). `useScriptsMenu()` returns the run-time items of the
 * Scripts top-level menu (group sub-menus in `NN` order, "No scripts found" when empty, then
 * Last script / Open scripts folder / Reload scripts) for `MenuBar`'s `dynamicItems.scripts`,
 * and attaches the feature to the RPC client so the catalogue loads once connected and follows
 * `resources.changed`. Mounting (App.tsx):
 *
 *   const scriptsMenu = useScriptsMenu();
 *   const menuItems = useMemo(() => ({ ...dynamicMenuItems, recent, scripts: scriptsMenu }), ...);
 */

import { useEffect, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';

import type { MenuItemSpec } from '@/app/menus';
import { useAppServices, useCommandContext } from '@/app/services';

import { getScriptsFeature, type ScriptsFeature } from './catalog';

/** The feature of the current store (undefined before the registrar ran). */
export function useScriptsFeature(): ScriptsFeature | undefined {
  const services = useAppServices();
  const ctx = useCommandContext();
  const feature = getScriptsFeature(services.store);
  useEffect(() => {
    if (feature && services.rpc) feature.attach(services.rpc);
  }, [feature, services.rpc]);
  useEffect(() => {
    if (!feature) return undefined;
    feature.setContextProvider(() => ctx);
    return () => feature.setContextProvider(null);
  }, [feature, ctx]);
  return feature;
}

/** Re-renders when the catalogue or the run state changes; returns a revision counter. */
export function useScriptsRevision(feature: ScriptsFeature | undefined): number {
  const [revision, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => (feature ? feature.subscribe(bump) : undefined), [feature]);
  return revision;
}

/** Items for the dynamic `scripts` menu. */
export function useScriptsMenu(): MenuItemSpec[] {
  const feature = useScriptsFeature();
  const revision = useScriptsRevision(feature);
  const { i18n } = useTranslation();
  return useMemo(
    () => (feature ? feature.menuItems() : []),
    // The revision and the language are the inputs that change the items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feature, revision, i18n.language],
  );
}
