import Link from "next/link";
import ProofreadKorektorForm from "@/components/admin/ProofreadKorektorForm";
import { getKorektorConfig } from "@/lib/proofread/store";

export default async function ProofreadKorektorPage() {
  const config = await getKorektorConfig();
  return (
    <div>
      <Link
        href="/admin/proofread"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← AI Proofreading
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Korektor (ÚFAL)</h1>
      <p className="mb-6 text-sm text-gray-600">
        Korektor is a Czech spell/grammar checker from Charles University. When
        enabled it runs as a first stage before the LLM, catching
        high-precision orthography fixes cheaply so the model can focus on
        punctuation, grammar and style.
      </p>
      <ProofreadKorektorForm initial={config} />
    </div>
  );
}
