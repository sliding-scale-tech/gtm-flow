"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/session";
import { Badge, Button, Card, Empty, PageHeader, Spinner, ago, int, stateTone, usd } from "@/components/ui";

export default function Runs() {
  const token = useToken();
  const runs = useQuery(api.runs.list, { token });
  return (
    <div>
      <PageHeader title="Runs" actions={<Link href="/drive"><Button variant="primary">New run</Button></Link>} />
      <Card>
        {!runs ? <Spinner /> : runs.length === 0 ? <Empty>No runs yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500"><tr>
                <th className="pb-2 font-medium">File</th><th className="font-medium">Source</th><th className="font-medium">Status</th><th className="font-medium">Started</th>
                <th className="text-right font-medium">Rows</th><th className="text-right font-medium">Emails</th><th className="w-48 pl-6 font-medium">Spent / budget</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r._id} className="border-t border-zinc-800">
                    <td className="py-2"><Link href={`/runs/${r._id}`} className="text-zinc-100 hover:text-emerald-400">{r.fileName}</Link></td>
                    <td className="text-zinc-400">{r.source}</td>
                    <td><Badge tone={stateTone[r.status]} title={r.pauseReason ?? r.error}>{r.status}</Badge></td>
                    <td className="text-zinc-400">{ago(r.startedAt)}</td>
                    <td className="tabular text-right">{int(r.counts.rows ?? r.rowsTotal)}</td>
                    <td className="tabular text-right">{int((r.counts["email:valid"] ?? 0) + (r.counts["email:catch_all"] ?? 0))}</td>
                    <td className="pl-6">
                      <div className="tabular text-xs text-zinc-300">{usd(r.spentUsd)} / {usd(r.budgetUsd)}</div>
                      <div className="mt-1 h-1 rounded bg-zinc-800"><div className="h-full rounded bg-emerald-500" style={{ width: `${Math.min(100, r.budgetUsd ? (r.spentUsd / r.budgetUsd) * 100 : 0)}%` }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
