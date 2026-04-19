import { getMonitorConfig } from "@/lib/monitor/config";
import { listSiteIds } from "@/lib/plausible";
import MonitorConfigForm from "@/components/admin/MonitorConfigForm";

export default async function AdminMonitorPage() {
  const config = await getMonitorConfig();
  const sites = listSiteIds();
  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">
        Article Monitor
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        Periodically pull per-article pageviews from Plausible so users with
        the <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">monitor</code>{" "}
        section can watch fresh articles in near-real time. Point Upstash
        QStash at{" "}
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
          /api/cron/article-monitor
        </code>{" "}
        with a <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">Authorization: Bearer $CRON_SECRET</code>{" "}
        header at the interval below.
      </p>
      <MonitorConfigForm initial={config} sites={sites} />
    </div>
  );
}
