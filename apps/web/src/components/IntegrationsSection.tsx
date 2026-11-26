import { ClaudeSection } from './ClaudeSection.js';
import { HermesSection } from './HermesSection.js';

/**
 * Sezione "Integrazioni" delle impostazioni: un blocco per ogni collegamento disponibile nell'app desktop.
 * Ogni blocco decide da sé se il main process espone il proprio collegamento.
 */
export function IntegrationsSection() {
  const hasClaudeLink = typeof window.electronAPI?.getClaudeLink === 'function';
  const hasHermesLink = typeof window.electronAPI?.getHermesLink === 'function';
  return (
    <>
      {hasClaudeLink ? <ClaudeSection /> : null}
      {hasHermesLink ? <HermesSection /> : null}
    </>
  );
}
