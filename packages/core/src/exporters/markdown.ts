import { CHILD_GROUPS, Sheet, Topic } from '../model/types.js';
import { topicLabels, topicLatex, topicNotesText, topicTitle } from '../model/utils.js';

export function toMarkdown(sheets: Sheet[]): string {
  let out = '';
  for (const sheet of sheets) {
    const root = sheet.rootTopic;
    const heading = (root ? topicTitle(root) : '') || sheet.title || 'Mappa';
    out += `# ${heading.replace(/\r?\n|\r/g, ' ')}\n\n`;

    if (root) {
      writePreamble(root, (s) => (out += s));
      for (const group of CHILD_GROUPS) {
        const list = root.children?.[group];
        if (Array.isArray(list)) {
          for (const child of list) {
            writeMarkdownTopic(child, 0, (s) => (out += s));
          }
        }
      }
    }
    out += '\n';
  }
  return out;
}

function writePreamble(topic: Topic, write: (s: string) => void): void {
  const notes = noteLines(topic);
  if (notes) {
    for (const line of notes) {
      write(`> ${line}\n`);
    }
    write('\n');
  }
  const latex = topicLatex(topic);
  if (latex) {
    write(`$${latex.replace(/\n/g, ' ')}$\n\n`);
  }
  const labels = topicLabels(topic);
  if (labels.length > 0) {
    write(`${labelsLine(labels)}\n\n`);
  }
}

function writeMarkdownTopic(topic: Topic, depth: number, write: (s: string) => void): void {
  const indent = '  '.repeat(depth);
  write(`${indent}- ${topicText(topic)}\n`);

  const notes = noteLines(topic);
  if (notes) {
    for (const line of notes) {
      write(`${indent}  > ${line}\n`);
    }
  }

  for (const group of CHILD_GROUPS) {
    const list = topic.children?.[group];
    if (Array.isArray(list)) {
      for (const child of list) {
        writeMarkdownTopic(child, depth + 1, write);
      }
    }
  }
}

/** Righe della nota senza `\r` (CRLF o CR soli), o `undefined` se non c'è nota. */
function noteLines(topic: Topic): string[] | undefined {
  const notes = topicNotesText(topic);
  return notes ? notes.replace(/\r\n?/g, '\n').split('\n') : undefined;
}

/**
 * Escape di `\`, `` ` `` e `$` nel titolo di un elemento: all'import (`splitLatex`,
 * `splitLabels` in import.ts) un titolo come "costa $5 e $10$" o "`x`" diventerebbe
 * formula o etichetta. Le formule vere si scrivono a parte, senza escape.
 */
function escapeMarkdownTitle(title: string): string {
  return title.replace(/[\\`$]/g, '\\$&');
}

function topicText(topic: Topic): string {
  const title = escapeMarkdownTitle(topicTitle(topic).replace(/\r?\n|\r/g, ' ').trim());
  const latex = topicLatex(topic);
  const labels = topicLabels(topic);

  let text = '';
  if (latex) {
    if (title.length === 0) {
      text = `$${latex.replace(/\n/g, ' ')}$`;
    } else {
      text = `${title} $${latex.replace(/\n/g, ' ')}$`;
    }
  } else {
    text = title;
  }

  if (labels.length > 0) {
    text += ` ${labelsLine(labels)}`;
  }
  return text;
}

function labelsLine(labels: string[]): string {
  return labels.map((l) => `\`${l.replace(/`/g, '')}\``).join(' ');
}
