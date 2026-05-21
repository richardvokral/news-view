"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Section } from "@/types/dashboard";

interface Props {
  email: string | null;
  isAdmin: boolean;
  sections: Section[];
}

export default function TopNav({ email, isAdmin, sections }: Props) {
  const pathname = usePathname();
  const active = (href: string) =>
    pathname === href || pathname.startsWith(href + "/")
      ? "text-blue-600"
      : "text-gray-500 hover:text-gray-700";

  return (
    <header className="border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-lg font-bold text-gray-900">
          News View
        </Link>
        <nav className="flex items-center gap-6">
          {sections.includes("reports") && (
            <Link
              href="/reports"
              className={`text-sm font-medium ${active("/reports")}`}
            >
              Analytics
            </Link>
          )}
          {sections.includes("monitor") && (
            <Link
              href="/monitor"
              className={`text-sm font-medium ${active("/monitor")}`}
            >
              Monitor
            </Link>
          )}
          {sections.includes("news") && (
            <Link
              href="/news"
              className={`text-sm font-medium ${active("/news")}`}
            >
              News
            </Link>
          )}
          {email && (
            <Link
              href="/analyze"
              className={`text-sm font-medium ${active("/analyze")}`}
            >
              Analyze
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className={`text-sm font-medium ${active("/admin")}`}
            >
              Admin
            </Link>
          )}
          {email && (
            <div className="flex items-center gap-3 border-l border-gray-200 pl-6">
              <span className="text-xs text-gray-500" title={email}>
                {email}
              </span>
              <a
                href="/api/logto/sign-out"
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Sign out
              </a>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
