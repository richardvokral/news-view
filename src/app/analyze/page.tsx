import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listSiteIds, defaultSiteId } from "@/lib/plausible";
import AnalyzeView from "@/components/analyze/AnalyzeView";

interface PageProps {
  searchParams: Promise<{ site?: string }>;
}

export default async function AnalyzePage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  if (!session.sections.includes("reports")) redirect("/no-access");

  const sites = listSiteIds();
  const params = await searchParams;
  const requested = params.site;
  const currentSite =
    requested && sites.includes(requested)
      ? requested
      : defaultSiteId() ?? sites[0] ?? "";

  return <AnalyzeView sites={sites} currentSite={currentSite} />;
}
