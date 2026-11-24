/**
 * Strumenti con cui un agente esterno (Claude, via MCP) legge e modifica la mappa
 * aperta nell'app. Ogni modifica passa dal `AppController`, come quelle fatte a
 * mano: stessa cronologia (si annulla con Ctrl+Z), stesse regole del formato,
 * nessuna scrittura su disco. Il salvataggio (`save_map`) e l'elenco delle mappe
 * (`list_maps`) li esegue chi ospita gli strumenti, non questo modulo.
 */
import type { AppController } from '../controller.js';
import { CODE_INVALID_INPUT, XmapError } from '../errors.js';
import { GROUPS } from '../markers/catalog.js';
import type { MovePlacement } from '../model/edit.js';
import type { SheetDto, TopicPatch, TopicTreeSpec, TopicView, WorkbookDto } from '../state/types.js';

/** Schema JSON (sottoinsieme usato dalle definizioni degli strumenti). */
export type JsonSchema = Record<string, unknown>;

/** Dove si esegue uno strumento: nel processo che ospita le finestre, nella finestra (salvataggio) o sulla mappa. */
export type AgentToolScope = 'host' | 'app' | 'map';

export interface AgentToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  scope: AgentToolScope;
  /** Non modifica la mappa. */
  readOnly: boolean;
  /** Può togliere contenuto (resta comunque annullabile). */
  destructive?: boolean;
}

/** Stato della UI che gli strumenti leggono: foglio mostrato e selezione dell'utente. */
export interface AgentContext {
  /** Indice (da 0) del foglio mostrato. */
  activeSheetIndex: number;
  selectedTopicIds: string[];
}

export interface AgentToolResult {
  text: string;
  /** La mappa è cambiata: la UI deve aggiornarsi. */
  changed: boolean;
  /** Blocco da selezionare e mostrare all'utente dopo la chiamata. */
  focusTopicId?: string;
}

/** Parametro comune: la mappa su cui lavorare, come la elenca `list_maps`. */
const MAP_PARAM: JsonSchema = {
  type: 'integer',
  description: 'Mappa su cui lavorare (numero da list_maps). Se manca: la finestra in primo piano.',
};

const TOPIC_ID: JsonSchema = { type: 'string', description: 'Id del blocco, come in read_map (tra parentesi quadre).' };

const TOPIC_TREE_NODE: JsonSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        'Titolo del blocco. Formule dentro il testo con $...$ (in linea) o $$...$$ (a blocco). Può essere vuoto se c\'è latex.',
    },
    latex: {
      type: 'string',
      description: 'Rende il blocco una formula MathJax (sorgente LaTeX senza delimitatori $), come set_equation.',
    },
    notes: { type: 'string', description: 'Note in testo semplice.' },
    labels: { type: 'array', items: { type: 'string' } },
    markers: { type: 'array', items: { type: 'string' }, description: 'Id dei marker (vedi list_markers).' },
    children: { type: 'array', items: { $ref: '#/$defs/topic' } },
  },
  required: ['title'],
  additionalProperties: false,
};

