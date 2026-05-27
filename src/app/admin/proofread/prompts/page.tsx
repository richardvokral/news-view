import Link from "next/link";
import ProofreadPromptsForm from "@/components/admin/ProofreadPromptsForm";
import { listPrompts } from "@/lib/proofread/store";

export default async function ProofreadPromptsPage() {
  const prompts = await listPrompts();
  return (
    <div>
      <Link
        href="/admin/proofread"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← AI Proofreading
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Prompts</h1>
      <p className="mb-6 text-sm text-gray-600">
        One system prompt per mode. The default mode is used when the extension
        doesn&apos;t request a specific one. HTML-preservation rules are appended
        automatically.
      </p>
      <ProofreadPromptsForm initial={prompts} />
    </div>
  );
}
