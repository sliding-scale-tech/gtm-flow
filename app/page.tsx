"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/session";
import { Badge, Button, Card, Empty, PageHeader, Spinner, Stat, int, stateTone, usd } from "@/components/ui";

const KEYS: [string, string][] = [["gemini", "Gemini"], ["exa", "Exa"], ["findymail", "Findymail"], ["trykitt", "TryKitt"],
  ["instantly", "Instantly"], ["googleServiceAccount", "Google service account"], ["driveFolder", "Drive folder"]];

export default function Overview() {
  const token = useToken();
  const o = useQuery(api.runs.overview, { token });
  const runs = useQuery(api.runs.list, { token });
  const s = useQuery(api.settings.get, { token });
  if (!o || !runs) return <div className="p-10"><Spinner /></div>;
  const usable = o.valid + o.catchAll;
  const maxCost = Math.max(0, ...Object.values(o.costs));
  return (
    <div>
      <PageHeader title="Overview" sub="All runs, all time" actions={<Link href="/drive"><Button variant="primary">New run</Button></Link>} />
      {o.runs === 0 ? (
        <Card><Empty>No runs yet. <Link href="/drive" className="text-emerald-400 hover:underline">Start your first run</Link> from a Drive file or a CSV upload.</Empty></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Rows processed" value={int(o.rows)} hint={`${int(o.runs)} runs`} />
            <Stat label="Usable emails" value={int(usable)} tone="good" hint={`${int(o.valid)} valid · ${int(o.catchAll)} catch-all`} />
            <Stat label="Ready leads" value={int(o.ready)} />
            <Stat label="Total spend" value={usd(o.spent)} />
            <Stat label="Cost per email" value={usable ? usd(o.spent / usable) : "—"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Spend by provider">
              <ul className="space-y-2">
                {Object.entries(o.costs).sort((a, b) => b[1] - a[1]).map(([k, c]) => (
                  <li key={k} className="text-xs">
                    <div className="flex justify-between text-zinc-300"><span>{k}</span><span className="tabular">{usd(c)}</span></div>
                    <div className="mt-1 h-1.5 rounded bg-zinc-800"><div className="h-full rounded bg-emerald-500" style={{ width: `${maxCost ? (c / maxCost) * 100 : 0}%` }} /></div>
                  </li>
                ))}
                {Object.keys(o.costs).length === 0 && <li className="text-xs text-zinc-500">No spend yet.</li>}
              </ul>
            </Card>
            <Card title="Setup" actions={s?.mock ? <Badge tone="amber">Mock mode ON</Badge> : undefined} className="lg:col-span-2">
              {!s ? <Spinner /> : (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {KEYS.map(([k, l]) => <span key={k} className="flex items-center gap-1.5 text-xs text-zinc-300">{l}<Badge tone={s.keyStatus[k] ? "green" : "red"}>{s.keyStatus[k] ? "set" : "missing"}</Badge></span>)}
                </div>
              )}
            </Card>
          </div>
          <Card title="Recent runs" actions={<Link href="/runs" className="text-xs text-emerald-400 hover:underline">All runs</Link>}>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500"><tr><th className="pb-2 font-medium">File</th><th className="font-medium">Status</th><th className="text-right font-medium">Rows</th><th className="text-right font-medium">Emails</th><th className="text-right font-medium">Spent</th></tr></thead>
              <tbody>
                {runs.slice(0, 5).map((r) => (
                  <tr key={r._id} className="border-t border-zinc-800">
                    <td className="py-2"><Link href={`/runs/${r._id}`} className="text-zinc-100 hover:text-emerald-400">{r.fileName}</Link></td>
                    <td><Badge tone={stateTone[r.status]}>{r.status}</Badge></td>
                    <td className="tabular text-right">{int(r.counts.rows ?? r.rowsTotal)}</td>
                    <td className="tabular text-right">{int((r.counts["email:valid"] ?? 0) + (r.counts["email:catch_all"] ?? 0))}</td>
                    <td className="tabular text-right">{usd(r.spentUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