function schema(properties: Record<string, JsonSchema>, required: string[] = [], withMap = true): JsonSchema {
  return {
    type: 'object',
    properties: withMap ? { map: MAP_PARAM, ...properties } : properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    name: 'list_maps',
    title: 'Mappe aperte',
    description:
      'Elenca le mappe aperte in XMap Studio (una per finestra), con file, modifiche non salvate e finestra in primo piano.',
    inputSchema: schema({}, [], false),
    scope: 'host',
    readOnly: true,
  },
  {
    name: 'read_map',
    title: 'Leggi la mappa',
    description:
      'Struttura della mappa come elenco indentato: [id] titolo, note (abbreviate), etichette, marker, formule e link. ' +
      'Indica anche il foglio mostrato e i blocchi selezionati dall\'utente: "questo blocco" di solito è la selezione. ' +
      'Usalo prima di modificare, per conoscere gli id.',
    inputSchema: schema({
      sheet: { type: 'integer', minimum: 1, description: 'Numero del foglio (da 1). Se manca: il foglio mostrato.' },
      topicId: { type: 'string', description: 'Mostra solo il ramo di questo blocco.' },
      depth: { type: 'integer', minimum: 0, description: 'Livelli da mostrare sotto il punto di partenza (0 = solo quello).' },
    }),
    scope: 'map',
    readOnly: true,
  },
  {
    name: 'get_topic',
    title: 'Dettagli di un blocco',
    description: 'Tutto il contenuto di un blocco: titolo, note complete, etichette, marker, link, formula, percorso e figli.',
    inputSchema: schema({ topicId: TOPIC_ID }, ['topicId']),
    scope: 'map',
    readOnly: true,
  },
  {
    name: 'find_topics',
    title: 'Cerca blocchi',
    description: 'Cerca un testo (senza distinguere maiuscole) in titoli, note, etichette e formule di tutti i fogli.',
    inputSchema: schema({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, ['query']),
    scope: 'map',
    readOnly: true,
  },
  {
    name: 'list_markers',
    title: 'Marker disponibili',
    description: 'Elenca gli id dei marker utilizzabili in add_topics e update_topic, per gruppo.',
    inputSchema: schema({}, [], false),
    scope: 'map',
    readOnly: true,
  },
  {
    name: 'add_topics',
    title: 'Aggiungi blocchi',
    description:
      'Aggiunge come figli di parentId uno o più blocchi, anche con i loro sottoalberi, in un solo passo annullabile. ' +
      'Le formule (latex) si applicano subito dopo, in un secondo passo.',
    inputSchema: {
      ...schema(
        {
          parentId: { type: 'string', description: 'Id del blocco genitore.' },
          topics: { type: 'array', minItems: 1, items: { $ref: '#/$defs/topic' } },
        },
        ['parentId', 'topics']
      ),
      $defs: { topic: TOPIC_TREE_NODE },
    },
    scope: 'map',
    readOnly: false,
  },
  {
    name: 'update_topic',
    title: 'Modifica un blocco',
    description:
      'Modifica titolo, note, etichette, link, colore e marker di un blocco in un solo passo annullabile. ' +
      'I campi non indicati restano com\'erano. Per le formule usa set_equation.',
    inputSchema: schema(
      {
        topicId: TOPIC_ID,
        title: { type: 'string', description: 'Nuovo titolo; formule in linea con $...$.' },
        notes: { type: ['string', 'null'], description: 'Note in testo semplice; "" o null le tolgono.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Sostituisce le etichette; [] le toglie.' },
        href: { type: ['string', 'null'], description: 'URL, oppure "#<id>" per un blocco della mappa; "" o null tolgono il link.' },
        color: { type: ['string', 'null'], description: 'Riempimento "#RRGGBB"; "" o null lo tolgono.' },
        addMarkers: { type: 'array', items: { type: 'string' } },
        removeMarkers: { type: 'array', items: { type: 'string' } },
      },
      ['topicId']
    ),
    scope: 'map',
    readOnly: false,
  },
  {
    name: 'set_equation',
    title: 'Formula di un blocco',
    description:
      'Rende il blocco una formula MathJax nativa (si apre e si modifica anche in XMind). latex è il sorgente senza delimitatori $. ' +
      'Con latex vuoto il blocco torna testo. Per una formula dentro una frase usa invece $...$ nel titolo.',
    inputSchema: schema({ topicId: TOPIC_ID, latex: { type: 'string' } }, ['topicId', 'latex']),
    scope: 'map',
    readOnly: false,
  },
  {
    name: 'move_topic',
    title: 'Sposta un blocco',
    description: 'Sposta un blocco (con il suo ramo) prima o dopo targetId, oppure dentro targetId come ultimo figlio.',
    inputSchema: schema(
      {
        topicId: TOPIC_ID,
        targetId: { type: 'string' },
        placement: { type: 'string', enum: ['before', 'after', 'into'] },
      },
      ['topicId', 'targetId', 'placement']
    ),
    scope: 'map',
    readOnly: false,
  },
  {
    name: 'delete_topic',
    title: 'Elimina un blocco',
    description:
      'Elimina un blocco con tutto il suo ramo; con keepChildren elimina solo il blocco e ricollega i figli al genitore. ' +
      'La radice non si elimina. Si annulla con Ctrl+Z.',
    inputSchema: schema({ topicId: TOPIC_ID, keepChildren: { type: 'boolean' } }, ['topicId']),
    scope: 'map',
    readOnly: false,
    destructive: true,
  },
  {
    name: 'add_relationship',
    title: 'Collega due blocchi',
    description: 'Aggiunge una relazione (freccia) tra due blocchi dello stesso foglio.',
    inputSchema: schema({ fromId: { type: 'string' }, toId: { type: 'string' }, title: { type: 'string' } }, ['fromId', 'toId']),
    scope: 'map',
    readOnly: false,
  },
  {
    name: 'select_topic',
    title: 'Mostra un blocco',
    description: 'Seleziona un blocco nell\'app e passa al suo foglio, per mostrarlo all\'utente. Non modifica la mappa.',
    inputSchema: schema({ topicId: TOPIC_ID }, ['topicId']),
    scope: 'map',
    readOnly: true,
  },
  {
    name: 'save_map',
    title: 'Salva la mappa',
    description:
      'Salva la mappa nel suo file, con validazione e backup come il comando Salva. Rifiuta se XMind è aperto o se la mappa non ha ancora un file. ' +
      'Salva solo se l\'utente lo chiede.',
    inputSchema: schema({}),
    scope: 'app',
    readOnly: false,
  },
];

const NOTE_PREVIEW = 120;
const DEFAULT_FIND_LIMIT = 30;

/** Esegue uno strumento di tipo `map` sulla mappa aperta nel controller. */
export async function runAgentTool(
  controller: AppController,
  name: string,
  rawArgs: unknown,
  ctx: AgentContext
): Promise<AgentToolResult> {
  const args = asRecord(rawArgs);
  const def = AGENT_TOOLS.find((tool) => tool.name === name);
  if (!def || def.scope !== 'map') throw new XmapError(CODE_INVALID_INPUT, `Strumento sconosciuto: ${name}`);
  if (name === 'list_markers') return { text: markersText(), changed: false };

  const wb = controller.workbook();
  if (!wb) throw new XmapError(CODE_INVALID_INPUT, 'Nessuna mappa aperta in questa finestra.');

  switch (name) {
    case 'read_map':
      return { text: readMapText(wb, ctx, args), changed: false };
    case 'get_topic':
      return { text: topicDetailsText(wb, requireTopicView(wb, str(args, 'topicId'))), changed: false };
    case 'find_topics':
      return { text: findTopicsText(wb, str(args, 'query'), optInt(args, 'limit') ?? DEFAULT_FIND_LIMIT), changed: false };
    case 'select_topic': {
      const topic = requireTopicView(wb, str(args, 'topicId'));
      return { text: `Selezionato [${topic.id}] ${label(topic)}.`, changed: false, focusTopicId: topic.id };
    }
    case 'add_topics':
      return addTopics(controller, wb, args);
    case 'update_topic': {
      const topicId = str(args, 'topicId');
      requireTopicView(wb, topicId);
      const patch = topicPatch(args);
      if (Object.keys(patch).length === 0) throw invalid('Nessuna modifica indicata.');
      const after = controller.updateTopic(topicId, patch);
      return { text: `Aggiornato: ${label(requireTopicView(after, topicId))}.`, changed: true, focusTopicId: topicId };
    }
    case 'set_equation': {
      const topicId = str(args, 'topicId');
      requireTopicView(wb, topicId);
      const latex = str(args, 'latex', true).trim();
      if (latex === '') {
        controller.removeEquation(topicId);
        return { text: 'Formula tolta: il blocco è tornato testo.', changed: true, focusTopicId: topicId };
      }
      await controller.apply(topicId, latex);
      return { text: `Formula applicata a [${topicId}].`, changed: true, focusTopicId: topicId };
    }
    case 'move_topic': {
      const topicId = str(args, 'topicId');
      const placement = str(args, 'placement');
      if (placement !== 'before' && placement !== 'after' && placement !== 'into') {
        throw invalid('placement deve essere "before", "after" o "into".');
      }
      controller.moveTopic(topicId, str(args, 'targetId'), placement satisfies MovePlacement);
      return { text: 'Blocco spostato.', changed: true, focusTopicId: topicId };
    }
    case 'delete_topic': {
      const topic = requireTopicView(wb, str(args, 'topicId'));
      if (optBool(args, 'keepChildren')) {
        const { childIds } = controller.removeTopicKeepChildren(topic.id);
        return { text: `Eliminato ${label(topic)}; ${childIds.length} figli ricollegati.`, changed: true, focusTopicId: topic.parentId };
      }
      controller.removeTopic(topic.id);
      const removed = countDescendants(wb, topic) + 1;
      return { text: `Eliminati ${removed} blocchi (${label(topic)} e il suo ramo).`, changed: true, focusTopicId: topic.parentId };
    }
    case 'add_relationship': {
      const title = optStr(args, 'title');
      controller.addTopicRelationship(str(args, 'fromId'), str(args, 'toId'), title);
      return { text: 'Relazione aggiunta.', changed: true };
    }
    default:
      throw new XmapError(CODE_INVALID_INPUT, `Strumento sconosciuto: ${name}`);
  }
}

async function addTopics(controller: AppController, wb: WorkbookDto, args: Record<string, unknown>): Promise<AgentToolResult> {
  const parentId = str(args, 'parentId');
  requireTopicView(wb, parentId);
  const rawTopics = args.topics;
  if (!Array.isArray(rawTopics) || rawTopics.length === 0) throw invalid('topics deve essere un elenco non vuoto.');
  const latexByIndex: string[] = [];
  const specs = rawTopics.map((node) => treeSpec(node, latexByIndex));

  const { ids } = controller.addTopicTree(parentId, specs);
  const equations = ids.flatMap((topicId, index) => {
    const latex = latexByIndex[index]?.trim();
    return latex ? [{ topicId, latex }] : [];
  });
  let note = '';
  if (equations.length > 0) {
    const result = await controller.applyBatch(equations);
    note =
      result.errors.length > 0
        ? ` Formule non applicate: ${result.errors.map((e) => `[${e.topicId}] ${e.error}`).join('; ')}`
        : ` Formule applicate: ${equations.length}.`;
  }
  const after = controller.workbook() ?? wb;
  const lines = ids.map((id) => {
    const view = findTopicView(after, id);
    return view ? `${'  '.repeat(Math.max(0, view.depth - depthOf(after, parentId) - 1))}- [${id}] ${label(view)}` : `- [${id}]`;
  });
  return {
    text: `Aggiunti ${ids.length} blocchi sotto [${parentId}]:${note}\n${lines.join('\n')}`,
    changed: true,
    focusTopicId: ids[0],
  };
}

/** Converte un nodo ricevuto in `TopicTreeSpec`; la formula si raccoglie a parte, nell'ordine di visita di `addTopicTree`. */
function treeSpec(raw: unknown, latexByIndex: string[]): TopicTreeSpec {
  const node = asRecord(raw);
  const latex = optStr(node, 'latex');
  const title = optStr(node, 'title') ?? '';
  if (title === '' && !latex) throw invalid('Ogni blocco deve avere un titolo o una formula (latex).');
  latexByIndex.push(latex ?? '');
  const spec: TopicTreeSpec = { title };
  const notes = optStr(node, 'notes');
  if (notes !== undefined) spec.notes = notes;
  const labels = optStrings(node, 'labels');
  if (labels) spec.labels = labels;
  const markers = optStrings(node, 'markers');
  if (markers) spec.markers = markers;
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) throw invalid('children deve essere un elenco.');
    spec.children = node.children.map((child) => treeSpec(child, latexByIndex));
  }
  return spec;
}

