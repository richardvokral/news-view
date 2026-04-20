"use client";

import { type ChangeEvent } from "react";

export type NumericOp = ">" | ">=" | "<" | "<=";

export interface NumericFilter {
  op: NumericOp;
  value: number;
}

export interface FiltersState {
  article: string;
  visitors: NumericFilter | null;
  pageviews: NumericFilter | null;
  trend: NumericFilter | null;
  firstHour: NumericFilter | null;
  firstSeenWithinHours: number | null;
}

export const EMPTY_FILTERS: FiltersState = {
  article: "",
  visitors: null,
  pageviews: null,
  trend: null,
  firstHour: null,
  firstSeenWithinHours: null,
};

interface Props {
  filters: FiltersState;
  onChange: (next: FiltersState) => void;
}

const OPS: NumericOp[] = [">", ">=", "<", "<="];

function NumericCell({
  label,
  filter,
  onChange,
}: {
  label: string;
  filter: NumericFilter | null;
  onChange: (next: NumericFilter | null) => void;
}) {
  const handleOp = (e: ChangeEvent<HTMLSelectElement>) => {
    const op = e.target.value as NumericOp;
    onChange({ op, value: filter?.value ?? 0 });
  };
  const handleValue = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange(null);
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    onChange({ op: filter?.op ?? ">", value: num });
  };
  return (
    <div className="flex items-center gap-1" aria-label={`Filter ${label}`}>
      <select
        value={filter?.op ?? ">"}
        onChange={handleOp}
        className="rounded border border-gray-200 bg-white px-1 py-0.5 text-xs text-gray-600"
      >
        {OPS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <input
        type="number"
        inputMode="numeric"
        placeholder={label}
        value={filter?.value ?? ""}
        onChange={handleValue}
        className="w-20 rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700 placeholder:text-gray-400"
      />
    </div>
  );
}

export default function MonitorFilters({ filters, onChange }: Props) {
  return (
    <tr className="border-b border-gray-100 bg-gray-50/50 text-xs">
      <td className="px-5 py-2">
        <input
          type="text"
          placeholder="Filter title or path…"
          value={filters.article}
          onChange={(e) => onChange({ ...filters, article: e.target.value })}
          className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end">
          <NumericCell
            label="visitors"
            filter={filters.visitors}
            onChange={(next) => onChange({ ...filters, visitors: next })}
          />
        </div>
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end">
          <NumericCell
            label="pageviews"
            filter={filters.pageviews}
            onChange={(next) => onChange({ ...filters, pageviews: next })}
          />
        </div>
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end">
          <NumericCell
            label="1h visits"
            filter={filters.firstHour}
            onChange={(next) => onChange({ ...filters, firstHour: next })}
          />
        </div>
      </td>
      <td className="px-5 py-2 text-right">
        <select
          value={filters.firstSeenWithinHours ?? ""}
          onChange={(e) =>
            onChange({
              ...filters,
              firstSeenWithinHours: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
          className="rounded border border-gray-200 bg-white px-1 py-0.5 text-xs text-gray-600"
        >
          <option value="">any</option>
          <option value="1">last 1h</option>
          <option value="3">last 3h</option>
          <option value="6">last 6h</option>
          <option value="12">last 12h</option>
          <option value="24">last 24h</option>
        </select>
      </td>
      <td className="px-5 py-2">
        <div className="flex">
          <NumericCell
            label="trend/m"
            filter={filters.trend}
            onChange={(next) => onChange({ ...filters, trend: next })}
          />
        </div>
      </td>
    </tr>
  );
}

export function applyNumericFilter(
  value: number,
  filter: NumericFilter | null
): boolean {
  if (!filter) return true;
  const { op, value: threshold } = filter;
  switch (op) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    default:
      return true;
  }
}
