import type { LayoutNode } from '@xmap/core';
import type { MenuItem } from '@xmap/ui-kit';
import {
  Braces,
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerDownLeft,
  Edit3,
  Eraser,
  Info,
  ListTree,
  Maximize2,
  Network,
  Scissors,
  Sigma,
  Trash2,
} from 'lucide-react';
import type { MapHandlers } from './types.js';

/** Dipendenze dei menu: i callback sono letti da `handlers` al clic, così i menu restano aggiornati. */
export interface MenuContext {
  handlers: { readonly current: MapHandlers };
  canPaste: boolean;
  canAddSummary: boolean;
}

/** Voci del menu contestuale di un blocco. */
export function nodeMenuItems(node: LayoutNode, { handlers, canPaste, canAddSummary }: MenuContext): MenuItem[] {
  const isRoot = node.depth === 0;
  const isText = node.kind === 'text';

  const items: MenuItem[] = [
    {
      id: 'add-child',
      label: 'Aggiungi sotto-blocco',
      shortcut: 'Tab',
      icon: <CornerDownLeft className="size-4" />,
      onSelect: () => handlers.current.onAddChild?.(node.id),
    },
    {
      id: 'add-sibling',
      label: 'Aggiungi blocco fratello',
      shortcut: 'Invio',
      icon: <ListTree className="size-4" />,
      disabled: isRoot,
      onSelect: () => handlers.current.onAddSibling?.(node.id, 'after'),
    },
    {
      id: 'add-sibling-before',
      label: 'Aggiungi fratello prima',
      shortcut: 'Maiusc+Invio',
      icon: <ListTree className="size-4" />,
      disabled: isRoot,
      onSelect: () => handlers.current.onAddSibling?.(node.id, 'before'),
    },
    {
      id: 'edit-text',
      label: 'Modifica testo',
      shortcut: 'F2',
      separatorBefore: true,
      icon: <Edit3 className="size-4" />,
      onSelect: () => {
        if (isText && handlers.current.onStartEdit) {
          handlers.current.onStartEdit(node.id);
        } else {
          handlers.current.onOpenDetails(node.id);
        }
      },
    },
    {
      id: 'details',
      label: 'Dettagli',
      shortcut: 'Ctrl+I',
      icon: <Info className="size-4" />,
      onSelect: () => handlers.current.onOpenDetails(node.id),
    },
    ...(handlers.current.onOpenLatex
      ? [
          {
            id: 'latex',
            label: 'Formula LaTeX',
            shortcut: 'Ctrl+Maiusc+L',
            icon: <Sigma className="size-4" />,
            onSelect: () => handlers.current.onOpenLatex?.(node.id),
          },
        ]
      : []),
    {
      id: 'connect-arrow',
      label: 'Collega con freccia…',
      separatorBefore: true,
      icon: <Network className="size-4" />,
      onSelect: () => handlers.current.onStartConnectRelationship?.(node.id),
    },
    {
      id: 'copy',
      label: 'Copia',
      shortcut: 'Ctrl+C',
      icon: <Copy className="size-4" />,
      onSelect: () => handlers.current.onCopyTopic?.(node.id),
    },
    {
      id: 'cut',
      label: 'Taglia',
      shortcut: 'Ctrl+X',
      icon: <Scissors className="size-4" />,
      disabled: isRoot,
      onSelect: () => handlers.current.onCutTopic?.(node.id),
    },
    {
      id: 'paste',
      label: 'Incolla',
      shortcut: 'Ctrl+V',
      icon: <ClipboardPaste className="size-4" />,
      disabled: !canPaste,
      onSelect: () => handlers.current.onPasteTopic?.(node.id),
    },
    {
      id: 'duplicate',
      label: 'Duplica',
      shortcut: 'Ctrl+D',
      icon: <CopyPlus className="size-4" />,
      disabled: isRoot,
      onSelect: () => handlers.current.onDuplicateTopic?.(node.id),
    },
    {
      id: 'summary',
      label: 'Sommario',
      shortcut: 'Ctrl+]',
      separatorBefore: true,
      icon: <Braces className="size-4" />,
      disabled: !canAddSummary,
      onSelect: () => handlers.current.onAddSummary?.(),
    },
    {
      id: 'remove-keep-children',
      label: 'Rimuovi solo questo blocco',
      separatorBefore: true,
      icon: <Eraser className="size-4" />,
      disabled: isRoot,
      onSelect: () => handlers.current.onRemoveTopicKeepChildren?.(node.id),
    },
    {
      id: 'delete',
      label: 'Elimina',
      shortcut: 'Canc',
      icon: <Trash2 className="size-4" />,
      danger: true,
      disabled: isRoot,
      onSelect: () => handlers.current.onDeleteTopic?.(node.id),
    },
  ];

  return items;
}

/** Voci del menu contestuale dello sfondo; `onFit` adatta la mappa alla finestra. */
export function backgroundMenuItems({ handlers, canPaste }: MenuContext, onFit: () => void): MenuItem[] {
  return [
    {
      id: 'bg-paste',
      label: 'Incolla',
      shortcut: 'Ctrl+V',
      icon: <ClipboardPaste className="size-4" />,
      disabled: !canPaste,
      onSelect: () => handlers.current.onPasteTopic?.(),
    },
    {
      id: 'bg-fit',
      label: 'Adatta alla finestra',
      icon: <Maximize2 className="size-4" />,
      onSelect: () => onFit(),
    },
  ];
}
