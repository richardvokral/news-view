import Link from "next/link";
import ProofreadModelsTable from "@/components/admin/ProofreadModelsTable";
import { listModels, getDefaultModelKey } from "@/lib/proofread/store";

export default async function ProofreadModelsPage() {
  const [models, defaultModelKey] = await Promise.all([
    listModels(),
    getDefaultModelKey(),
  ]);
  return (
    <div>
      <Link
        href="/admin/proofread"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← AI Proofreading
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Models</h1>
      <p className="mb-6 text-sm text-gray-600">
        Prices are USD per 1M tokens. The system default is used unless a user
        has a per-user override. Disabled models can&apos;t be selected.
      </p>
      <ProofreadModelsTable
        initial={models}
        initialDefaultKey={defaultModelKey}
      />
    </div>
  );
}
