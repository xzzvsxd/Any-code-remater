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
import type { DraggableAttributes } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 从 useSortable 返回值推导 listeners 类型，避免依赖脆弱的 dist 深层路径 */
type SortableListeners = ReturnType<typeof useSortable>['listeners'];

/** 把拖拽属性透传给自定义手柄，实现手柄内嵌到内容区域 */
interface SortableHandleContextValue {
  attributes: DraggableAttributes;
  listeners: SortableListeners;
  isDragging: boolean;
}

const SortableHandleContext = React.createContext<SortableHandleContextValue | null>(null);

/**
 * 自定义拖拽手柄。
 * 在 customHandle 模式下由 renderItem 自行放置，实现整行一体的紧凑布局。
 */
export function SortableDragHandle({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const ctx = React.useContext(SortableHandleContext);
  if (!ctx) return null;
  return (
    <div
      {...ctx.attributes}
      {...ctx.listeners}
      className={cn(
        'flex items-center justify-center cursor-grab active:cursor-grabbing',
        'text-muted-foreground hover:text-foreground transition-colors',
        'touch-none select-none',
        className
      )}
      aria-label="拖拽排序"
    >
      {children ?? <GripVertical className="h-4 w-4" />}
    </div>
  );
}

export interface SortableItemProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  /** 启用自定义手柄模式：不渲染默认左侧手柄，由 children 通过 SortableDragHandle 放置 */
  customHandle?: boolean;
}

/**
 * 可拖拽的单个项目
 */
export function SortableItem({ id, children, disabled, customHandle }: SortableItemProps) {
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

  // 自定义手柄模式：内容自带手柄，外层只负责定位与拖拽节点
  if (customHandle) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn('relative', isDragging && 'z-50 opacity-90 shadow-lg')}
      >
        <SortableHandleContext.Provider value={{ attributes, listeners, isDragging }}>
          {children}
        </SortableHandleContext.Provider>
      </div>
    );
  }

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
  /**
   * 超过该数量后退化为纯列表，不挂载 dnd-kit。
   * Linux WebKit/GTK 对几百个 useSortable/layout measuring 特别敏感，
   * 大列表场景保留展示与点击能力，牺牲拖拽排序以避免展开/折叠卡死。
   */
  disableSortingAbove?: number;
  /** 判断某个项目是否禁用拖拽 */
  isItemDisabled?: (item: T) => boolean;
  /** 自定义列表容器间距类（默认 space-y-4），用于紧凑场景 */
  listClassName?: string;
  /** 启用自定义手柄模式，手柄由 renderItem 通过 SortableDragHandle 放置 */
  customHandle?: boolean;
}

/**
 * 可拖拽排序列表
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  disabled,
  disableSortingAbove,
  isItemDisabled,
  listClassName = 'space-y-4',
  customHandle,
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

  const sortingDisabledBySize =
    typeof disableSortingAbove === 'number' && items.length > disableSortingAbove;
  const shouldUseDnd = !disabled && !sortingDisabledBySize;

  if (!shouldUseDnd) {
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
              customHandle={customHandle}
            >
              {renderItem(item, index)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
