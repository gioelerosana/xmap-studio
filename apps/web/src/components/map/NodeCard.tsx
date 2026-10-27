import { memo, type MouseEvent, type PointerEvent } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@xmap/ui-kit';
import { TITLE_LEADING_RATIO, titleBaseFontPx, trunkX, type LayoutNode } from '@xmap/core';
import type { NodeLook } from './nodeLook.js';
import { RichTitle, textStyleCss } from './RichTitle.js';
import { themeFontStack } from './themeFont.js';

/** Quanto l'alone di selezione sporge dal bordo del blocco: 2,25px dell'anello + metà dei 3px di tratto. */
const SELECTION_HALO_OUT = 3.75;
/** Raggio del pulsante comprimi/espandi (bordo compreso: 7 + 0,5). */
const COLLAPSE_TOGGLE_RADIUS = 7.5;
/** Distanza del centro del pulsante dal bordo destro del blocco: il cerchio tocca l'alone di selezione. */
const COLLAPSE_TOGGLE_OFFSET = SELECTION_HALO_OUT + COLLAPSE_TOGGLE_RADIUS;
/** Raggio degli angoli del blocco per la forma del tema (default: rettangolo arrotondato). */
function cornerRadius(node: LayoutNode): number {
  switch (node.shape) {
    case 'rect':
      return 2;
    case 'ellipse':
      return node.h / 2;
    case 'underline':
      return 4;
    default:
      return node.depth === 0 ? 12 : 10;
  }
}

/** Quanto l'area della maniglia di larghezza sporge dal bordo del blocco col mouse: non oltre il pulsante. */
const HANDLE_REACH_OUT = 4;

export interface NodeCardProps {
  node: LayoutNode;
  look: NodeLook;
  isSelected: boolean;
  /** Blocco con selezione primaria: mostra le maniglie di ridimensionamento. */
  isPrimary: boolean;
  /** Blocco in editing in place: niente maniglie di ridimensionamento. */
  isEditing: boolean;
  /** SVG della formula, se il blocco è un'equazione renderizzata. */
  formulaSvg?: string;
  /** Data URL dell'immagine allegata, se la risorsa è disponibile. */
  imageUrl?: string;
  isCoarse: boolean;
  onSelect: (node: LayoutNode, e: MouseEvent<SVGGElement>) => void;
  onActivate: (node: LayoutNode, e: MouseEvent<SVGGElement>) => void;
  onToggleCollapse: (topicId: string) => void;
  onResetWidth: (topicId: string) => void;
  onStartResize: (e: PointerEvent<SVGElement>, node: LayoutNode, type: 'width' | 'image') => void;
}

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Confronta due oggetti sulla unione delle chiavi (un campo mancante vale come
 * `undefined`), senza allocare: gira per ogni blocco a ogni render della mappa.
 */
function everyKeyEqual(a: Fields, b: Fields, equal: (x: unknown, y: unknown) => boolean): boolean {
  for (const key in a) {
    if (!equal(a[key], b[key])) return false;
  }
  for (const key in b) {
    if (!(key in a) && b[key] !== undefined) return false;
  }
  return true;
}

function strictEqual(a: unknown, b: unknown): boolean {
  return a === b;
}

/** Elemento di un array (es. `labels`, `titleRuns`): oggetti piatti confrontati chiave per chiave. */
function itemEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return isRecord(a) && isRecord(b) && everyKeyEqual(a, b, strictEqual);
}

function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!itemEqual(a[i], b[i])) return false;
  }
  return true;
}

/** Campo di LayoutNode: primitivi per `===`, array ed oggetti piatti strutturalmente. */
function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return sameArray(a, b);
  return isRecord(a) && isRecord(b) && everyKeyEqual(a, b, strictEqual);
}

/** Dopo ogni modifica il layout è nuovo: i blocchi invariati vanno riconosciuti per contenuto. */
function layoutNodeEqual(a: LayoutNode, b: LayoutNode): boolean {
  return a === b || everyKeyEqual(a as unknown as Fields, b as unknown as Fields, fieldEqual);
}

function lookEqual(a: NodeLook, b: NodeLook): boolean {
  return a.fill === b.fill && a.stroke === b.stroke && a.text === b.text && a.textLight === b.textLight && a.solid === b.solid;
}

function nodeCardPropsEqual(prev: NodeCardProps, next: NodeCardProps): boolean {
  return (
    prev.onSelect === next.onSelect &&
    prev.onActivate === next.onActivate &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.onResetWidth === next.onResetWidth &&
    prev.onStartResize === next.onStartResize &&
    prev.isSelected === next.isSelected &&
    prev.isPrimary === next.isPrimary &&
    prev.isEditing === next.isEditing &&
    prev.formulaSvg === next.formulaSvg &&
    prev.imageUrl === next.imageUrl &&
    prev.isCoarse === next.isCoarse &&
    lookEqual(prev.look, next.look) &&
    layoutNodeEqual(prev.node, next.node)
  );
}

