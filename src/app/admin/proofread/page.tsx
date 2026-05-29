import Link from "next/link";

const TILES = [
  {
    href: "/admin/proofread/models",
    title: "Models",
    desc: "Enable / disable models, set prices and the system default.",
  },
  {
    href: "/admin/proofread/prompts",
    title: "Prompts",
    desc: "Edit the system prompt for each proofreading mode.",
  },
  {
    href: "/admin/proofread/users",
    title: "Per-user config",
    desc: "Override the model or prompt for a specific user.",
  },
  {
    href: "/admin/proofread/korektor",
    title: "Korektor (ÚFAL)",
    desc: "Optional Czech orthography pre-filter that runs before the LLM.",
  },
  {
    href: "/admin/proofread/usage",
    title: "Usage",
    desc: "Token usage and estimated cost by user and by model.",
  },
];

export default function ProofreadAdminHome() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">AI Proofreading</h1>
      <p className="mb-6 text-sm text-gray-600">
        Configuration for the Czech proofreading extension. Anyone with section
        access can use the proofreader; these pages control how it behaves.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:bg-gray-50"
          >
            <h2 className="font-semibold text-gray-900">{t.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
