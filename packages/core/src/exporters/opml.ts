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

/** Caratteri non ammessi in XML 1.0 (controllo C0 tranne tab/a capo, surrogati isolati, U+FFFE/U+FFFF). */
const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Escape per testo e valori di attributo. A capo, ritorno e tab diventano riferimenti
 * numerici: un parser XML normalizza in spazi quelli letterali negli attributi, e le
 * note su più righe arriverebbero su una sola riga.
 */
function xmlEscape(s: string): string {
  return s
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}
