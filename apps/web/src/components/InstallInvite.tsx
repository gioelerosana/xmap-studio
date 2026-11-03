/**
 * Invito a installare l'app come PWA, mostrato su mobile quando l'app non è
 * già standalone. Il contenuto cambia secondo la piattaforma: su iOS le
 * istruzioni manuali (Safari non ha prompt programmatico), altrove il bottone
 * «Installa» che apre il prompt nativo del browser.
 */
import React from 'react';
import { Menu, Share, SquarePlus } from 'lucide-react';
import { Button, Modal } from '@xmap/ui-kit';
import { AppMark } from './AppMark.js';
import type { InstallPrompt } from '../app/useInstallPrompt.js';

export const InstallInvite: React.FC<{ prompt: InstallPrompt }> = ({ prompt }) => {
  // Il modal si monta solo quando l'invito è attivo: ogni chiusura (bottone, Esc,
  // backdrop) passa da `dismiss`, che aggiorna lo stato e smonta tutto da qui.
  if (!prompt.open) return null;
  const isIOS = prompt.platform === 'ios';
  return (
    <Modal
      isOpen
      onClose={prompt.dismiss}
      title="Installa XMap Studio"
      description="Aggiungilo alla schermata Home: a tutto schermo, senza barra del browser e pronto offline."
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="secondary" onClick={prompt.dismiss}>
            Non ora
          </Button>
          {!isIOS && (
            <Button variant="default" onClick={prompt.install}>
              Installa
            </Button>
          )}
        </div>
      }
    >
      {isIOS ? <IosSteps /> : <AndroidSteps canPrompt={prompt.canPrompt} />}
    </Modal>
  );
};

/** Passi per iOS Safari: Condividi → Aggiungi alla schermata Home. */
function IosSteps(): React.ReactElement {
  return (
    <ol className="flex flex-col gap-3">
      <Step icon={<Share className="size-4" />}>
        Nella barra in basso di Safari, tocca il pulsante <Term>Condividi</Term>.
      </Step>
      <Step icon={<SquarePlus className="size-4" />}>
        Scorri e scegli <Term>Aggiungi alla schermata Home</Term>, poi conferma con <Term>Aggiungi</Term>.
      </Step>
    </ol>
  );
}

/** Passi per Android quando il prompt nativo non è disponibile (es. Firefox). */
function AndroidSteps({ canPrompt }: { canPrompt: boolean }): React.ReactElement {
  return (
    <ol className="flex flex-col gap-3">
      <Step icon={<Menu className="size-4" />}>
        Apri il menu del browser (i tre puntini in alto a destra).
      </Step>
      <Step icon={<SquarePlus className="size-4" />}>
        Scegli <Term>Installa app</Term>
        {canPrompt ? null : (
          <>
            {' '}o <Term>Aggiungi alla schermata Home</Term>
          </>
        )}
        , poi conferma.
      </Step>
    </ol>
  );
}

/** Una riga di passo con icona a lato. */
function Step({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="pt-1 text-sm text-muted-foreground">{children}</span>
    </li>
  );
}

/** Termine dell'interfaccia citato nel testo. */
function Term({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}
