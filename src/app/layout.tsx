import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import TopNav from "@/components/TopNav";

// Every page in this app reads session state and/or per-user DB rows, so there
// is nothing to statically prerender. Forcing dynamic at the root prevents
// build-time DB calls (e.g. /admin/monitor) from failing when migrations lag
// behind deploys.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "News View",
  description: "Plausible analytics and news aggregation for editors",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 min-h-screen`}
      >
        <TopNav
          email={session.email}
          isAdmin={session.isAdmin}
          sections={session.sections}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
