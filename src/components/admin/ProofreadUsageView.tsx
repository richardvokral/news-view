import type { UsageByUser, UsageByModel } from "@/lib/proofread/usage";

function fmtUsd(n: number) {
  return `$${n.toFixed(4)}`;
}
function fmtCzk(n: number) {
  return `${n.toFixed(2)} Kč`;
}
function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

const thCls =
  "px-5 py-3 text-left text-xs font-medium uppercase text-gray-500";
const thRight = "px-5 py-3 text-right text-xs font-medium uppercase text-gray-500";
const tdCls = "px-5 py-3 text-gray-700";
const tdRight = "px-5 py-3 text-right text-gray-700";

export default function ProofreadUsageView({
  byUser,
  byModel,
}: {
  byUser: UsageByUser[];
  byModel: UsageByModel[];
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
    </div>
  );
}
