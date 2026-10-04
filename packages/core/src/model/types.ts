/**
 * Modello di content.json di un workbook XMind 2020+ (Vana).
 *
 * Tutte le interfacce supportano campi extra arbitrari ([key: string]: unknown)
 * per garantire un round-trip lossless al 100% come richiesto da AGENTS.md.
 */

export const CHILD_GROUPS = ['attached', 'detached', 'summary', 'callout'] as const;
export type ChildGroup = (typeof CHILD_GROUPS)[number];

export const MATHJAX_PROVIDER = 'org.xmind.ui.mathJax';
export const RESOURCE_PREFIX = 'xap:resources/';

export interface NotesPart {
  content?: string;
  [key: string]: unknown;
}

export interface Notes {
  plain?: NotesPart;
  realHTML?: NotesPart;
  [key: string]: unknown;
}

export interface Marker {
  markerId?: string;
  [key: string]: unknown;
}

export interface Extension {
  provider?: string;
  content?: Record<string, unknown> | unknown;
  resourceRefs?: unknown;
  [key: string]: unknown;
}

export interface Image {
  src?: string;
  width?: number;
  height?: number;
  isMathJaxImage?: boolean;
  [key: string]: unknown;
}

export interface Boundary {
  id?: string;
  class?: string;
  range?: string;
  title?: string;
  attributedTitle?: unknown;
  [key: string]: unknown;
}

export interface Summary {
  id?: string;
  class?: string;
  range?: string;
  topicId?: string;
  title?: string;
  attributedTitle?: unknown;
  [key: string]: unknown;
}

export interface Children {
  attached?: Topic[];
  detached?: Topic[];
  summary?: Topic[];
  callout?: Topic[];
  [key: string]: unknown;
}

export interface Topic {
  id?: string;
  class?: string;
  title?: string;
  children?: Children;
  image?: Image;
  notes?: Notes;
  notesDisplay?: string;
  labels?: string[];
  markers?: Marker[];
  href?: string;
  extensions?: Extension[];
  summaries?: Summary[];
  boundaries?: Boundary[];
  titleUnedited?: boolean;
  structureClass?: string;
  [key: string]: unknown;
}

export interface Relationship {
  id?: string;
  class?: string;
  end1Id?: string;
  end2Id?: string;
  title?: string;
  attributedTitle?: unknown;
  [key: string]: unknown;
}

export interface Sheet {
  id?: string;
  class?: string;
  title?: string;
  revisionId?: string;
  rootTopic?: Topic;
  topicOverlapping?: unknown;
  arrangeableLayerOrder?: unknown;
  zones?: unknown;
  extensions?: Extension[];
  theme?: unknown;
  relationships?: Relationship[];
  [key: string]: unknown;
}

export type Content = Sheet[];
