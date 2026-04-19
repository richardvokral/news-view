import Link from "next/link";

const TILES = [
  {
    href: "/admin/users",
    title: "Allowed Users",
    desc: "Grant access by exact email. An email match overrides any domain rule.",
  },
  {
    href: "/admin/domains",
    title: "Allowed Domains",
    desc: "Grant access to everyone on a domain (e.g. example.com).",
  },
  {
    href: "/admin/defaults",
    title: "Dashboard Default",
    desc: "Edit the default Plausible dashboard layout for everyone.",
  },
  {
    href: "/admin/monitor",
    title: "Article Monitor",
    desc: "Enable / tune the per-article near-real-time tracker.",
  },
  {
    href: "/admin/settings",
    title: "App Settings",
    desc: "News pipeline API keys and clustering mode.",
  },
];

export default function AdminHome() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Admin</h1>
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
