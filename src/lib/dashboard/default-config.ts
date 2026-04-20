import type { WidgetConfig } from "@/types/dashboard";

// Static fallback used when no admin default and no user layout exist.
// Focused on a news site's core Plausible metrics; admin can customize
// and "Save as Default" to override this.
export const defaultDashboardConfig: WidgetConfig[] = [
  { id: "visitors", type: "metric", title: "Visitors", metric: "visitors" },
  { id: "pageviews", type: "metric", title: "Pageviews", metric: "pageviews" },
  { id: "bounce-rate", type: "metric", title: "Bounce Rate", metric: "bounce_rate" },
  { id: "visit-duration", type: "metric", title: "Avg. Visit Duration", metric: "visit_duration" },
  { id: "views-per-visit", type: "metric", title: "Views / Visit", metric: "views_per_visit" },

  {
    id: "traffic-chart",
    type: "timeseries",
    title: "Visitors & Pageviews",
    metrics: ["visitors", "pageviews"],
    cols: 2,
  },

  {
    id: "top-pages",
    type: "breakdown",
    title: "Top Pages",
    dimension: "event:page",
    metric: "pageviews",
    limit: 10,
  },
  {
    id: "sources",
    type: "breakdown",
    title: "Traffic Sources",
    dimension: "visit:source",
    metric: "visitors",
    limit: 10,
  },
  {
    id: "countries",
    type: "breakdown",
    title: "Countries",
    dimension: "visit:country",
    metric: "visitors",
    limit: 10,
  },
  {
    id: "entry-pages",
    type: "breakdown",
    title: "Entry Pages",
    dimension: "visit:entry_page",
    metric: "visitors",
    limit: 10,
  },

  {
    id: "devices",
    type: "pie",
    title: "Devices",
    dimension: "visit:device",
    metric: "visitors",
  },
  {
    id: "browsers",
    type: "pie",
    title: "Browsers",
    dimension: "visit:browser",
    metric: "visitors",
    limit: 6,
  },
];
