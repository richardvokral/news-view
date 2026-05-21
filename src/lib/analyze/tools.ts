import { getAggregate, getTimeseries, getBreakdown } from "@/lib/plausible";
import {
  VALID_PERIODS,
  VALID_INTERVALS,
  MAX_LIMIT,
  validateMetrics,
} from "@/lib/plausible-validate";

export const TOOL_SCHEMAS = [
  {
    name: "plausible_aggregate",
    description:
      "Get an aggregated metric value (e.g. total visitors, pageviews) over a period. Use this for single-number questions like 'how many visitors last week?'.",
    input_schema: {
      type: "object" as const,
      properties: {
        metrics: {
          type: "string",
          description:
            "Comma-separated list. Allowed: visitors, visits, pageviews, views_per_visit, bounce_rate, visit_duration, events.",
        },
        period: {
          type: "string",
          description:
            "Time range. Allowed: day, 7d, 30d, month, 6mo, 12mo, custom. If 'custom' you must also pass `date` as 'YYYY-MM-DD,YYYY-MM-DD'.",
        },
        date: {
          type: "string",
          description:
            "Used with period='day' (single 'YYYY-MM-DD') or period='custom' ('YYYY-MM-DD,YYYY-MM-DD').",
        },
        filters: {
          type: "string",
          description:
            "Optional Plausible filter string. Format: 'property==value' joined by ';'. Examples: 'visit:source==seznam', 'event:page==/article/foo', 'visit:source==seznam;event:page==/'. Common properties: event:page, visit:source, visit:utm_source, visit:device, visit:country, event:props:name.",
        },
      },
      required: ["metrics"],
    },
  },
  {
    name: "plausible_timeseries",
    description:
      "Get a metric over time as a series of points. Use this whenever the question is about trends, declines, growth, comparisons over time, or 'when did X start to happen'.",
    input_schema: {
      type: "object" as const,
      properties: {
        metrics: {
          type: "string",
          description:
            "Comma-separated list. Allowed: visitors, visits, pageviews, views_per_visit, bounce_rate, visit_duration, events.",
        },
        period: {
          type: "string",
          description:
            "Allowed: day, 7d, 30d, month, 6mo, 12mo, custom. If 'custom' you must also pass `date`.",
        },
        date: {
          type: "string",
          description:
            "For period='custom': 'YYYY-MM-DD,YYYY-MM-DD'.",
        },
        filters: {
          type: "string",
          description:
            "Plausible filter string, same syntax as plausible_aggregate.",
        },
        interval: {
          type: "string",
          description:
            "Bucket size. Allowed: date (daily), month. Pick 'date' for ranges up to ~90 days, 'month' for longer.",
        },
      },
      required: ["metrics"],
    },
  },
  {
    name: "plausible_breakdown",
    description:
      "Get the top N values of a dimension ranked by a metric. Use this for 'which X had most Y' or 'where does my traffic come from' questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        property: {
          type: "string",
          description:
            "Dimension to break down by. Common values: visit:source, visit:utm_source, visit:device, visit:country, event:page, event:props:name.",
        },
        metrics: {
          type: "string",
          description:
            "Comma-separated metrics. Same allowed values as plausible_aggregate.",
        },
        period: { type: "string" },
        date: { type: "string" },
        filters: { type: "string" },
        limit: {
          type: "number",
          description: `Max rows. Capped at ${MAX_LIMIT}. Default 10 if omitted.`,
        },
      },
      required: ["property", "metrics"],
    },
  },
];

export type ToolName =
  | "plausible_aggregate"
  | "plausible_timeseries"
  | "plausible_breakdown";

interface AggregateInput {
  metrics: string;
  period?: string;
  date?: string;
  filters?: string;
}
interface TimeseriesInput extends AggregateInput {
  interval?: string;
}
interface BreakdownInput extends AggregateInput {
  property: string;
  limit?: number;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function validateCommon(input: AggregateInput): string | null {
  if (!input.metrics || typeof input.metrics !== "string") {
    return "metrics is required";
  }
  if (!validateMetrics(input.metrics)) {
    return `Invalid metric in '${input.metrics}'. Allowed: visitors, visits, pageviews, views_per_visit, bounce_rate, visit_duration, events.`;
  }
  if (input.period && !VALID_PERIODS.has(input.period)) {
    return `Invalid period '${input.period}'. Allowed: day, 7d, 30d, month, 6mo, 12mo, custom.`;
  }
  if (input.period === "custom" && !input.date) {
    return "period='custom' requires a `date` like 'YYYY-MM-DD,YYYY-MM-DD'.";
  }
  return null;
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  siteId: string
): Promise<unknown> {
  if (rawInput === null || typeof rawInput !== "object") {
    throw new Error("Tool input must be an object");
  }
  const input = rawInput as Record<string, unknown>;

  if (name === "plausible_aggregate") {
    const params: AggregateInput = {
      metrics: String(input.metrics ?? ""),
      period: asString(input.period),
      date: asString(input.date),
      filters: asString(input.filters),
    };
    const err = validateCommon(params);
    if (err) throw new Error(err);
    return getAggregate(siteId, params);
  }

  if (name === "plausible_timeseries") {
    const interval = asString(input.interval);
    if (interval && !VALID_INTERVALS.has(interval)) {
      throw new Error(
        `Invalid interval '${interval}'. Allowed: date, month.`
      );
    }
    const params: TimeseriesInput = {
      metrics: String(input.metrics ?? ""),
      period: asString(input.period),
      date: asString(input.date),
      filters: asString(input.filters),
      interval,
    };
    const err = validateCommon(params);
    if (err) throw new Error(err);
    return getTimeseries(siteId, params);
  }

  if (name === "plausible_breakdown") {
    const property = asString(input.property);
    if (!property) throw new Error("property is required");
    const rawLimit = asNumber(input.limit);
    const params: BreakdownInput = {
      property,
      metrics: String(input.metrics ?? ""),
      period: asString(input.period),
      date: asString(input.date),
      filters: asString(input.filters),
      limit: rawLimit ? Math.min(Math.max(1, Math.floor(rawLimit)), MAX_LIMIT) : 10,
    };
    const err = validateCommon(params);
    if (err) throw new Error(err);
    return getBreakdown(siteId, params);
  }

  throw new Error(`Unknown tool: ${name}`);
}

export function summariseToolResult(data: unknown): unknown {
  if (data && typeof data === "object" && "results" in data) {
    const results = (data as { results: unknown }).results;
    if (Array.isArray(results) && results.length > 5) {
      return {
        ...(data as object),
        results: results.slice(0, 5),
        _truncated: `showing 5 of ${results.length} rows (full payload sent to AI)`,
      };
    }
  }
  return data;
}
