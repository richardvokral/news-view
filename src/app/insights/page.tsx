import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listSiteIds, defaultSiteId } from "@/lib/plausible";
import { getInsightsConfig } from "@/lib/insights/store";
import { listInsightPrompts } from "@/lib/insights/promptStore";
import { listAiModels } from "@/lib/ai/models";
import InsightsPageShell from "@/components/insights/InsightsPageShell";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ site?: string; tab?: string }>;
}

export default async function InsightsPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  if (!session.sections.includes("insights")) redirect("/no-access");

  const sites = listSiteIds();
  const params = await searchParams;
  const currentSite =
    params.site && sites.includes(params.site)
      ? params.site
      : defaultSiteId() ?? sites[0] ?? "";

  const [config, prompts, models] = await Promise.all([
    getInsightsConfig(),
    listInsightPrompts(),
    listAiModels(),
  ]);

  return (
    <InsightsPageShell
      sites={sites}
      currentSite={currentSite}
      isAdmin={session.isAdmin}
      backfillWeeks={config.backfillWeeks}
      weeksPerRequest={config.weeksPerRequest}
      defaultTopN={config.aiTopArticles}
      prompts={prompts.map((p) => ({ key: p.key, label: p.label }))}
      models={models
        .filter((m) => m.enabled)
        .map((m) => ({ key: m.key, label: m.label }))}
      defaultModelKey={config.aiModelKey}
    />
  );
}