/** Singolo blocco della mappa: card, contenuto (testo, formula o immagine), indicatori e maniglie. */
function NodeCardView({
  node,
  look,
  isSelected,
  isPrimary,
  isEditing,
  formulaSvg,
  imageUrl,
  isCoarse,
  onSelect,
  onActivate,
  onToggleCollapse,
  onResetWidth,
  onStartResize,
}: NodeCardProps) {
  const isRoot = node.depth === 0;
  const isBranch = node.depth === 1;
  const hasChildren = node.childCount > 0;
  const hasImage = imageUrl !== undefined;
  const isEquation = node.kind === 'equation' || Boolean(node.latex) || Boolean(formulaSvg);
  const isPlainImage = Boolean(hasImage && !isEquation);
  const rx = cornerRadius(node);
  const isUnderline = node.shape === 'underline';
  // Dimensione base del titolo, la stessa che usa la stima del layout (layout.ts).
  const titleFontPx = titleBaseFontPx(node.depth, node.textStyle);
  // Su riempimento pieno i chip si tingono del colore del testo.
  const chipSolidStyle = look.solid
    ? { backgroundColor: 'color-mix(in oklab, currentColor 18%, transparent)' }
    : undefined;

  return (
    <g
      data-node-id={node.id}
      transform={`translate(${node.x}, ${node.y})`}
      className="cursor-pointer group"
      onClick={(e) => onSelect(node, e)}
      onDoubleClick={(e) => onActivate(node, e)}
    >
      {/* Alone di selezione: anello esterno adiacente al bordo (3px, 24%) */}
      {isSelected && (
        <rect
          data-print-hide
          x={-2.25}
          y={-2.25}
          width={node.w + 4.5}
          height={node.h + 4.5}
          rx={rx + 2.25}
          fill="none"
          stroke="color-mix(in oklab, var(--primary) 24%, transparent)"
          strokeWidth={3}
        />
      )}

      {/* Rettangolo base della card del nodo */}
      <rect
        data-node-rect
        data-default-stroke={look.stroke}
        className="transition-[filter] duration-150 group-hover:brightness-110"
        width={node.w}
        height={node.h}
        rx={rx}
        fill={look.fill}
        stroke={isSelected ? 'var(--primary)' : isUnderline ? 'none' : look.stroke}
        strokeWidth={isSelected ? 1.5 : 1}
        style={{ filter: look.solid ? 'drop-shadow(0 1px 3px rgba(0,0,0,0.18))' : undefined }}
      />
      {isUnderline && (
        <path
          d={`M 0 ${node.h} L ${node.w} ${node.h}`}
          stroke={look.stroke}
          strokeWidth={node.depth <= 1 ? 3 : 2}
          strokeLinecap="round"
        />
      )}

      {/* Immagine allegata se presente */}
      {hasImage && !formulaSvg && (
        <image
          href={imageUrl}
          x={8}
          y={4}
          width={Math.max(node.w - 16, 20)}
          height={Math.max(node.h - 8, 20)}
          preserveAspectRatio="xMidYMid meet"
          className={node.kind === 'equation' && look.textLight ? 'invert' : undefined}
        />
      )}

      {/* Contenuto del nodo: formula SVG (ha la precedenza sul PNG allegato) o testo */}
      {(!hasImage || formulaSvg) && (
        <foreignObject
          x={isRoot ? 12 : 10}
          y={4}
          width={Math.max(node.w - (isRoot ? 24 : 18), 10)}
          height={Math.max(node.h - 8, 10)}
        >
          <div
            className="w-full h-full flex flex-col justify-center select-none overflow-hidden"
            style={{ color: look.text }}
          >
            <div className="flex items-center gap-1.5 overflow-hidden">
              {formulaSvg ? (
                <div
                  className="flex items-center max-w-full overflow-hidden shrink-0"
                  dangerouslySetInnerHTML={{ __html: formulaSvg }}
                />
              ) : (
                <span
                  className={cn(
                    'break-words whitespace-pre-wrap',
                    isRoot ? 'font-semibold tracking-tight' : isBranch ? 'font-semibold' : 'font-normal'
                  )}
                  style={{
                    ...textStyleCss(node.textStyle, look.textLight),
                    // Dimensione sempre esplicita e dopo lo stile del blocco (che la lascerebbe `undefined`):
                    // è quella della stima del layout, così il testo riempie il blocco misurato per lui.
                    fontSize: `${titleFontPx}px`,
                    fontFamily: node.fontFamily ? themeFontStack(node.fontFamily, 'var(--font-sans)') : undefined,
                    // Interlinea uguale a quella della stima del layout, o i font grandi verrebbero tagliati.
                    lineHeight: TITLE_LEADING_RATIO,
                    display: '-webkit-box',
                    // Il blocco è alto almeno quanto le righe stimate (ciascuna ≥ fontPx * leading): il clamp non taglia mai un titolo stimato bene
                    WebkitLineClamp: Math.max(
                      Math.floor((node.h - 8) / (titleFontPx * TITLE_LEADING_RATIO)),
                      1
                    ),
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={node.displayTitle || node.title}
                >
                  <RichTitle
                    text={node.displayTitle || node.title || '(senza titolo)'}
                    runs={node.titleRuns}
                    textLight={look.textLight}
                    fontSizePx={titleFontPx}
                  />
                </span>
              )}

              {node.hasNotes && (
                <FileText
                  className={cn(
                    'size-3.5 shrink-0 self-center',
                    look.solid ? 'opacity-70' : 'text-muted-foreground'
                  )}
                />
              )}
            </div>

            {/* Riga inferiore: etichette e marker */}
            {(node.labels.length > 0 || node.markers.length > 0) && (
              <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                {node.markers.map((m) => {
                  const isPriority = m.startsWith('priority-');
                  const pNum = isPriority ? m.replace('priority-', '') : null;
                  return (
                    <span
                      key={m}
                      className={cn(
                        'inline-flex h-3.5 shrink-0 items-center justify-center rounded-sm px-1 text-3xs font-medium leading-none',
                        !look.solid && 'bg-muted text-muted-foreground'
                      )}
                      style={chipSolidStyle}
                      title={m}
                    >
                      {pNum ? `P${pNum}` : m.slice(0, 4)}
                    </span>
                  );
                })}
                {node.labels.map((lbl) => (
                  <span
                    key={lbl}
                    className={cn(
                      'block h-3.5 max-w-[60px] truncate rounded-sm border px-1 text-3xs font-medium leading-[12px]',
                      !look.solid && 'text-muted-foreground'
                    )}
                    style={look.solid ? { borderColor: 'color-mix(in oklab, currentColor 32%, transparent)' } : undefined}
                  >
                    {lbl}
                  </span>
                ))}
              </div>
            )}
          </div>
        </foreignObject>
      )}

      {/* Maniglia di ridimensionamento larghezza blocco: pillola centrata sul bordo destro (solo blocchi testo) */}
      {isPrimary && !isPlainImage && !isEquation && !isEditing && (
        <g
          data-print-hide
          data-map-ui
          data-resize-handle="width"
          className="select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => onStartResize(e, node, 'width')}
          onDoubleClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onResetWidth(node.id);
          }}
        >
          {/* Area di tocco invisibile allargata per touch e mouse agevole; col mouse sporge poco
              fuori dal blocco (HANDLE_REACH_OUT), per lasciare spazio al pulsante comprimi/espandi */}
          <rect
            x={node.w - (isCoarse ? 12 : 8)}
            y={Math.max(0, node.h / 2 - (isCoarse ? 20 : 16))}
            width={isCoarse ? 24 : 8 + HANDLE_REACH_OUT}
            height={isCoarse ? 40 : 32}
            fill="transparent"
            style={{ cursor: 'ew-resize' }}
          />
          {/* Barra/pillola visiva */}
          <rect
            x={node.w - 2}
            y={node.h / 2 - 10}
            width={4}
            height={20}
            rx={2}
            fill="var(--primary)"
            stroke="var(--background)"
            strokeWidth={1}
            style={{ cursor: 'ew-resize', pointerEvents: 'none' }}
          />
        </g>
      )}

      {/* Indicatore comprimi / espandi: sul connettore, appena fuori dall'area della maniglia di larghezza
          (col mouse il cerchio tocca l'alone blu della selezione), o sotto il blocco per la Tree Chart.
          Disegnato dopo la maniglia: il suo cerchio resta cliccabile. */}
      {hasChildren && (
        <g
          data-collapse-toggle
          transform={
            node.childrenBelow
              ? `translate(${trunkX(node) - node.x}, ${node.h + 8})`
              : `translate(${node.w + (isCoarse ? 20 : COLLAPSE_TOGGLE_OFFSET)}, ${node.h / 2})`
          }
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(node.id);
          }}
        >
          {/* Area di tocco invisibile più ampia per il touch */}
          {isCoarse && <circle r={12} fill="transparent" />}
          <circle r={7} fill="var(--popover)" stroke={node.accent || 'var(--input)'} strokeWidth={1} />
          {node.collapsed ? (
            <path
              d={node.childrenBelow ? 'M -3 -2 L 0 2 L 3 -2' : 'M -2 -3 L 2 0 L -2 3'}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path d="M -3 0 L 3 0" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          )}
        </g>
      )}

      {/* Maniglia d'angolo per ridimensionamento immagine (in basso a destra, mantiene proporzioni) */}
      {isPrimary && isPlainImage && !isEquation && !isEditing && (
        <g
          data-print-hide
          data-map-ui
          data-resize-handle="image"
          className="select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => onStartResize(e, node, 'image')}
        >
          {/* Area di tocco invisibile allargata per touch */}
          <circle
            cx={node.w}
            cy={node.h}
            r={isCoarse ? 18 : 12}
            fill="transparent"
            style={{ cursor: 'nwse-resize' }}
          />
          {/* Maniglia d'angolo visiva */}
          <circle
            cx={node.w}
            cy={node.h}
            r={isCoarse ? 8 : 5.5}
            fill="var(--background)"
            stroke="var(--primary)"
            strokeWidth={2}
            style={{ cursor: 'nwse-resize', pointerEvents: 'none' }}
          />
        </g>
      )}

    </g>
  );
}

export const NodeCard = memo(NodeCardView, nodeCardPropsEqual);
