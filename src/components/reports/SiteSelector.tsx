"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface Props {
  sites: string[];
  current: string;
}

export default function SiteSelector({ sites, current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (sites.length === 0) {
    return <span className="text-sm text-gray-400">No site configured</span>;
  }
  if (sites.length === 1) {
    return <span className="text-sm font-medium text-gray-700">{current}</span>;
  }

  return (
    <select
      value={current}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("site", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      aria-label="Select site"
    >
      {sites.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
