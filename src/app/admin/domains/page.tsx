import AllowedDomainsTable from "@/components/admin/AllowedDomainsTable";
import { listAccessDomains } from "@/lib/access";

export default async function AdminDomainsPage() {
  const domains = await listAccessDomains();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Allowed Domains</h1>
      <p className="mb-6 text-sm text-gray-600">
        Users whose email ends with a domain listed here get access to the
        selected sections. A specific email rule in{" "}
        <a href="/admin/users" className="text-blue-600 hover:underline">
          Allowed Users
        </a>{" "}
        overrides the domain.
      </p>
      <AllowedDomainsTable initial={domains} />
    </div>
  );
}
