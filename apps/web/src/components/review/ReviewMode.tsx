import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  ListTree,
  Maximize,
  Minimize,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { Button, IconButton, Kbd, cn } from '@xmap/ui-kit';
import {
  DEFAULT_LAYOUT_OPTS,
  buildReviewPath,
  layoutBoundaries,
  layoutSheets,
  reviewCollapsed,
  reviewFocus,
  stepIndexOf,
  type MapStructure,
  type ReviewStep,
  type SheetDto,
} from '@xmap/core';
import { ReviewCanvas } from './ReviewCanvas.js';
import { useMathJaxVersion } from '../../mathReady.js';
import { useMediaQuery } from '../map/useMediaQuery.js';
import { COMPACT_QUERY, TEXT_FIELD } from '../../app/constants.js';

export type ReviewModeKind = 'present' | 'test';
type Mark = 'ok' | 'again';

export interface ReviewModeProps {
  sheets: readonly SheetDto[];
  /** Punto di partenza: foglio e blocco selezionato nell'editor (o la radice del foglio). */
  startSheetIndex: number;
  startTopicId?: string;
  structure: MapStructure;
  darkMode: boolean;
  resourceResolver: (src: string) => Uint8Array | null;
  /** Uscita: foglio e blocco dell'ultimo passo, da selezionare nell'editor. */
  onExit: (sheetIndex: number, topicId: string | undefined) => void;
}

const MODE_KEY = 'xmap.review.mode';
const NO_INSETS = { top: 0, bottom: 0 };

function readMode(): ReviewModeKind {
  try {
    return localStorage.getItem(MODE_KEY) === 'test' ? 'test' : 'present';
  } catch {
    return 'present';
  }
}
function writeMode(mode: ReviewModeKind): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Preferenza di comodo: senza storage si riparte da "Presenta".
  }
}

/** Chiave unica di un blocco nel file: gli id sono unici per foglio, non per forza fra fogli. */
const keyOf = (sheetIndex: number, topicId: string) => `${sheetIndex}\u0000${topicId}`;

/** Blocchi da rendere "scoperti" quando si arriva su un passo: il passo stesso e i suoi antenati. */
const visitKeys = (step: ReviewStep) => [step.topicId, ...step.ancestorIds].map((id) => keyOf(step.sheetIndex, id));

/**
 * Modalità Ripasso: percorre tutto il file, foglio dopo foglio, un blocco alla volta.
 * "Presenta" mostra tutto e sposta il riflettore; "Mettiti alla prova" nasconde i figli del
 * blocco a fuoco finché non li scopri. Sola lettura: il file non cambia.
 */
