/** React provider for the application services; see `services.ts` for the hooks. */

import type { ReactNode } from 'react';

import { AppServicesContext, type AppServices } from './services';

export function AppProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}
