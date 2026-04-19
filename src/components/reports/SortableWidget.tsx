"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WidgetConfig } from "@/types/dashboard";

interface Props {
  widget: WidgetConfig;
  isEditing: boolean;
  onDelete: (id: string) => void;
  onToggleCols: (id: string) => void;
  children: React.ReactNode;
}

export default function SortableWidget({
  widget,
  isEditing,
  onDelete,
  onToggleCols,
  children,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isMetric = widget.type === "metric" || widget.type === "computed";

  if (!isEditing) {
    return (
      <div className={!isMetric && widget.cols === 2 ? "lg:col-span-2" : ""}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-lg ring-2 ring-blue-200 ring-offset-2 ${
        !isMetric && widget.cols === 2 ? "lg:col-span-2" : ""
      } ${isDragging ? "z-50" : ""}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute inset-0 z-10 cursor-grab rounded-lg active:cursor-grabbing"
      />
      <div className="absolute -top-3 right-2 z-20 flex gap-1">
        {!isMetric && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCols(widget.id);
            }}
            className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
            title={widget.cols === 2 ? "Make narrow" : "Make wide"}
          >
            {widget.cols === 2 ? "1col" : "2col"}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(widget.id);
          }}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50"
          title="Remove widget"
        >
          ✕
        </button>
      </div>
      <div className="pointer-events-none">{children}</div>
    </div>
  );
}
