import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app px-5 py-12">
      <Link
        href="/"
        className="mb-8 grid h-12 w-12 place-items-center rounded-2xl bg-accent font-brand text-xl font-bold text-white"
        aria-label="DRVN home"
      >
        D
      </Link>
      <div className="w-full max-w-[400px] rounded-card border border-border bg-surface p-8">
        {children}
      </div>
    </div>
  );
}
