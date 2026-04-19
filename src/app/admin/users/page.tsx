import AllowedUsersTable from "@/components/admin/AllowedUsersTable";
import { listAccessUsers } from "@/lib/access";

export default async function AdminUsersPage() {
  const users = await listAccessUsers();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Allowed Users</h1>
      <p className="mb-6 text-sm text-gray-600">
        An exact email match overrides any domain rule. Admins (set via
        <code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs">ADMIN_EMAILS</code>)
        are not listed here and always have access.
      </p>
      <AllowedUsersTable initial={users} />
    </div>
  );
}
