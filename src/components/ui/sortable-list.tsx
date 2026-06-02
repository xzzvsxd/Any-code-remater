/**
 * 通用可拖拽排序列表组件
 * 基于 @dnd-kit 实现
 */

import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SortableItemProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}

/**
 * 可拖拽的单个项目
 */
export function SortableItem({ id, children, disabled }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'z-50 opacity-90 shadow-lg'
      )}
    >
      <div className="flex items-stretch">
        {/* 拖拽手柄 */}
        {!disabled && (
          <div
            {...attributes}
            {...listeners}
            className={cn(
              'flex items-center justify-center px-2 cursor-grab active:cursor-grabbing',
              'text-muted-foreground hover:text-foreground transition-colors',
              'touch-none select-none'
            )}
            aria-label="拖拽排序"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        {/* 内容区域 */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}

export interface SortableListProps<T extends { id: string }> {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  disabled?: boolean;
  /** 判断某个项目是否禁用拖拽 */
  isItemDisabled?: (item: T) => boolean;
  /** 自定义列表容器间距类（默认 space-y-4），用于紧凑场景 */
  listClassName?: string;
}

/**
 * 可拖拽排序列表
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  disabled,
  isItemDisabled,
  listClassName = 'space-y-4',
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 需要移动 8px 才开始拖拽，避免误触
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      const newItems = arrayMove(items, oldIndex, newIndex);
      onReorder(newItems);
    }
  };

  if (disabled) {
    return (
      <div className={listClassName}>
        {items.map((item, index) => (
          <div key={item.id}>{renderItem(item, index)}</div>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={listClassName}>
          {items.map((item, index) => (
            <SortableItem
              key={item.id}
              id={item.id}
              disabled={isItemDisabled?.(item)}
            >
              {renderItem(item, index)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
