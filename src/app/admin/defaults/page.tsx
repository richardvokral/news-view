import { listSiteIds, defaultSiteId } from "@/lib/plausible";
import Dashboard from "@/components/reports/Dashboard";

interface PageProps {
  searchParams: Promise<{ site?: string }>;
}

export default async function AdminDefaultsPage({ searchParams }: PageProps) {
  const sites = listSiteIds();
  const params = await searchParams;
  const requested = params.site;
  const currentSite =
    requested && sites.includes(requested)
      ? requested
      : defaultSiteId() ?? sites[0] ?? "";

  return (
    <div>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Edit the dashboard below, then pick{" "}
        <strong>Save as Default for Everyone</strong> from the Save dropdown to
        persist it as the shared default layout.
      </div>
      <Dashboard isAdmin={true} sites={sites} currentSite={currentSite} />
    </div>
  );
}
