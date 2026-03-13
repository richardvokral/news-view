"use client";

import { useState, useEffect } from "react";
import { ApiConfig } from "@/lib/fetchers/types";

export default function ApiKeyForm() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        setConfig(await res.json());
      }
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved" });
        loadConfig();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Save failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading settings...</div>;
  }

  if (!config) {
    return <div className="text-red-500 text-sm">Failed to load settings</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">News API Sources</h3>
        <div className="space-y-4">
          <ApiSourceField
            label="WorldNewsAPI"
            enabled={config.worldNewsApi.enabled}
            apiKey={config.worldNewsApi.apiKey}
            onToggle={(enabled) =>
              setConfig({ ...config, worldNewsApi: { ...config.worldNewsApi, enabled } })
            }
            onKeyChange={(apiKey) =>
              setConfig({ ...config, worldNewsApi: { ...config.worldNewsApi, apiKey } })
            }
          />
          <ApiSourceField
            label="NewsDataHub"
            enabled={config.newsDataHub.enabled}
            apiKey={config.newsDataHub.apiKey}
            onToggle={(enabled) =>
              setConfig({ ...config, newsDataHub: { ...config.newsDataHub, enabled } })
            }
            onKeyChange={(apiKey) =>
              setConfig({ ...config, newsDataHub: { ...config.newsDataHub, apiKey } })
            }
          />
          <ApiSourceField
            label="GNews"
            enabled={config.gnews.enabled}
            apiKey={config.gnews.apiKey}
            onToggle={(enabled) =>
              setConfig({ ...config, gnews: { ...config.gnews, enabled } })
            }
            onKeyChange={(apiKey) =>
              setConfig({ ...config, gnews: { ...config.gnews, apiKey } })
            }
          />
          <ApiSourceField
            label="Twitter / X"
            enabled={config.twitter.enabled}
            apiKey={config.twitter.bearerToken}
            onToggle={(enabled) =>
              setConfig({ ...config, twitter: { ...config.twitter, enabled } })
            }
            onKeyChange={(bearerToken) =>
              setConfig({ ...config, twitter: { ...config.twitter, bearerToken } })
            }
            keyLabel="Bearer Token"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Topic Clustering</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 w-24">Mode:</label>
            <select
              value={config.clustering.mode}
              onChange={(e) =>
                setConfig({
                  ...config,
                  clustering: {
                    ...config.clustering,
                    mode: e.target.value as "keywords" | "ai",
                  },
                })
              }
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="keywords">Keywords (free)</option>
              <option value="ai">Claude AI (better quality)</option>
            </select>
          </div>
          {config.clustering.mode === "ai" && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-24">API Key:</label>
              <input
                type="password"
                value={config.clustering.anthropicApiKey}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    clustering: {
                      ...config.clustering,
                      anthropicApiKey: e.target.value,
                    },
                  })
                }
                placeholder="sk-ant-..."
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`text-sm px-4 py-2 rounded-md ${
            message.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        onClick={saveConfig}
        disabled={saving}
        className="px-6 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}

function ApiSourceField({
  label,
  enabled,
  apiKey,
  onToggle,
  onKeyChange,
  keyLabel = "API Key",
}: {
  label: string;
  enabled: boolean;
  apiKey: string;
  onToggle: (enabled: boolean) => void;
  onKeyChange: (key: string) => void;
  keyLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <button
        onClick={() => onToggle(!enabled)}
        className={`w-10 h-5 rounded-full transition-colors relative ${
          enabled ? "bg-blue-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "left-5" : "left-0.5"
          }`}
        />
      </button>
      <span className="text-sm font-medium text-gray-700 w-28">{label}</span>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => onKeyChange(e.target.value)}
        placeholder={keyLabel}
        disabled={!enabled}
        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  );
}