function topicPatch(args: Record<string, unknown>): TopicPatch {
  const patch: TopicPatch = {};
  const title = optStr(args, 'title');
  if (title !== undefined) patch.title = title;
  if ('notes' in args) patch.notes = nullableStr(args, 'notes');
  const labels = optStrings(args, 'labels');
  if (labels) patch.labels = labels;
  if ('href' in args) patch.href = nullableStr(args, 'href');
  if ('color' in args) {
    const color = nullableStr(args, 'color');
    if (color && !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)) throw invalid('color deve essere "#RRGGBB".');
    patch.color = color;
  }
  const addMarkers = optStrings(args, 'addMarkers');
  if (addMarkers) patch.addMarkers = addMarkers;
  const removeMarkers = optStrings(args, 'removeMarkers');
  if (removeMarkers) patch.removeMarkers = removeMarkers;
  return patch;
}

// ---------------------------------------------------------------- testo per l'agente

function readMapText(wb: WorkbookDto, ctx: AgentContext, args: Record<string, unknown>): string {
  const sheetArg = optInt(args, 'sheet');
  const topicId = optStr(args, 'topicId');
  const depth = optInt(args, 'depth');

  let sheet: SheetDto | undefined;
  let start: TopicView | undefined;
  if (topicId) {
    start = requireTopicView(wb, topicId);
    sheet = wb.sheets[start.sheetIndex];
  } else {
    const index = sheetArg !== undefined ? sheetArg - 1 : ctx.activeSheetIndex;
    sheet = wb.sheets[index];
    if (!sheet) throw invalid(`Foglio ${index + 1} inesistente: la mappa ha ${wb.sheets.length} fogli.`);
  }
  if (!sheet) throw invalid('Foglio non trovato.');

  const header = [
    `Mappa: ${wb.fileName}${wb.path ? ` (${wb.path})` : ' (mai salvata su file)'}${wb.dirty ? ' — modifiche non salvate' : ''}`,
    `Fogli: ${wb.sheets.map((s) => `${s.index + 1}. ${s.title}${s.index === ctx.activeSheetIndex ? ' (mostrato)' : ''}`).join(' · ')}`,
    `Selezione dell'utente: ${selectionText(wb, ctx)}`,
    '',
    `Foglio ${sheet.index + 1} «${sheet.title}»${start ? `, ramo di [${start.id}]` : ''}:`,
  ];

  const lines: string[] = [];
  const base = start ? start.depth : 0;
  const children = childrenIndex(sheet);
  const visit = (topic: TopicView) => {
    const level = topic.depth - base;
    lines.push(`${'  '.repeat(level)}- ${topicLine(topic)}`);
    const kids = children.get(topic.id) ?? [];
    if (depth !== undefined && level >= depth) {
      if (kids.length > 0) lines.push(`${'  '.repeat(level + 1)}… ${kids.length} figli non mostrati`);
      return;
    }
    kids.forEach(visit);
  };
  const roots = start ? [start] : sheet.topics.filter((t) => t.parentId === undefined);
  roots.forEach(visit);

  const relationships = sheet.relationships.map(
    (r) => `- [${r.id}] [${r.end1Id}] → [${r.end2Id}]${r.title ? ` «${r.title}»` : ''}`
  );
  return [...header, ...lines, ...(relationships.length > 0 ? ['', 'Relazioni:', ...relationships] : [])].join('\n');
}

