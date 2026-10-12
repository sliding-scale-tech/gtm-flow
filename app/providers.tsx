"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { SessionProvider } from "@/lib/session";
import { Shell } from "@/components/Shell";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <SessionProvider>
        <Shell>{children}</Shell>
      </SessionProvider>
    </ConvexProvider>
  );
}
