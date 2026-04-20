"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import MonitorDashboard from "./MonitorDashboard";
import CoverageTab from "./CoverageTab";

interface Props {
  sites: string[];
  currentSite: string;
  siteBaseUrl: string;
  defaultHours: number;
  trendWindowMinutes: number;
  sourceTimeseriesEnabled: boolean;
  showArticleImages: boolean;
  authorShortNames: Record<string, string>;
  enabled: boolean;
  isAdmin: boolean;
  coverageAvailable: boolean;
}

type Tab = "monitor" | "coverage";

export default function MonitorPageShell(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "coverage" ? "coverage" : "monitor";

  const setTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "monitor") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <div>
      <div className="mb-5 flex items-center gap-1 border-b border-gray-200">
        <TabButton
          label="Monitor"
          active={tab === "monitor"}
          onClick={() => setTab("monitor")}
        />
        <TabButton
          label="Coverage"
          active={tab === "coverage"}
          onClick={() => setTab("coverage")}
          badge={props.coverageAvailable ? undefined : "off"}
        />
      </div>

      {tab === "monitor" ? (
        <MonitorDashboard
          sites={props.sites}
          currentSite={props.currentSite}
          siteBaseUrl={props.siteBaseUrl}
          defaultHours={props.defaultHours}
          trendWindowMinutes={props.trendWindowMinutes}
          sourceTimeseriesEnabled={props.sourceTimeseriesEnabled}
          showArticleImages={props.showArticleImages}
          authorShortNames={props.authorShortNames}
          enabled={props.enabled}
          isAdmin={props.isAdmin}
        />
      ) : (
        <CoverageTab
          site={props.currentSite}
          siteBaseUrl={props.siteBaseUrl}
          isAdmin={props.isAdmin}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border border-b-white border-gray-200 bg-white text-gray-900"
          : "text-gray-500 hover:text-gray-800"
      }`}
    >
      {label}
      {badge && (
        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
          {badge}
        </span>
      )}
    </button>
  );
}