function selectionText(wb: WorkbookDto, ctx: AgentContext): string {
  const selected = ctx.selectedTopicIds.flatMap((id) => {
    const view = findTopicView(wb, id);
    return view ? [`[${id}] ${label(view)}`] : [];
  });
  return selected.length > 0 ? selected.join(', ') : 'nessuna';
}

function topicLine(topic: TopicView): string {
  const parts = [`[${topic.id}] ${label(topic)}`];
  if (topic.group !== 'attached' && topic.group !== 'root') parts.push(`(${groupName(topic.group)})`);
  if (topic.notes) parts.push(`· note: «${preview(topic.notes)}»`);
  if (topic.labels.length > 0) parts.push(`· etichette: ${topic.labels.join(', ')}`);
  if (topic.markers.length > 0) parts.push(`· marker: ${topic.markers.join(', ')}`);
  if (topic.href) parts.push(`· link: ${topic.href}`);
  if (topic.folded) parts.push('· ramo chiuso');
  return parts.join(' ');
}

function topicDetailsText(wb: WorkbookDto, topic: TopicView): string {
  const sheet = wb.sheets[topic.sheetIndex];
  const path = ancestors(wb, topic).map((t) => label(t));
  const kids = sheet ? sheet.topics.filter((t) => t.parentId === topic.id) : [];
  const lines = [
    `[${topic.id}] ${label(topic)}`,
    `Foglio: ${topic.sheetIndex + 1}${sheet ? ` «${sheet.title}»` : ''}`,
    `Percorso: ${path.length > 0 ? path.join(' › ') : '(radice)'}`,
    `Tipo: ${topic.kind === 'equation' ? 'formula' : topic.kind === 'image' ? 'immagine' : 'testo'}${topic.group !== 'attached' && topic.group !== 'root' ? ` (${groupName(topic.group)})` : ''}`,
  ];
  if (topic.kind === 'equation' && topic.latex !== undefined) {
    lines.push(`Formula (LaTeX): ${topic.latex}`);
    if (topic.title) lines.push(`Titolo: ${topic.title}`);
  }
  lines.push(`Note: ${topic.notes ? `\n${topic.notes}` : 'nessuna'}`);
  lines.push(`Etichette: ${topic.labels.length > 0 ? topic.labels.join(', ') : 'nessuna'}`);
  lines.push(`Marker: ${topic.markers.length > 0 ? topic.markers.join(', ') : 'nessuno'}`);
  if (topic.href) lines.push(`Link: ${topic.href}`);
  if (topic.fillColor) lines.push(`Colore: ${topic.fillColor}`);
  if (topic.task) lines.push(`Attività: ${JSON.stringify(topic.task)}`);
  lines.push(
    kids.length > 0 ? `Figli (${kids.length}):\n${kids.map((k) => `- [${k.id}] ${label(k)}`).join('\n')}` : 'Figli: nessuno'
  );
  return lines.join('\n');
}

