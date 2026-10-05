import { Extension, Topic } from '../model/types.js';

/**
 * Task tracking nativo di XMind: extension `org.xmind.ui.task`.
 *
 * Lo standard su disco prevede le chiavi `priority`, `progress`, `startDate`,
 * `dueDate`, `assignees`, `dependencies`, `creator`. L'app gestisce solo le
 * quattro chiavi scalari; `assignees`, `dependencies` e `creator` restano
 * intatti per non rompere il diagramma di Gantt di XMind.
 */
export const TASK_PROVIDER = 'org.xmind.ui.task';

const SCALAR_KEYS = ['priority', 'progress', 'startDate', 'dueDate'] as const;

export interface TaskData {
  priority?: number;
  progress?: number;
  startDate?: string;
  dueDate?: string;
}

function taskExtension(topic: Topic): Extension | undefined {
  return topic.extensions?.find((e) => e.provider === TASK_PROVIDER);
}

function taskContent(topic: Topic): Record<string, unknown> | undefined {
  const ext = taskExtension(topic);
  const content = ext?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  return undefined;
}

export function readTask(topic: Topic): TaskData | undefined {
  const content = taskContent(topic);
  if (!content) return undefined;
  const task: TaskData = {};
  if (typeof content.priority === 'number') task.priority = content.priority;
  if (typeof content.progress === 'number') task.progress = content.progress;
  if (typeof content.startDate === 'string') task.startDate = content.startDate;
  if (typeof content.dueDate === 'string') task.dueDate = content.dueDate;
  return Object.keys(task).length > 0 ? task : undefined;
}

function ensureContent(topic: Topic): Record<string, unknown> {
  if (!topic.extensions) topic.extensions = [];
  let ext = taskExtension(topic);
  if (!ext) {
    ext = { provider: TASK_PROVIDER, content: {} };
    topic.extensions.push(ext);
  }
  if (!ext.content || typeof ext.content !== 'object' || Array.isArray(ext.content)) {
    ext.content = {};
  }
  return ext.content as Record<string, unknown>;
}

function cleanup(topic: Topic): void {
  const ext = taskExtension(topic);
  if (!ext) return;
  const content = ext.content as Record<string, unknown> | undefined;
  if (content && Object.keys(content).length === 0) {
    topic.extensions = (topic.extensions || []).filter((e) => e.provider !== TASK_PROVIDER);
    if (topic.extensions.length === 0) delete topic.extensions;
  }
}

/**
 * Scrive solo le chiavi scalari gestite dall'app, lasciando le altre intatte.
 * Un valore `undefined`/vuoto rimuove la chiave.
 */
export function writeTask(topic: Topic, data: TaskData): void {
  const content = ensureContent(topic);

  const putNumber = (key: 'priority' | 'progress', value: number | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      content[key] = Math.trunc(value);
    } else {
      delete content[key];
    }
  };
  const putDate = (key: 'startDate' | 'dueDate', value: string | undefined) => {
    const clean = value?.trim();
    if (clean) content[key] = clean;
    else delete content[key];
  };

  putNumber('priority', data.priority);
  putNumber('progress', data.progress);
  putDate('startDate', data.startDate);
  putDate('dueDate', data.dueDate);

  const onlyScalars = SCALAR_KEYS.every((k) => !(k in content));
  const hasOther = Object.keys(content).some((k) => !SCALAR_KEYS.includes(k as never));
  if (onlyScalars && !hasOther) {
    topic.extensions = (topic.extensions || []).filter((e) => e.provider !== TASK_PROVIDER);
    if (topic.extensions.length === 0) delete topic.extensions;
    return;
  }
  cleanup(topic);
}

export function clearTask(topic: Topic): void {
  const content = taskContent(topic);
  if (!content) return;
  for (const key of SCALAR_KEYS) {
    delete content[key];
  }
  cleanup(topic);
}
