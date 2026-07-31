import Link from "next/link";

import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset your password - DRVN" };

/**
 * The recovery entry point. `requestPasswordReset` was written and reachable
 * from nowhere — there was no link on the sign-in sheet and no page at the
 * emailed link's destination, so a locked-out account was permanently lost.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="sheet-card">
      <span className="microlabel">Access · recovery</span>
      <h1 className="mt-1">
        Lost your <span className="live-word">key.</span>
      </h1>
      <p className="mt-2 text-[15px] text-dim">
        Give us the address on your account and we&apos;ll send a link to set a new password.
      </p>

      <ForgotForm />

      <p className="mt-5 text-[14px] text-dim">
        Remembered it? <Link href="/login" className="jumplink">Back to sign in</Link>
      </p>
    </div>
  );
}
