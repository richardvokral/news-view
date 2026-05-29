import Link from "next/link";
import MigrateButton from "@/components/admin/MigrateButton";

export default function AdminDatabasePage() {
  return (
    <div>
      <Link
        href="/admin"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← Admin
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Database</h1>
      <p className="mb-6 text-sm text-gray-600">
        Apply database schema updates after a deploy that adds new tables or
        columns (e.g. the AI proofreading and Korektor features).
      </p>
      <MigrateButton />
    </div>
  );
}
