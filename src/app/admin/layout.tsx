import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  if (!session.isAdmin) redirect("/no-access");
  return <div>{children}</div>;
}
