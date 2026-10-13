import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { createAppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { RpcClient } from '@/rpc/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html must contain <div id="root">');
}

async function bootstrap(root: HTMLElement): Promise<void> {
  await initI18n();
  const services = createAppServices({ rpc: new RpcClient() });
  createRoot(root).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
}

void bootstrap(container);
