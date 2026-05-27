import Link from "next/link";
import ProofreadUserConfigTable from "@/components/admin/ProofreadUserConfigTable";
import { listUserConfigs, listModels } from "@/lib/proofread/store";

export default async function ProofreadUsersPage() {
  const [configs, models] = await Promise.all([
    listUserConfigs(),
    listModels(),
  ]);
  return (
    <div>
      <Link
        href="/admin/proofread"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← AI Proofreading
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Per-user config</h1>
      <p className="mb-6 text-sm text-gray-600">
        Override the model and/or prompt for a specific user. Leave a field
        empty to fall back to the system default. A row has no effect until the
        user is granted section access.
      </p>
      <ProofreadUserConfigTable initial={configs} models={models} />
    </div>
  );
}
