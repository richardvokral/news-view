import Link from "next/link";
import { listSiteIds } from "@/lib/plausible";
import { getInsightsConfig } from "@/lib/insights/store";
import { listInsightPrompts } from "@/lib/insights/promptStore";
import { listAiModels } from "@/lib/ai/models";
import InsightsConfigForm from "@/components/admin/InsightsConfigForm";
import InsightsPromptsForm from "@/components/admin/InsightsPromptsForm";

export const dynamic = "force-dynamic";

export default async function AdminInsightsPage() {
  const [config, prompts, models] = await Promise.all([
    getInsightsConfig(),
    listInsightPrompts(),
    listAiModels(),
  ]);
  const sites = listSiteIds();

  return (
    <div>
      <Link
        href="/admin"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← Admin
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Insights</h1>
      <p className="mb-6 text-sm text-gray-600">
        Načítání týdenních dat z Plausible a nastavení AI analýzy témat. Data se
        nikdy nemažou; rozsah se volí u každé analýzy.
      </p>

      <InsightsConfigForm initial={config} sites={sites} models={models} />

      <h2 className="mb-3 mt-8 text-lg font-semibold text-gray-900">Prompty</h2>
      <p className="mb-4 text-sm text-gray-600">
        Upravitelná je jen role a zadání. Formát výstupu a pravidlo &bdquo;model
        nikdy nepíše čísla&ldquo; se připojují v kódu a nelze je promptem
        přepsat.
      </p>
      <InsightsPromptsForm initial={prompts} />
    </div>
  );
}
