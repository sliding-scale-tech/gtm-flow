"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/lib/session";
import { Button, cx, errMsg, ErrorText, Input, Spinner } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: "▦" },
  { href: "/drive", label: "New run", icon: "＋" },
  { href: "/runs", label: "Runs", icon: "▶" },
  { href: "/leads", label: "Leads", icon: "☰" },
  { href: "/prompts", label: "Prompts", icon: "✎" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { token, ready, setToken } = useSession();
  const valid = useQuery(api.auth.check, ready && token ? { token } : "skip");
  useEffect(() => { if (valid === false) setToken(null); }, [valid, setToken]);

  if (!ready || (token && valid === undefined)) return <div className="grid min-h-screen place-items-center text-zinc-500"><Spinner /></div>;
  if (!token || valid === false) return <Login />;
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}

function Sidebar() {
  const path = usePathname();
  const { token, setToken } = useSession();
  const logout = useMutation(api.auth.logout);
  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 md:w-56">
      <div className="flex items-center gap-2 px-3 py-5 md:px-5">
        <span className="grid size-7 place-items-center rounded-lg bg-emerald-500 text-sm font-bold text-zinc-950">G</span>
        <span className="hidden text-sm font-semibold text-zinc-100 md:inline">GTM Flow</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} title={n.label}
              className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200")}>
              <span className="w-4 text-center text-xs">{n.icon}</span><span className="hidden md:inline">{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <button onClick={async () => { if (token) await logout({ token }).catch(() => {}); setToken(null); }}
        className="m-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300">
        <span className="hidden md:inline">Log out</span><span className="md:hidden">⎋</span>
      </button>
    </aside>
  );
}

function Login() {
  const login = useAction(api.auth.login);
  const { setToken } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8"
        onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError("");
          try { setToken(await login({ password })); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
        }}>
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-500 font-bold text-zinc-950">G</span>
          <div><div className="font-semibold text-zinc-50">GTM Flow</div><div className="text-xs text-zinc-500">Property-manager lead engine</div></div>
        </div>
        <Input type="password" autoFocus placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <div className="mt-2 min-h-5"><ErrorText>{error}</ErrorText></div>
        <Button variant="primary" className="mt-2 w-full" loading={busy} disabled={!password}>Sign in</Button>
      </form>
    </div>
  );
}