function findTopicsText(wb: WorkbookDto, query: string, limit: number): string {
  const needle = query.trim().toLowerCase();
  if (needle === '') throw invalid('Testo da cercare vuoto.');
  const matches: string[] = [];
  let total = 0;
  for (const sheet of wb.sheets) {
    for (const topic of sheet.topics) {
      const haystack = [topic.title, topic.notes, topic.latex ?? '', ...topic.labels].join('\n').toLowerCase();
      if (!haystack.includes(needle)) continue;
      total++;
      if (matches.length >= limit) continue;
      const path = ancestors(wb, topic).map((t) => label(t));
      matches.push(`- [${topic.id}] ${label(topic)} — foglio ${sheet.index + 1}${path.length > 0 ? `, in ${path.join(' › ')}` : ''}`);
    }
  }
  if (total === 0) return `Nessun blocco contiene «${query}».`;
  const more = total > matches.length ? `\n… altri ${total - matches.length} risultati (aumenta limit).` : '';
  return `${total} blocchi contengono «${query}»:\n${matches.join('\n')}${more}`;
}

function markersText(): string {
  return GROUPS.map((group) => `${group.label}: ${group.markers.map((m) => m.id).join(', ')}`).join('\n');
}

// ---------------------------------------------------------------- DTO

function findTopicView(wb: WorkbookDto, id: string): TopicView | undefined {
  for (const sheet of wb.sheets) {
    const found = sheet.topics.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

function requireTopicView(wb: WorkbookDto, id: string): TopicView {
  const topic = findTopicView(wb, id);
  if (!topic) throw invalid(`Blocco [${id}] non trovato: rileggi la mappa con read_map.`);
  return topic;
}

function depthOf(wb: WorkbookDto, id: string): number {
  return findTopicView(wb, id)?.depth ?? 0;
}

function childrenIndex(sheet: SheetDto): Map<string, TopicView[]> {
  const index = new Map<string, TopicView[]>();
  for (const topic of sheet.topics) {
    if (topic.parentId === undefined) continue;
    const list = index.get(topic.parentId);
    if (list) list.push(topic);
    else index.set(topic.parentId, [topic]);
  }
  return index;
}

function ancestors(wb: WorkbookDto, topic: TopicView): TopicView[] {
  const out: TopicView[] = [];
  let parentId = topic.parentId;
  while (parentId !== undefined) {
    const parent = findTopicView(wb, parentId);
    if (!parent) break;
    out.unshift(parent);
    parentId = parent.parentId;
  }
  return out;
}

function countDescendants(wb: WorkbookDto, topic: TopicView): number {
  const sheet = wb.sheets[topic.sheetIndex];
  if (!sheet) return 0;
  const children = childrenIndex(sheet);
  let count = 0;
  const stack = [...(children.get(topic.id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    count++;
    stack.push(...(children.get(next.id) ?? []));
  }
  return count;
}

function label(topic: TopicView): string {
  if (topic.kind === 'equation' && topic.latex !== undefined) return `(formula) ${topic.latex}`;
  if (topic.kind === 'image') return topic.title ? `(immagine) ${topic.title}` : '(immagine)';
  return topic.title.trim() === '' ? '(senza titolo)' : oneLine(topic.title);
}

function groupName(group: string): string {
  switch (group) {
    case 'detached':
      return 'blocco libero';
    case 'summary':
      return 'sommario';
    case 'callout':
      return 'callout';
    default:
      return group;
  }
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ⏎ ');
}

function preview(text: string): string {
  const flat = oneLine(text.trim());
  return flat.length > NOTE_PREVIEW ? `${flat.slice(0, NOTE_PREVIEW)}… (vedi get_topic)` : flat;
}

// ---------------------------------------------------------------- argomenti

function invalid(message: string): XmapError {
  return new XmapError(CODE_INVALID_INPUT, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('Argomenti non validi: atteso un oggetto.');
  return value as Record<string, unknown>;
}

function str(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = args[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw invalid(`Manca il parametro ${key}.`);
  return value;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`${key} deve essere un testo.`);
  return value;
}

function nullableStr(args: Record<string, unknown>, key: string): string | null {
  return optStr(args, key) ?? null;
}

function optInt(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid(`${key} deve essere un intero non negativo.`);
  return value;
}

function optBool(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw invalid(`${key} deve essere true o false.`);
  return value;
}

function optStrings(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalid(`${key} deve essere un elenco di testi.`);
  }
  return value;
}