export const ReviewMode: React.FC<ReviewModeProps> = ({
  sheets,
  startSheetIndex,
  startTopicId,
  structure,
  darkMode,
  resourceResolver,
  onExit,
}) => {
  const path = useMemo(() => buildReviewPath(sheets), [sheets]);
  const steps = path.steps;
  const compact = useMediaQuery(COMPACT_QUERY);
  const mathVersion = useMathJaxVersion();

  const initialIndex = useMemo(() => {
    if (startTopicId) {
      const i = stepIndexOf(path, startSheetIndex, startTopicId);
      if (i >= 0) return i;
    }
    return path.sheetStarts.find((s) => s.sheetIndex === startSheetIndex)?.firstStep ?? 0;
    // Solo all'apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [index, setIndex] = useState(initialIndex);
  // Indice aggiornato subito, non al render: tasti premuti in fila (telecomando, tasto tenuto) avanzano tutti.
  const indexRef = useRef(initialIndex);
  const [mode, setModeState] = useState<ReviewModeKind>(readMode);
  const [finished, setFinished] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  // Modo prova: blocchi di cui si vede il titolo, figli aperti nel layout, note mostrate.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [notesShown, setNotesShown] = useState<Set<string>>(() => new Set());
  const [marks, setMarks] = useState<Map<string, Mark>>(() => new Map());

  const step: ReviewStep | undefined = steps[Math.min(index, steps.length - 1)];
  const sheet = step ? sheets.find((s) => s.index === step.sheetIndex) : undefined;
  const test = mode === 'test';

  // Arrivo su un passo: visto, e (per la prova) titolo suo e degli antenati scoperto, rami aperti.
  useEffect(() => {
    if (!step) return;
    const keys = visitKeys(step);
    const add = (prev: Set<string>, list: string[]) => {
      if (list.every((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      list.forEach((k) => next.add(k));
      return next;
    };
    setSeen((prev) => add(prev, [keys[0]]));
    setRevealed((prev) => add(prev, keys));
    setOpened((prev) => add(prev, keys));
  }, [step]);

  const stepByKey = useMemo(() => new Map(steps.map((s, i) => [keyOf(s.sheetIndex, s.topicId), i])), [steps]);
  const titleOf = useCallback(
    (sheetIndex: number, id: string) => {
      const i = stepByKey.get(keyOf(sheetIndex, id));
      return i === undefined ? '' : steps[i].title;
    },
    [stepByKey, steps]
  );

  const topic = useMemo(() => sheet?.topics.find((t) => t.id === step?.topicId), [sheet, step]);
  const notes = (topic?.notesDisplay || topic?.notes || '').trim();

  // Layout del foglio corrente. In prova restano chiusi i rami non ancora aperti; in presentazione
  // tutto è aperto, anche i rami chiusi nel file (il ripasso non li salta).
  const openedInSheet = useMemo(() => {
    const out = new Set<string>();
    if (!step) return out;
    const prefix = `${step.sheetIndex}\u0000`;
    for (const k of opened) if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
    // Il passo corrente è aperto subito, anche prima che l'effetto di visita aggiorni lo stato.
    for (const id of [step.topicId, ...step.ancestorIds]) out.add(id);
    return out;
  }, [opened, step]);
  const collapsed = useMemo(
    () => (test && sheet ? reviewCollapsed(sheet, openedInSheet) : new Set<string>()),
    [test, sheet, openedInSheet]
  );
  const layout = useMemo(
    () => (sheet ? layoutSheets([sheet], collapsed, undefined, { ...DEFAULT_LAYOUT_OPTS, structure }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, collapsed, structure, mathVersion]
  );
  const boundaries = useMemo(() => (layout && sheet ? layoutBoundaries(layout, [sheet]) : []), [layout, sheet]);

  const focus = useMemo(() => (step ? reviewFocus(step) : { lit: new Set<string>(), path: new Set<string>() }), [step]);
  const isRevealed = useCallback(
    (sheetIndex: number, id: string) => revealed.has(keyOf(sheetIndex, id)),
    [revealed]
  );
  const hidden = useMemo(() => {
    const out = new Set<string>();
    if (!test || !layout || !step) return out;
    for (const n of layout.nodes) {
      if (n.id !== step.topicId && !step.ancestorIds.includes(n.id) && !isRevealed(step.sheetIndex, n.id)) out.add(n.id);
    }
    return out;
  }, [test, layout, step, isRevealed]);

  const hiddenChildren = step ? step.childIds.filter((id) => hidden.has(id)) : [];
  const notesHidden = test && notes !== '' && step !== undefined && !notesShown.has(keyOf(step.sheetIndex, step.topicId));
  const canReveal = test && (hiddenChildren.length > 0 || notesHidden);
  const canMark = test && !canReveal && step !== undefined && (step.childIds.length > 0 || notes !== '');
  const currentKey = step ? keyOf(step.sheetIndex, step.topicId) : '';

  // Inquadratura: la radice di un foglio mostra tutto il foglio (panoramica), gli altri passi
  // il blocco con figli e genitore.
  const frameIds = useMemo(() => {
    if (!step) return [];
    if (step.isSheetStart) return [];
    const parent = step.ancestorIds[step.ancestorIds.length - 1];
    return [step.topicId, ...step.childIds, ...(parent ? [parent] : [])];
  }, [step]);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= steps.length) return;
      setFinished(false);
      indexRef.current = i;
      setIndex(i);
      setRailOpen(false);
    },
    [steps.length]
  );

  const reveal = useCallback(() => {
    if (!step) return;
    setRevealed((prev) => {
      const next = new Set(prev);
      step.childIds.forEach((id) => next.add(keyOf(step.sheetIndex, id)));
      return next;
    });
    setNotesShown((prev) => new Set(prev).add(keyOf(step.sheetIndex, step.topicId)));
  }, [step]);

  const next = useCallback(() => {
    if (canReveal) {
      reveal();
      return;
    }
    const i = indexRef.current;
    if (i >= steps.length - 1) setFinished(true);
    else go(i + 1);
  }, [canReveal, reveal, steps.length, go]);
  const prev = useCallback(() => {
    if (finished) setFinished(false);
    else go(indexRef.current - 1);
  }, [finished, go]);

  const mark = useCallback(
    (value: Mark) => {
      if (!canMark) return;
      setMarks((prevMarks) => new Map(prevMarks).set(currentKey, value));
      const i = indexRef.current;
      if (i >= steps.length - 1) setFinished(true);
      else go(i + 1);
    },
    [canMark, currentKey, steps.length, go]
  );

  const sibling = useCallback(
    (delta: number) => {
      if (!step || !sheet) return;
      const parentId = step.ancestorIds[step.ancestorIds.length - 1];
      if (!parentId) return;
      const parentIdx = stepByKey.get(keyOf(step.sheetIndex, parentId));
      if (parentIdx === undefined) return;
      const siblings = steps[parentIdx].childIds;
      const j = siblings.indexOf(step.topicId) + delta;
      if (j < 0 || j >= siblings.length) return;
      const target = stepByKey.get(keyOf(step.sheetIndex, siblings[j]));
      if (target !== undefined) go(target);
    },
    [step, sheet, stepByKey, steps, go]
  );

  const sheetPos = step ? path.sheetStarts.findIndex((s) => s.sheetIndex === step.sheetIndex) : -1;
  const jumpSheet = useCallback(
    (delta: number) => {
      const target = path.sheetStarts[sheetPos + delta];
      if (target) go(target.firstStep);
      else if (delta < 0 && sheetPos >= 0) go(path.sheetStarts[sheetPos].firstStep);
    },
    [path.sheetStarts, sheetPos, go]
  );

  const setMode = useCallback((m: ReviewModeKind) => {
    setModeState(m);
    writeMode(m);
  }, []);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onExit(step?.sheetIndex ?? startSheetIndex, step?.topicId);
  }, [onExit, step, startSheetIndex]);

  const restart = useCallback(() => {
    setSeen(new Set());
    setRevealed(new Set());
    setOpened(new Set());
    setNotesShown(new Set());
    setMarks(new Map());
    setFinished(false);
    indexRef.current = 0;
    setIndex(0);
  }, []);

  // Schermo intero: solo dove il browser lo consente (non su iPhone).
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // Tastiera: in cattura, così le scorciatoie dell'editor sotto non scattano.
  const keyRef = useRef({ next, prev, sibling, jumpSheet, exit, reveal, mark, setMode, mode, canReveal, go, railOpen });
  keyRef.current = { next, prev, sibling, jumpSheet, exit, reveal, mark, setMode, mode, canReveal, go, railOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if ((e.target as Element | null)?.closest?.(TEXT_FIELD)) return;
      const k = keyRef.current;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
          if (e.shiftKey) k.jumpSheet(1);
          else k.next();
          break;
        case 'PageDown':
        case 'Enter':
          k.next();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) k.jumpSheet(-1);
          else k.prev();
          break;
        case 'PageUp':
        case 'Backspace':
          k.prev();
          break;
        case 'ArrowDown':
          k.sibling(1);
          break;
        case 'ArrowUp':
          k.sibling(-1);
          break;
        case 'Home':
          k.jumpSheet(0);
          break;
        case ' ':
          if (k.canReveal) k.reveal();
          else k.next();
          break;
        case '1':
          k.mark('ok');
          break;
        case '2':
          k.mark('again');
          break;
        case 'p':
        case 'P':
          k.setMode(k.mode === 'present' ? 'test' : 'present');
          break;
        case 'Escape':
          if (k.railOpen) setRailOpen(false);
          else k.exit();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const total = steps.length;
  const progress = total > 0 ? seen.size / total : 0;
  const nextStep = steps[index + 1];
  const nextIsNewSheet = Boolean(nextStep?.isSheetStart);
  const multiSheet = path.sheetStarts.length > 1;

  if (!step || !sheet || !layout) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Ripasso" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">Questa mappa non ha blocchi da ripassare.</p>
        <Button variant="outline" onClick={() => onExit(startSheetIndex, undefined)}>
          Torna alla mappa
        </Button>
      </div>
    );
  }

  // Il nome del foglio apre le briciole solo se aggiunge qualcosa (spesso coincide con la radice).
  const chain = [...step.ancestorIds.map((id) => titleOf(step.sheetIndex, id)), step.title];
  const sheetLabel = sheet.title || `Foglio ${sheetPos + 1}`;
  const crumbs = [
    ...(multiSheet && sheetLabel !== chain[0] ? [sheetLabel] : []),
    ...step.ancestorIds.map((id) => titleOf(step.sheetIndex, id)),
  ];

  const rail = (
    <ReviewIndex
      path={path}
      sheets={sheets}
      index={index}
      seen={seen}
      marks={marks}
      test={test}
      isRevealed={isRevealed}
      onPick={go}
    />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ripasso"
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground select-none pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      {/* Barra superiore: uscita, dove sei, modo */}
      <header className="flex h-topbar shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3">
        <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={exit} title="Esci dal ripasso (Esc)">
          <span className="hidden sm:inline">Esci</span>
        </Button>
        {compact && (
          <IconButton size="sm" label="Indice" active={railOpen} onClick={() => setRailOpen((o) => !o)}>
            <ListTree className="size-4" />
          </IconButton>
        )}
        <nav aria-label="Posizione" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <span className="max-w-[10rem] shrink truncate text-muted-foreground max-sm:hidden">{c || '·'}</span>
              <span className="text-muted-foreground max-sm:hidden" aria-hidden>
                ›
              </span>
            </React.Fragment>
          ))}
          <span className="min-w-0 truncate font-medium">{step.title || 'Senza titolo'}</span>
        </nav>
        <div role="group" aria-label="Modo" className="flex shrink-0 items-center gap-0.5 rounded-control border bg-background p-0.5">
          {(['present', 'test'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              title={m === 'present' ? 'Presenta: tutto visibile (P)' : 'Mettiti alla prova: scopri i figli dopo averli richiamati (P)'}
              onClick={() => setMode(m)}
              className={cn(
                'h-6 rounded-[6px] px-2 text-xs text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === m && 'bg-card text-foreground shadow-control'
              )}
            >
              {m === 'present' ? 'Presenta' : compact ? 'Prova' : 'Mettiti alla prova'}
            </button>
          ))}
        </div>
        {canFullscreen && !compact && (
          <IconButton size="sm" label={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </IconButton>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1">
        {!compact && <aside className="w-sidebar shrink-0 overflow-y-auto border-r bg-sidebar">{rail}</aside>}

        <div className="relative min-w-0 flex-1">
          <ReviewCanvas
            // Cambio di foglio: tela nuova (dissolvenza e inquadratura immediata).
            key={step.sheetIndex}
            layout={layout}
            boundaries={boundaries}
            currentId={step.topicId}
            lit={focus.lit}
            hidden={hidden}
            frameIds={frameIds}
            darkMode={darkMode}
            resourceResolver={resourceResolver}
            insets={NO_INSETS}
            onPickTopic={(id) => {
              const i = stepIndexOf(path, step.sheetIndex, id);
              if (i === index && canReveal) reveal();
              else if (i >= 0) go(i);
            }}
          />
          {multiSheet && step.isSheetStart && (
            <div className="pointer-events-none absolute left-3 top-3 animate-fade-in rounded-lg border bg-card/90 px-3 py-1.5 text-xs shadow-control">
              <span className="text-muted-foreground">
                Foglio {sheetPos + 1} di {path.sheetStarts.length}
              </span>{' '}
              <span className="font-medium">{sheet.title}</span>
            </div>
          )}
          {finished && (
            <ReviewSummary
              steps={steps}
              seen={seen}
              marks={marks}
              test={test}
              sheetCount={path.sheetStarts.length}
              onPick={go}
              onRestart={restart}
              onExit={exit}
            />
          )}
        </div>

        {compact && railOpen && (
          <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/30 animate-fade-in" onClick={() => setRailOpen(false)}>
            <div
              className="max-h-[70%] overflow-y-auto rounded-t-xl border-t bg-popover pb-[env(safe-area-inset-bottom)] shadow-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              {rail}
            </div>
          </div>
        )}
      </div>

      {/* Note del blocco: sotto la mappa, non sopra, così non coprono i blocchi */}
      {notes !== '' && (
        <section aria-label="Note" className="max-h-32 shrink-0 overflow-y-auto border-t bg-card px-4 py-2 text-sm">
          {notesHidden ? (
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={reveal}>
              Note nascoste · <span className="underline">mostra</span>
            </button>
          ) : (
            <p className="whitespace-pre-wrap select-text">{notes}</p>
          )}
        </section>
      )}

      {/* Barra inferiore: avanti/indietro, scopri, segni, avanzamento */}
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-card px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3">
        <Button variant="outline" size="sm" icon={<ArrowLeft className="size-4" />} onClick={prev} disabled={index === 0 && !finished}>
          <span className="max-sm:hidden">Indietro</span>
        </Button>
        {canReveal ? (
          <Button size="sm" icon={<Eye className="size-4" />} onClick={reveal}>
            Scopri{!compact && <Kbd className="ml-1">Spazio</Kbd>}
          </Button>
        ) : canMark ? (
          <>
            <Button size="sm" variant="outline" icon={<Check className="size-4" />} onClick={() => mark('ok')}>
              Lo sapevo{!compact && <Kbd className="ml-1">1</Kbd>}
            </Button>
            <Button size="sm" variant="outline" icon={<Undo2 className="size-4" />} onClick={() => mark('again')}>
              Da ripassare{!compact && <Kbd className="ml-1">2</Kbd>}
            </Button>
          </>
        ) : finished ? (
          <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={restart}>
            Ricomincia
          </Button>
        ) : (
          <Button size="sm" iconRight={<ArrowRight className="size-4" />} onClick={next}>
            {index >= total - 1
              ? 'Fine'
              : nextIsNewSheet && nextStep
                ? compact
                  ? 'Foglio successivo'
                  : `Foglio successivo: ${sheets.find((s) => s.index === nextStep.sheetIndex)?.title ?? ''}`
                : 'Avanti'}
          </Button>
        )}
        <div className="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span>
            {seen.size} / {total}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-accent" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={seen.size} aria-label="Blocchi visti">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
          {multiSheet && (
            <span className="max-sm:hidden">
              Foglio {sheetPos + 1}/{path.sheetStarts.length}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
};

/** Indice del ripasso: tutti i passi, raggruppati per foglio, con lo stato di ciascuno. */
const ReviewIndex: React.FC<{
  path: ReturnType<typeof buildReviewPath>;
  sheets: readonly SheetDto[];
  index: number;
  seen: ReadonlySet<string>;
  marks: ReadonlyMap<string, Mark>;
  test: boolean;
  isRevealed: (sheetIndex: number, id: string) => boolean;
  onPick: (i: number) => void;
}> = ({ path, index, seen, marks, test, isRevealed, onPick }) => {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const current = path.steps[index];
  const onPath = new Set(current ? current.ancestorIds : []);

  return (
    <div className="flex flex-col gap-3 p-2 text-sm">
      {path.sheetStarts.map((s, si) => (
        <div key={s.sheetIndex} className="flex flex-col">
          {path.sheetStarts.length > 1 && (
            <div className="flex items-baseline gap-2 px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="font-mono">{si + 1}</span>
              <span className="truncate">{s.title || `Foglio ${si + 1}`}</span>
            </div>
          )}
          {path.steps.slice(s.firstStep, s.firstStep + s.stepCount).map((st, j) => {
            const i = s.firstStep + j;
            const key = `${st.sheetIndex}\u0000${st.topicId}`;
            const isCurrent = i === index;
            const mark = marks.get(key);
            const label = test && !isCurrent && !isRevealed(st.sheetIndex, st.topicId) ? '· · ·' : st.title || 'Senza titolo';
            return (
              <button
                key={key}
                ref={isCurrent ? currentRef : undefined}
                type="button"
                onClick={() => onPick(i)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex h-7 w-full shrink-0 items-center gap-2 rounded-control pr-2 text-left text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isCurrent && 'bg-sidebar-row-active font-medium text-foreground shadow-control',
                  !isCurrent && current?.sheetIndex === st.sheetIndex && onPath.has(st.topicId) && 'text-foreground'
                )}
                style={{ paddingLeft: 8 + Math.min(st.depth, 6) * 12 }}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full bg-border',
                    seen.has(key) && 'bg-muted-foreground',
                    mark === 'ok' && 'bg-success',
                    mark === 'again' && 'bg-warning'
                  )}
                />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Fine del ripasso: quanti blocchi, quali da ripassare. */
const ReviewSummary: React.FC<{
  steps: ReviewStep[];
  seen: ReadonlySet<string>;
  marks: ReadonlyMap<string, Mark>;
  test: boolean;
  sheetCount: number;
  onPick: (i: number) => void;
  onRestart: () => void;
  onExit: () => void;
}> = ({ steps, seen, marks, test, sheetCount, onPick, onRestart, onExit }) => {
  const again = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => marks.get(`${s.sheetIndex}\u0000${s.topicId}`) === 'again');
  const ok = [...marks.values()].filter((m) => m === 'ok').length;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-4 animate-fade-in">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border bg-popover p-5 shadow-dialog">
        <div>
          <h2 className="text-base font-semibold">Ripasso completato</h2>
          <p className="text-sm text-muted-foreground">
            {seen.size} blocchi su {steps.length}
            {sheetCount > 1 ? `, ${sheetCount} fogli` : ''}.
            {test && ` Sapevi ${ok}, da ripassare ${again.length}.`}
          </p>
        </div>
        {again.length > 0 && (
          <div className="flex max-h-60 flex-col overflow-y-auto rounded-lg border">
            {again.map(({ s, i }) => (
              <button
                key={i}
                type="button"
                onClick={() => onPick(i)}
                className="flex items-center gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                <span className="truncate">{s.title || 'Senza titolo'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={onRestart}>
            Ricomincia
          </Button>
          <Button onClick={onExit}>Torna alla mappa</Button>
        </div>
      </div>
    </div>
  );
};
