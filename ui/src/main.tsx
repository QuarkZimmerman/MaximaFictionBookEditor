import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { installFileDialogBlock } from '@/app/fileDialogBlock';
import { installModalJobBlock } from '@/app/modalJob';
import { ModalJobOverlay } from '@/app/ModalJobOverlay';
import { createAppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { RpcClient } from '@/rpc/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html must contain <div id="root">');
}

async function bootstrap(root: HTMLElement): Promise<void> {
  await initI18n();
  const rpc = new RpcClient();
  installFileDialogBlock(rpc, root);
  const services = createAppServices({ rpc });
  createRoot(root).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
  // Feature 011 (DP-11): a modal job's overlay lives outside the root it makes inert.
  const overlay = document.createElement('div');
  overlay.id = 'mfbe-modal-job-root';
  document.body.append(overlay);
  installModalJobBlock(root, () => overlay);
  createRoot(overlay).render(
    <StrictMode>
      <ModalJobOverlay />
    </StrictMode>,
  );
}

void bootstrap(container);
