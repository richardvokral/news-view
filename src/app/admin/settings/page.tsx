import ApiKeyForm from "@/components/settings/ApiKeyForm";

export default function AdminSettingsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">App Settings</h1>
      <p className="mb-6 text-sm text-gray-600">
        News pipeline configuration. API keys can also be provided via
        environment variables.
      </p>
      <ApiKeyForm />
    </div>
  );
}
