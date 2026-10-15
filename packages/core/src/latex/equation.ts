import { CODE_LATEX, XmapError } from '../errors.js';
import { MATHJAX_PROVIDER, Topic } from '../model/types.js';
import { sha256Hex } from '../archive/archive.js';
import { renderLatexToSvg } from './mathjax.js';
import { svgToPng } from './raster.js';

export type TitleMode =
  | { kind: 'formula_only' }
  | { kind: 'keep_title' }
  | { kind: 'custom'; title: string };

export interface ApplyOutcome {
  topicId: string;
  latex: string;
  resource: string;
  width: number;
  height: number;
  pngBytes: number;
  previousTitle?: string;
  newTitle?: string;
}

export interface RemoveOutcome {
  topicId: string;
  removedLatex?: string;
  removedResource?: string;
  newTitle?: string;
}

export interface ApplyEquationOptions {
  emPx?: number;
  rasterScale?: number;
  titleMode?: TitleMode;
  color?: string;
}

/**
 * Applica una formula LaTeX a un topic seguendo lo standard nativo di XMind:
 * 1. provider: org.xmind.ui.mathJax
 * 2. extension array con { content: { content: latex } }
 * 3. oggetto image annidato con src: "xap:resources/<sha256>.png", isMathJaxImage: true
 * 4. nome risorsa = SHA-256 dei byte del PNG
 */
export async function applyEquation(
  topic: Topic,
  latex: string,
  options: ApplyEquationOptions = {}
): Promise<{ outcome: ApplyOutcome; png: Uint8Array }> {
  const trimmed = latex.trim();
  if (trimmed.length === 0) {
    throw new XmapError(CODE_LATEX, 'La formula è vuota.');
  }

  const emPx = options.emPx ?? 23.33;
  const rasterScale = options.rasterScale ?? 3.0;
  const titleMode = options.titleMode ?? { kind: 'formula_only' };
  const color = options.color ?? '#000000';

  const render = renderLatexToSvg(trimmed, emPx);
  if (render.error) {
    throw new XmapError(CODE_LATEX, `LaTeX non valido: ${render.error}`);
  }

  const png = await svgToPng(render.svg, render.width, render.height, rasterScale, color);
  const width = Math.max(1, Math.round(render.width));
  const height = Math.max(1, Math.round(render.height));
  const hash = sha256Hex(png);
  const resource = `resources/${hash}.png`;
  const previousTitle = topic.title;

  // Filtra estensioni mathJax precedenti e aggiungi la nuova
  if (!topic.extensions) {
    topic.extensions = [];
  }
  topic.extensions = topic.extensions.filter((e) => e.provider !== MATHJAX_PROVIDER);
  topic.extensions.push({
    provider: MATHJAX_PROVIDER,
    content: { content: trimmed },
  });

  // Oggetto image annidato (Regola 1 e 5)
  topic.image = {
    src: `xap:${resource}`,
    width,
    height,
    isMathJaxImage: true,
  };

  if (titleMode.kind === 'formula_only') {
    topic.title = '';
  } else if (titleMode.kind === 'custom') {
    topic.title = titleMode.title;
  }

  delete topic.titleUnedited;

  const outcome: ApplyOutcome = {
    topicId: topic.id ?? '',
    latex: trimmed,
    resource,
    width,
    height,
    pngBytes: png.length,
    previousTitle,
    newTitle: topic.title,
  };

  return { outcome, png };
}

/**
 * Rimuove l'equazione dal topic. Le risorse non vengono cancellate dallo ZIP
 * per sicurezza e supporto completo all'undo.
 */
export function removeEquation(topic: Topic, title?: string): RemoveOutcome {
  let removedLatex: string | undefined;
  let removedResource: string | undefined;

  if (topic.extensions) {
    const ext = topic.extensions.find((e) => e.provider === MATHJAX_PROVIDER);
    if (ext && ext.content && typeof ext.content === 'object' && 'content' in ext.content) {
      removedLatex = (ext.content as { content?: string }).content;
    }
    topic.extensions = topic.extensions.filter((e) => e.provider !== MATHJAX_PROVIDER);
    if (topic.extensions.length === 0) {
      delete topic.extensions;
    }
  }

  if (topic.image && topic.image.isMathJaxImage) {
    const src = topic.image.src;
    if (src && src.startsWith('xap:')) {
      removedResource = src.slice(4);
    }
    delete topic.image;
  }

  if (title !== undefined) {
    topic.title = title;
  }

  return {
    topicId: topic.id ?? '',
    removedLatex,
    removedResource,
    newTitle: topic.title,
  };
}
