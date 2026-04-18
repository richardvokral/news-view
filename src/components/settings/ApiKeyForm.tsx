"use client";

import { useState, useEffect } from "react";
import { ApiConfig } from "@/lib/fetchers/types";

interface TestResult {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
}

export default function ApiKeyForm() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [newExcludeWord, setNewExcludeWord] = useState("");
  const [dumping, setDumping] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data.excludeWords)) data.excludeWords = [];
        setConfig(data);
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

  const testApi = async (service: string) => {
    setTestResults((prev) => ({ ...prev, [service]: { status: "testing" } }));
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResults((prev) => ({
          ...prev,
          [service]: { status: "success", message: data.message || "OK" },
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [service]: { status: "error", message: data.error || "Failed" },
        }));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [service]: { status: "error", message: String(err) },
      }));
    }
  };

  const addExcludeWord = () => {
    if (!config || !newExcludeWord.trim()) return;
    const word = newExcludeWord.trim().toLowerCase();
    if (config.excludeWords.includes(word)) return;
    setConfig({ ...config, excludeWords: [...config.excludeWords, word] });
    setNewExcludeWord("");
  };

  const removeExcludeWord = (word: string) => {
    if (!config) return;
    setConfig({
      ...config,
      excludeWords: config.excludeWords.filter((w) => w !== word),
    });
  };

  const dumpData = async () => {
    setDumping(true);
    try {
      const res = await fetch("/api/dump");
      if (!res.ok) throw new Error("Dump failed");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `news-view-dump-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ type: "error", text: `Dump failed: ${err}` });
    } finally {
      setDumping(false);
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
            service="worldNewsApi"
            enabled={config.worldNewsApi.enabled}
            apiKey={config.worldNewsApi.apiKey}
            onToggle={(enabled) =>
              setConfig({ ...config, worldNewsApi: { ...config.worldNewsApi, enabled } })
            }
            onKeyChange={(apiKey) =>
              setConfig({ ...config, worldNewsApi: { ...config.worldNewsApi, apiKey } })
            }
            testResult={testResults["worldNewsApi"]}
            onTest={() => testApi("worldNewsApi")}
          />
          <ApiSourceField
            label="NewsDataHub"
            service="newsDataHub"
            enabled={config.newsDataHub.enabled}
            apiKey={config.newsDataHub.apiKey}
            onToggle={(enabled) =>
              setConfig({ ...config, newsDataHub: { ...config.newsDataHub, enabled } })
            }
            onKeyChange={(apiKey) =>
              setConfig({ ...config, newsDataHub: { ...config.newsDataHub, apiKey } })
            }
            testResult={testResults["newsDataHub"]}
            onTest={() => testApi("newsDataHub")}
          />
          <ApiSourceField
            label="GNews"
            service="gnews"
            enabled={config.gnews.enabled}
            apiKey={config.gnews.apiKey}
            onToggle={(enabled) =>
              setConfig({ ...config, gnews: { ...config.gnews, enabled } })
            }
            onKeyChange={(apiKey) =>
              setConfig({ ...config, gnews: { ...config.gnews, apiKey } })
            }
            testResult={testResults["gnews"]}
            onTest={() => testApi("gnews")}
          />
          <ApiSourceField
            label="Twitter / X"
            service="twitter"
            enabled={config.twitter.enabled}
            apiKey={config.twitter.bearerToken}
            onToggle={(enabled) =>
              setConfig({ ...config, twitter: { ...config.twitter, enabled } })
            }
            onKeyChange={(bearerToken) =>
              setConfig({ ...config, twitter: { ...config.twitter, bearerToken } })
            }
            keyLabel="Bearer Token"
            testResult={testResults["twitter"]}
            onTest={() => testApi("twitter")}
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
                    mode: e.target.value as "keywords" | "ai" | "ai-openai",
                  },
                })
              }
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="keywords">Keywords (free)</option>
              <option value="ai">Claude AI</option>
              <option value="ai-openai">OpenAI (GPT-4o mini)</option>
            </select>
          </div>
          {config.clustering.mode === "ai" && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-24">Anthropic:</label>
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
              <TestButton
                result={testResults["anthropic"]}
                onTest={() => testApi("anthropic")}
              />
            </div>
          )}
          {config.clustering.mode === "ai-openai" && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-24">OpenAI:</label>
              <input
                type="password"
                value={config.clustering.openaiApiKey}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    clustering: {
                      ...config.clustering,
                      openaiApiKey: e.target.value,
                    },
                  })
                }
                placeholder="sk-..."
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <TestButton
                result={testResults["openai"]}
                onTest={() => testApi("openai")}
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Exclude Topics</h3>
        <p className="text-xs text-gray-500 mb-3">
          Topics containing these words will be hidden from the dashboard.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {config.excludeWords.map((word) => (
            <span
              key={word}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
            >
              {word}
              <button
                onClick={() => removeExcludeWord(word)}
                className="text-gray-400 hover:text-red-500 font-bold ml-0.5"
              >
                x
              </button>
            </span>
          ))}
          {config.excludeWords.length === 0 && (
            <span className="text-xs text-gray-400">No exclude words set</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newExcludeWord}
            onChange={(e) => setNewExcludeWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addExcludeWord()}
            placeholder="e.g. sports, celebrity..."
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addExcludeWord}
            className="px-4 py-1.5 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 transition-colors"
          >
            Add
          </button>
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

      <div className="flex gap-3">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <button
          onClick={dumpData}
          disabled={dumping}
          className="px-6 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200 border border-gray-300 disabled:opacity-50 transition-colors"
        >
          {dumping ? "Dumping..." : "Dump All Data"}
        </button>
      </div>
    </div>
  );
}

function ApiSourceField({
  label,
  service,
  enabled,
  apiKey,
  onToggle,
  onKeyChange,
  keyLabel = "API Key",
  testResult,
  onTest,
}: {
  label: string;
  service: string;
  enabled: boolean;
  apiKey: string;
  onToggle: (enabled: boolean) => void;
  onKeyChange: (key: string) => void;
  keyLabel?: string;
  testResult?: TestResult;
  onTest: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <button
        onClick={() => onToggle(!enabled)}
        className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${
          enabled ? "bg-blue-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "left-5" : "left-0.5"
          }`}
        />
      </button>
      <span className="text-sm font-medium text-gray-700 w-28 flex-shrink-0">{label}</span>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => onKeyChange(e.target.value)}
        placeholder={keyLabel}
        disabled={!enabled}
        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
      />
      <TestButton result={testResult} onTest={onTest} disabled={!enabled} />
    </div>
  );
}

function TestButton({
  result,
  onTest,
  disabled,
}: {
  result?: TestResult;
  onTest: () => void;
  disabled?: boolean;
}) {
  const status = result?.status || "idle";

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        onClick={onTest}
        disabled={disabled || status === "testing"}
        className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {status === "testing" ? "..." : "Test"}
      </button>
      {status === "success" && (
        <span className="text-green-500 text-sm" title={result?.message}>
          OK
        </span>
      )}
      {status === "error" && (
        <span className="text-red-500 text-xs max-w-24 truncate" title={result?.message}>
          {result?.message || "Fail"}
        </span>
      )}
    </div>
  );
}
