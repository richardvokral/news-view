// Dashboard widget types (ported from coolreport, kept stable so JSON layouts are portable).

export type PlausibleMetric =
  | "visitors"
  | "pageviews"
  | "bounce_rate"
  | "visit_duration"
  | "views_per_visit"
  | "events"
  | "conversion_rate";

export type PlausibleFilter = [string, string, string[]];

export type Section = "reports" | "news";

export const ALL_SECTIONS: Section[] = ["reports", "news"];

export interface MetricWidgetConfig {
  id: string;
  type: "metric";
  title: string;
  metric: PlausibleMetric;
  filters?: PlausibleFilter[];
  cols?: number;
}

export interface TimeseriesSeries {
  label: string;
  metric: PlausibleMetric;
  filters: PlausibleFilter[];
  color?: string;
}

export interface TimeseriesWidgetConfig {
  id: string;
  type: "timeseries";
  title: string;
  metrics: PlausibleMetric[];
  filters?: PlausibleFilter[];
  series?: TimeseriesSeries[];
  cols?: number;
}

export interface BreakdownWidgetConfig {
  id: string;
  type: "breakdown";
  title: string;
  dimension: string;
  metric: PlausibleMetric;
  filters?: PlausibleFilter[];
  limit?: number;
  cols?: number;
}

export interface PieWidgetConfig {
  id: string;
  type: "pie";
  title: string;
  dimension: string;
  metric: PlausibleMetric;
  filters?: PlausibleFilter[];
  limit?: number;
  cols?: number;
}

export interface ComputedMetricWidgetConfig {
  id: string;
  type: "computed";
  title: string;
  dimension: string;
  metric: PlausibleMetric;
  computation: "weighted_sum";
  filters?: PlausibleFilter[];
  cols?: number;
}

export interface ComputedTimeseriesWidgetConfig {
  id: string;
  type: "computed_timeseries";
  title: string;
  dimension: string;
  metric: PlausibleMetric;
  computation: "weighted_sum";
  filters?: PlausibleFilter[];
  cols?: number;
}

export interface ArticleBreakdownWidgetConfig {
  id: string;
  type: "article_breakdown";
  title: string;
  metric: PlausibleMetric;
  filters?: PlausibleFilter[];
  computed?: {
    dimension: string;
    computation: "weighted_sum";
  };
  baseUrl: string;
  limit?: number;
  cols?: number;
}

export interface EntityBreakdownWidgetConfig {
  id: string;
  type: "entity_breakdown";
  title: string;
  metric: PlausibleMetric;
  property: string;
  filters?: PlausibleFilter[];
  computed?: {
    dimension: string;
    computation: "weighted_sum";
  };
  baseUrl: string;
  formatLabel?: "article";
  limit?: number;
  cols?: number;
}

export type WidgetConfig =
  | MetricWidgetConfig
  | TimeseriesWidgetConfig
  | BreakdownWidgetConfig
  | PieWidgetConfig
  | ComputedMetricWidgetConfig
  | ComputedTimeseriesWidgetConfig
  | ArticleBreakdownWidgetConfig
  | EntityBreakdownWidgetConfig;
