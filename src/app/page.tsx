import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function RootRedirect() {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  if (session.sections.includes("reports")) redirect("/reports");
  if (session.sections.includes("news")) redirect("/news");
  redirect("/no-access");
}
