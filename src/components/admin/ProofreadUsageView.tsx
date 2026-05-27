import type {
  UsageByUser,
  UsageByModel,
  UsageRow,
} from "@/lib/proofread/usage";

function fmtUsd(n: number) {
  return `$${n.toFixed(4)}`;
}
function fmtCzk(n: number) {
  return `${n.toFixed(2)} Kč`;
}
function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}
function fmtTime(iso: string) {
  return iso ? iso.replace("T", " ").slice(0, 16) : "";
}

const thCls =
  "px-5 py-3 text-left text-xs font-medium uppercase text-gray-500";
const thRight = "px-5 py-3 text-right text-xs font-medium uppercase text-gray-500";
const tdCls = "px-5 py-3 text-gray-700";
const tdRight = "px-5 py-3 text-right text-gray-700";

export default function ProofreadUsageView({
  byUser,
  byModel,
  requests,
}: {
  byUser: UsageByUser[];
  byModel: UsageByModel[];
  requests: UsageRow[];
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">By user</h2>
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className={thCls}>Email</th>
                <th className={thRight}>Requests</th>
                <th className={thRight}>In tok</th>
                <th className={thRight}>Out tok</th>
                <th className={thRight}>USD</th>
                <th className={thRight}>CZK</th>
              </tr>
            </thead>
            <tbody>
              {byUser.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-gray-400"
                  >
                    No usage yet.
                  </td>
                </tr>
              ) : (
                byUser.map((r) => (
                  <tr
                    key={r.email}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="px-5 py-3 font-mono text-xs text-gray-800">
                      {r.email}
                    </td>
                    <td className={tdRight}>{fmtNum(r.requests)}</td>
                    <td className={tdRight}>{fmtNum(r.inputTokens)}</td>
                    <td className={tdRight}>{fmtNum(r.outputTokens)}</td>
                    <td className={tdRight}>{fmtUsd(r.costUsd)}</td>
                    <td className={tdRight}>{fmtCzk(r.costCzk)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">By model</h2>
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className={thCls}>Model</th>
                <th className={thRight}>Requests</th>
                <th className={thRight}>In tok</th>
                <th className={thRight}>Out tok</th>
                <th className={thRight}>USD</th>
                <th className={thRight}>CZK</th>
              </tr>
            </thead>
            <tbody>
              {byModel.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-gray-400"
                  >
                    No usage yet.
                  </td>
                </tr>
              ) : (
                byModel.map((r) => (
                  <tr
                    key={`${r.modelKey ?? "?"}-${r.modelId}`}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className={tdCls}>
                      <div className="text-gray-900">{r.modelId}</div>
                      <div className="text-xs text-gray-400">{r.provider}</div>
                    </td>
                    <td className={tdRight}>{fmtNum(r.requests)}</td>
                    <td className={tdRight}>{fmtNum(r.inputTokens)}</td>
                    <td className={tdRight}>{fmtNum(r.outputTokens)}</td>
                    <td className={tdRight}>{fmtUsd(r.costUsd)}</td>
                    <td className={tdRight}>{fmtCzk(r.costCzk)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Requests {requests.length ? `(${requests.length} most recent)` : ""}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className={thCls}>Time (UTC)</th>
                <th className={thCls}>Email</th>
                <th className={thCls}>Model</th>
                <th className={thCls}>Mode</th>
                <th className={thRight}>In tok</th>
                <th className={thRight}>Out tok</th>
                <th className={thRight}>USD</th>
                <th className={thRight}>CZK</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Article</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-5 py-10 text-center text-sm text-gray-400"
                  >
                    No requests yet.
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="px-5 py-3 whitespace-nowrap font-mono text-xs text-gray-600">
                      {fmtTime(r.createdAt)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-800">
                      {r.email}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      <div>{r.modelId}</div>
                      <div className="text-xs text-gray-400">{r.provider}</div>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500">
                      {r.mode}
                    </td>
                    <td className={tdRight}>{fmtNum(r.inputTokens)}</td>
                    <td className={tdRight}>{fmtNum(r.outputTokens)}</td>
                    <td className={tdRight}>{fmtUsd(r.costUsd)}</td>
                    <td className={tdRight}>{fmtCzk(r.costCzk)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          r.status === "ok"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-600">
                      {r.sourceUrl ? (
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {r.articleId || "odkaz"}
                        </a>
                      ) : (
                        r.articleId || "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
