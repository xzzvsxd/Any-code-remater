import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { SortableList } from '../sortable-list';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => (
    <div data-dnd-context="true">{children}</div>
  ),
  closestCenter: vi.fn(),
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  useSensor: (...args: unknown[]) => args,
  useSensors: (...sensors: unknown[]) => sensors,
}));

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: <T,>(items: T[], oldIndex: number, newIndex: number) => {
    const next = [...items];
    const [item] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, item);
    return next;
  },
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <div data-sortable-context="true">{children}</div>
  ),
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
  verticalListSortingStrategy: {},
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));

const renderList = (count: number, disableSortingAbove?: number) =>
  renderToStaticMarkup(
    <SortableList
      items={items(count)}
      onReorder={() => {}}
      renderItem={(item) => <span>{item.id}</span>}
      {...({ disableSortingAbove } as { disableSortingAbove?: number })}
    />,
  );

describe('SortableList large-list render safety', () => {
  test('keeps drag-and-drop enabled below the large-list cutoff', () => {
    const html = renderList(5, 80);

    expect(html).toContain('data-dnd-context="true"');
    expect(html).toContain('data-sortable-context="true"');
  });

  test('renders a plain list above the cutoff instead of mounting dnd-kit for every row', () => {
    const html = renderList(300, 80);

    expect(html).not.toContain('data-dnd-context="true"');
    expect(html).not.toContain('data-sortable-context="true"');
    expect(html).toContain('item-299');
  });
});
