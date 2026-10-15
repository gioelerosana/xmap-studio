import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppController, readTask, writeTask, Topic } from '../src/index.js';

const DEMO_FILE = path.resolve(__dirname, '../../../demo/Relazioni.xmap-studio.xmind');

describe('Task tracking (org.xmind.ui.task)', () => {
  it('scrive e legge solo le chiavi scalari senza toccare dependencies', () => {
    const topic: Topic = {
      id: 't1',
      extensions: [
        {
          provider: 'org.xmind.ui.task',
          content: { dependencies: 'other-id', creator: 'me' },
        },
      ],
    };

    writeTask(topic, { priority: 3, progress: 50, dueDate: '2026-01-01T00:00:00.000Z' });

    const content = topic.extensions![0].content as Record<string, unknown>;
    expect(content.priority).toBe(3);
    expect(content.progress).toBe(50);
    expect(content.dueDate).toBe('2026-01-01T00:00:00.000Z');
    // Le chiavi non gestite sopravvivono al round-trip.
    expect(content.dependencies).toBe('other-id');
    expect(content.creator).toBe('me');

    expect(readTask(topic)).toEqual({
      priority: 3,
      progress: 50,
      dueDate: '2026-01-01T00:00:00.000Z',
    });

    writeTask(topic, {});
    const after = topic.extensions?.find((e) => e.provider === 'org.xmind.ui.task');
    const afterContent = after?.content as Record<string, unknown>;
    expect(afterContent.priority).toBeUndefined();
    expect(afterContent.dependencies).toBe('other-id');
  });

  it('integra il task nel controller e nel DTO', async () => {
    const buffer = fs.readFileSync(DEMO_FILE);
    const controller = new AppController();
    const dto = await controller.open(buffer, DEMO_FILE, 'Relazioni.xmap-studio.xmind');

    const target = dto.sheets[0].topics.find((t) => t.depth > 0)!;
    controller.setTopicTask(target.id, { priority: 5, progress: 25 });

    const updated = controller.workbook()!;
    const view = updated.sheets[0].topics.find((t) => t.id === target.id)!;
    expect(view.task?.priority).toBe(5);
    expect(view.task?.progress).toBe(25);

    controller.clearTopicTask(target.id);
    const cleared = controller.workbook()!.sheets[0].topics.find((t) => t.id === target.id)!;
    expect(cleared.task).toBeUndefined();
  });
});
