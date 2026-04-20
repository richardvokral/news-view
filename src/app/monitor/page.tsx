import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listSiteIds, defaultSiteId } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { siteBaseUrl } from "@/lib/monitor/site-urls";
import MonitorPageShell from "@/components/monitor/MonitorPageShell";

interface PageProps {
  searchParams: Promise<{ site?: string; tab?: string }>;
}

export default async function MonitorPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  if (!session.sections.includes("monitor")) redirect("/no-access");

  const sites = listSiteIds();
  const params = await searchParams;
  const requested = params.site;
  const currentSite =
    requested && sites.includes(requested)
      ? requested
      : defaultSiteId() ?? sites[0] ?? "";

  const cfg = await getMonitorConfig();

  return (
    <MonitorPageShell
      sites={sites}
      currentSite={currentSite}
      siteBaseUrl={currentSite ? siteBaseUrl(currentSite) : ""}
      defaultHours={cfg.windowHours}
      trendWindowMinutes={cfg.trendWindowMinutes}
      sourceTimeseriesEnabled={cfg.sourceTimeseriesEnabled}
      showArticleImages={cfg.showArticleImages}
      authorShortNames={cfg.authorShortNames}
      enabled={cfg.enabled}
      isAdmin={session.isAdmin}
      coverageAvailable={cfg.externalRssEnabled || cfg.coverageEnabled}
      googleTrendsEnabled={cfg.googleTrendsEnabled}
    />
  );
}
