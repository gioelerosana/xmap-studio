import { CHILD_GROUPS, Sheet, Topic } from '../model/types.js';
import { topicLabels, topicLatex, topicNotesText, topicTitle } from '../model/utils.js';

export function toOutline(sheets: Sheet[]): string {
  let out = '';
  for (const sheet of sheets) {
    const root = sheet.rootTopic;
    const heading = (root ? topicTitle(root) : '') || sheet.title || 'Mappa';
    out += `${heading}\n`;

    if (root) {
      writePreamble(root, (s) => (out += s));
      for (const group of CHILD_GROUPS) {
        const list = root.children?.[group];
        if (Array.isArray(list)) {
          for (const child of list) {
            writeOutlineTopic(child, 1, (s) => (out += s));
          }
        }
      }
    }
    out += '\n';
  }
  return out;
}

function writePreamble(topic: Topic, write: (s: string) => void): void {
  const notes = topicNotesText(topic);
  if (notes) {
    for (const line of notes.split('\n')) {
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

function writeOutlineTopic(topic: Topic, depth: number, write: (s: string) => void): void {
  const indent = '  '.repeat(depth);
  write(`${indent}• ${topicText(topic)}\n`);

  const notes = topicNotesText(topic);
  if (notes) {
    for (const line of notes.split('\n')) {
      write(`${indent}    ${line}\n`);
    }
  }

  for (const group of CHILD_GROUPS) {
    const list = topic.children?.[group];
    if (Array.isArray(list)) {
      for (const child of list) {
        writeOutlineTopic(child, depth + 1, write);
      }
    }
  }
}

function topicText(topic: Topic): string {
  const title = topicTitle(topic).replace(/\n/g, ' ').trim();
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
