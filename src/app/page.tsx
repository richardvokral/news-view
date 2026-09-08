import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function RootRedirect() {
  const session = await getSession();
  if (!session.email) redirect("/api/logto/sign-in");
  // Fall through every section, so a user granted only one of them lands on it
  // instead of /no-access — which is what a monitor-only user used to get.
  if (session.sections.includes("reports")) redirect("/reports");
  if (session.sections.includes("news")) redirect("/news");
  if (session.sections.includes("monitor")) redirect("/monitor");
  if (session.sections.includes("insights")) redirect("/insights");
  redirect("/no-access");
}
