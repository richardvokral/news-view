"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="font-bold text-lg text-gray-900">
            News View
          </Link>
          <nav className="flex gap-4">
            <Link
              href="/"
              className={`text-sm font-medium ${
                pathname === "/"
                  ? "text-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/settings"
              className={`text-sm font-medium ${
                pathname === "/settings"
                  ? "text-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Settings
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
