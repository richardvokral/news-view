"use client";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import SortableWidget from "./SortableWidget";
import MetricCard from "@/components/reports/widgets/MetricCard";
import TimeseriesChart from "@/components/reports/widgets/TimeseriesChart";
import BreakdownTable from "@/components/reports/widgets/BreakdownTable";
import PieBreakdown from "@/components/reports/widgets/PieBreakdown";
import ComputedMetricCard from "@/components/reports/widgets/ComputedMetricCard";
import ComputedTimeseriesChart from "@/components/reports/widgets/ComputedTimeseriesChart";
import ArticleTable from "@/components/reports/widgets/ArticleTable";
import EntityTable from "@/components/reports/widgets/EntityTable";
import type { WidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

function renderWidget(
  widget: WidgetConfig,
  dateRange: DateRangeValue,
  siteId: string
) {
  switch (widget.type) {
    case "metric":
      return <MetricCard config={widget} dateRange={dateRange} siteId={siteId} />;
    case "timeseries":
      return (
        <TimeseriesChart config={widget} dateRange={dateRange} siteId={siteId} />
      );
    case "breakdown":
      return (
        <BreakdownTable config={widget} dateRange={dateRange} siteId={siteId} />
      );
    case "pie":
      return (
        <PieBreakdown config={widget} dateRange={dateRange} siteId={siteId} />
      );
    case "computed":
      return (
        <ComputedMetricCard
          config={widget}
          dateRange={dateRange}
          siteId={siteId}
        />
      );
    case "computed_timeseries":
      return (
        <ComputedTimeseriesChart
          config={widget}
          dateRange={dateRange}
          siteId={siteId}
        />
      );
    case "article_breakdown":
      return (
        <ArticleTable config={widget} dateRange={dateRange} siteId={siteId} />
      );
    case "entity_breakdown":
      return (
        <EntityTable config={widget} dateRange={dateRange} siteId={siteId} />
      );
  }
}

interface Props {
  widgets: WidgetConfig[];
  dateRange: DateRangeValue;
  siteId: string;
  isEditing: boolean;
  onReorder: (widgets: WidgetConfig[]) => void;
  onDelete: (id: string) => void;
  onToggleCols: (id: string) => void;
}

export default function DashboardGrid({
  widgets,
  dateRange,
  siteId,
  isEditing,
  onReorder,
  onDelete,
  onToggleCols,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const metricWidgets = widgets.filter(
    (w) => w.type === "metric" || w.type === "computed"
  );
  const otherWidgets = widgets.filter(
    (w) => w.type !== "metric" && w.type !== "computed"
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const isActiveMetric = metricWidgets.some((w) => w.id === activeId);
    const isOverMetric = metricWidgets.some((w) => w.id === overId);
    if (isActiveMetric !== isOverMetric) return;
    const oldIndex = widgets.findIndex((w) => w.id === activeId);
    const newIndex = widgets.findIndex((w) => w.id === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(widgets, oldIndex, newIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {metricWidgets.length > 0 && (
        <SortableContext
          items={metricWidgets.map((w) => w.id)}
          strategy={rectSortingStrategy}
          disabled={!isEditing}
        >
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {metricWidgets.map((widget) => (
              <SortableWidget
                key={widget.id}
                widget={widget}
                isEditing={isEditing}
                onDelete={onDelete}
                onToggleCols={onToggleCols}
              >
                {renderWidget(widget, dateRange, siteId)}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      )}

      <SortableContext
        items={otherWidgets.map((w) => w.id)}
        strategy={rectSortingStrategy}
        disabled={!isEditing}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {otherWidgets.map((widget) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              isEditing={isEditing}
              onDelete={onDelete}
              onToggleCols={onToggleCols}
            >
              {renderWidget(widget, dateRange, siteId)}
            </SortableWidget>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
