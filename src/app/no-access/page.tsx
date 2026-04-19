import { getSession } from "@/lib/auth";

export default async function NoAccessPage() {
  const session = await getSession();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">No access yet</h1>
        <p className="mt-2 text-sm text-gray-600">
          You are signed in as{" "}
          <strong className="text-gray-900">{session.email ?? "(unknown)"}</strong>.
          Ask your administrator to grant access to Analytics or News.
        </p>
        <a
          href="/api/logto/sign-out"
          className="mt-6 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
