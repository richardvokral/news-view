import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listSiteIds, defaultSiteId } from "@/lib/plausible";
import Dashboard from "@/components/reports/Dashboard";

interface PageProps {
  searchParams: Promise<{ site?: string }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
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

  return (
    <Dashboard
      isAdmin={session.isAdmin}
      sites={sites}
      currentSite={currentSite}
    />
  );
}
