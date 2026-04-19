import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import NewsDashboard from "@/components/news/NewsDashboard";

export default async function NewsPage() {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  if (!session.sections.includes("news")) redirect("/no-access");
  return <NewsDashboard />;
}
