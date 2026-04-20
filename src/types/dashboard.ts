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

export type Section = "reports" | "news" | "monitor";

export const ALL_SECTIONS: Section[] = ["reports", "news", "monitor"];

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

// --- Monitor (Phase B) ---

export interface MonitorConfig {
  enabled: boolean;
  intervalSeconds: number;
  windowHours: number;
  retentionDays: number;
  maxRequestsPerHour: number;
  sitePatterns: Record<string, string>;
  sourceSamplingEnabled: boolean;
  sourceSamplingTopN: number;
  trendWindowMinutes: number;
  sourceTimeseriesEnabled: boolean;
  excludedSources: string[];
  rssEnabled: boolean;
  siteRssUrls: Record<string, string>;
  showArticleImages: boolean;
  authorShortNames: Record<string, string>;
  authorSamplingEnabled: boolean;
  topSourcesLimit: number;
  externalRssEnabled: boolean;
  externalRssUrls: string[];
  coverageEnabled: boolean;
  coverageWindowHours: number;
  coverageModel: string;
  googleTrendsEnabled: boolean;
  googleTrendsLocales: string[];
  updatedBy: string | null;
  updatedAt: string | null;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  enabled: false,
  intervalSeconds: 300,
  windowHours: 48,
  retentionDays: 7,
  maxRequestsPerHour: 240,
  sitePatterns: {},
  sourceSamplingEnabled: false,
  sourceSamplingTopN: 10,
  trendWindowMinutes: 60,
  sourceTimeseriesEnabled: false,
  excludedSources: [],
  rssEnabled: false,
  siteRssUrls: {},
  showArticleImages: false,
  authorShortNames: {},
  authorSamplingEnabled: false,
  topSourcesLimit: 10,
  externalRssEnabled: false,
  externalRssUrls: [],
  coverageEnabled: false,
  coverageWindowHours: 24,
  coverageModel: "claude-haiku-4-5-20251001",
  googleTrendsEnabled: false,
  googleTrendsLocales: ["CZ", "DE", "US"],
  updatedBy: null,
  updatedAt: null,
};
