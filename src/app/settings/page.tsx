"use client";

import PasswordGate from "@/components/settings/PasswordGate";
import ApiKeyForm from "@/components/settings/ApiKeyForm";

export default function SettingsPage() {
  return (
    <PasswordGate>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>
        <ApiKeyForm />
      </div>
    </PasswordGate>
  );
}
