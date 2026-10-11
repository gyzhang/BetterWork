import '../../apps/desktop/src/renderer/src/styles.css';

import { createRoot } from 'react-dom/client';

import { App } from '../../apps/desktop/src/renderer/src/App';
import { persistAppearance } from '../../apps/desktop/src/renderer/src/appearance';
import { runArtifactJourney } from './ui-app-artifact-journey';
import { runMemoryJourney } from './ui-app-memory-journey';
import { runRecoveryJourney } from './ui-app-recovery-journey';
import { runTaskJourney } from './ui-app-task-journey';

async function runStep(step: string): Promise<{ step: string; alerts: number; width: number }> {
  await runTaskJourney(step);
  await runArtifactJourney(step);
  await runMemoryJourney(step);
  await runRecoveryJourney(step);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  if (
    document.documentElement.dataset.theme !== 'dark' ||
    document.documentElement.dataset.scheme !== 'jade'
  )
    throw new Error('完整应用外观与报告的青玉深色不一致');
  if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('完整应用横向溢出');
  return { step, alerts: document.querySelectorAll('[role="alert"]').length, width: innerWidth };
}

declare global {
  interface Window {
    uiAppChecks?: { runStep: typeof runStep };
  }
}
persistAppearance({ mode: 'dark', scheme: 'jade' });
window.uiAppChecks = { runStep };
const host = document.getElementById('root');
if (!host) throw new Error('缺应用挂载节点');
createRoot(host).render(<App />);
