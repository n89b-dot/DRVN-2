"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * SortableGrid — drag-and-drop ordering for photo strips and tile grids
 * (dnd-kit: pointer + touch + keyboard sensors, screen-reader
 * announcements built in). An 8px activation distance keeps buttons inside
 * items clickable. This upgrades pointer ergonomics; keep the existing ↑/↓
 * controls alongside it as the explicit accessible path (brief §S2).
 */

export function SortableGrid({
  ids,
  onReorder,
  className,
  children,
}: {
  /** Item ids in display order. */
  ids: string[];
  /** Called with the full new order after a drop. */
  onReorder: (ids: string[]) => void;
  className?: string;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** One draggable cell inside a SortableGrid. */
export function SortableItem({
  id,
  className,
  label,
  children,
}: {
  id: string;
  className?: string;
  /** Announced name for the draggable ("Photo 3"). */
  label?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      className={cx(className, isDragging && "sortable--lifted")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={label}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
