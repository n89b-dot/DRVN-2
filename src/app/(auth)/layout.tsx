import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-5">
      <div className="authwrap">
        <Link href="/" className="bar__logo" aria-label="DRVN home">
          DRVN<em>.</em> <span className="microlabel">Parts marketplace</span>
        </Link>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
