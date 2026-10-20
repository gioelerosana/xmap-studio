import React from 'react';
import { ListChecks } from 'lucide-react';
import type { TaskData } from '@xmap/core';
import { Button, Field, Input, Select } from '@xmap/ui-kit';

import { InspectorSection } from './InspectorSection.js';

interface TaskSectionProps {
  task: TaskData;
  onTaskChange: (next: TaskData) => void;
}

export const TaskSection: React.FC<TaskSectionProps> = ({ task, onTaskChange }) => (
  <InspectorSection
    id="task"
    title="Task"
    icon={<ListChecks className="size-3.5" />}
    summary={
      task.progress != null
        ? `${task.progress}%`
        : task.priority || task.startDate || task.dueDate
          ? '•'
          : undefined
    }
  >
    <div className="grid grid-cols-2 gap-2">
      <Field label="Priorità">
        <Select
          value={task.priority ?? ''}
          onChange={(e) =>
            onTaskChange({ ...task, priority: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">—</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Avanzamento %">
        <Input
          type="number"
          min={0}
          max={100}
          value={task.progress ?? ''}
          onChange={(e) =>
            onTaskChange({ ...task, progress: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </Field>
      <Field label="Inizio">
        <Input
          type="date"
          value={toDateInput(task.startDate)}
          onChange={(e) => onTaskChange({ ...task, startDate: fromDateInput(e.target.value) })}
        />
      </Field>
      <Field label="Scadenza">
        <Input
          type="date"
          value={toDateInput(task.dueDate)}
          onChange={(e) => onTaskChange({ ...task, dueDate: fromDateInput(e.target.value) })}
        />
      </Field>
    </div>
    {(task.priority || task.progress || task.startDate || task.dueDate) && (
      <Button variant="ghost" size="sm" onClick={() => onTaskChange({})}>
        Azzera task
      </Button>
    )}
  </InspectorSection>
);

function toDateInput(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}
