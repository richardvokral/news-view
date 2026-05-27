import Link from "next/link";
import ProofreadUsageView from "@/components/admin/ProofreadUsageView";
import { aggregateByUser, aggregateByModel } from "@/lib/proofread/usage";

export default async function ProofreadUsagePage() {
  const [byUser, byModel] = await Promise.all([
    aggregateByUser(),
    aggregateByModel(),
  ]);
  return (
    <div>
      <Link
        href="/admin/proofread"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← AI Proofreading
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Usage</h1>
      <p className="mb-6 text-sm text-gray-600">
        Token usage and estimated cost. Article text is never stored.
      </p>
      <ProofreadUsageView byUser={byUser} byModel={byModel} />
    </div>
  );
}
