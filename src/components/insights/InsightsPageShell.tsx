"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ArticlesTab from "./ArticlesTab";
import ThemesTab from "./ThemesTab";

export interface InsightsShellProps {
  sites: string[];
  currentSite: string;
  isAdmin: boolean;
  backfillWeeks: number;
  weeksPerRequest: number;
  defaultTopN: number;
  prompts: { key: string; label: string }[];
  models: { key: string; label: string }[];
  defaultModelKey: string | null;
}

type Tab = "articles" | "themes";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

export default function InsightsPageShell(props: InsightsShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Tab and site live in the URL, matching /monitor. The default tab is the
  // absence of the param so a bare /insights link stays clean.
  const tab: Tab = searchParams.get("tab") === "themes" ? "themes" : "articles";

  const updateParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const setTab = useCallback(
    (next: Tab) =>
      updateParams((p) => {
        if (next === "articles") p.delete("tab");
        else p.set("tab", next);
      }),
    [updateParams]
  );

  if (props.sites.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Insights</h1>
        <p className="mt-2 text-sm text-gray-600">
          Není nakonfigurován žádný web. Nastavte{" "}
          <code className="rounded bg-gray-100 px-1">PLAUSIBLE_SITE_IDS</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Insights</h1>
          <p className="text-xs text-gray-500">
            Nejčtenější články a témata z uložených týdenních dat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {props.sites.length > 1 && (
            <select
              value={props.currentSite}
              onChange={(e) =>
                updateParams((p) => p.set("site", e.target.value))
              }
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {props.sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="mb-5 flex gap-6 border-b border-gray-200">
        <TabButton active={tab === "articles"} onClick={() => setTab("articles")}>
          Články
        </TabButton>
        <TabButton active={tab === "themes"} onClick={() => setTab("themes")}>
          Témata
        </TabButton>
      </div>

      {tab === "articles" ? (
        <ArticlesTab
          site={props.currentSite}
          backfillWeeks={props.backfillWeeks}
          weeksPerRequest={props.weeksPerRequest}
        />
      ) : (
        <ThemesTab
          site={props.currentSite}
          prompts={props.prompts}
          models={props.models}
          defaultModelKey={props.defaultModelKey}
          defaultTopN={props.defaultTopN}
        />
      )}
    </div>
  );
}
