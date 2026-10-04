import { CHILD_GROUPS, Sheet, Topic } from '../model/types.js';
import { topicLabels, topicLatex, topicNotesText, topicTitle } from '../model/utils.js';

export function toOPML(sheets: Sheet[], title: string = 'XMap Studio'): string {
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += '<opml version="2.0">\n  <head>\n    <title>';
  out += xmlEscape(title);
  out += '</title>\n  </head>\n  <body>\n';

  for (const sheet of sheets) {
    const root = sheet.rootTopic;
    const sheetTitle = (root ? topicTitle(root) : '') || sheet.title || 'Mappa';
    out += `    <outline ${opmlAttrs(sheetTitle, root)}>\n`;

    if (root) {
      for (const group of CHILD_GROUPS) {
        const list = root.children?.[group];
        if (Array.isArray(list)) {
          for (const child of list) {
            writeOpmlTopic(child, 3, (s) => (out += s));
          }
        }
      }
    }
    out += '    </outline>\n';
  }

  out += '  </body>\n</opml>\n';
  return out;
}

function writeOpmlTopic(topic: Topic, depth: number, write: (s: string) => void): void {
  const indent = '  '.repeat(depth);
  const title = topicTitle(topic);
  const children = getChildrenList(topic);

  if (children.length === 0) {
    write(`${indent}<outline ${opmlAttrs(title, topic)}/>\n`);
  } else {
    write(`${indent}<outline ${opmlAttrs(title, topic)}>\n`);
    for (const child of children) {
      writeOpmlTopic(child, depth + 1, write);
    }
    write(`${indent}</outline>\n`);
  }
}

function getChildrenList(topic: Topic): Topic[] {
  const res: Topic[] = [];
  for (const group of CHILD_GROUPS) {
    const list = topic.children?.[group];
    if (Array.isArray(list)) {
      res.push(...list);
    }
  }
  return res;
}

function opmlAttrs(text: string, topic?: Topic): string {
  let attrs = `text="${xmlEscape(text)}"`;
  if (topic) {
    const notes = topicNotesText(topic);
    if (notes) {
      attrs += ` _note="${xmlEscape(notes)}"`;
    }
    const latex = topicLatex(topic);
    if (latex) {
      attrs += ` _equation="${xmlEscape(latex)}"`;
    }
    const labels = topicLabels(topic);
    if (labels.length > 0) {
      attrs += ` _labels="${xmlEscape(labels.join(', '))}"`;
    }
  }
  return attrs;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
