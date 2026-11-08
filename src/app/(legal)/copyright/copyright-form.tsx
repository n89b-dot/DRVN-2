"use client";

import { useActionState } from "react";

import { Alert, Button, Checkbox, TextArea, TextField } from "@/components/ui";
import { submitCopyrightNotice, type CopyrightNoticeState } from "@/features/moderation/copyright-actions";
import { COPYRIGHT_URL_LIMIT } from "@/lib/copyright/notice";

/** The public copyright notice form (R69-dmca). Works signed in or out. */
export function CopyrightForm() {
  const [state, action, pending] = useActionState<CopyrightNoticeState, FormData>(submitCopyrightNotice, null);
  const errors = state?.errors ?? {};

  if (state?.ok) {
    return (
      <Alert role="status" title="Notice received">
        {state.ok}
      </Alert>
    );
  }

  return (
    <form action={action} className="grid gap-1" aria-label="Copyright notice">
      {state?.error && (
        <Alert tone="live" role="alert" className="mb-4" title="Couldn't send your notice">
          {state.error}
        </Alert>
      )}
      <TextField
        id="copyright-name"
        name="claimant_name"
        label="Your full name"
        autoComplete="name"
        required
        className="max-w-none"
        error={errors.claimant_name}
      />
      <TextField
        id="copyright-holder"
        name="rights_holder"
        label="Rights holder"
        optional
        className="max-w-none"
        hint="If you're sending this for someone else (a client, an employer), who owns the rights."
        error={errors.rights_holder}
      />
      <TextField
        id="copyright-email"
        name="claimant_email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        className="max-w-none"
        hint="We reply here, and may pass it to the member if they dispute the notice."
        error={errors.claimant_email}
      />
      <TextArea
        id="copyright-address"
        name="claimant_address"
        label="Postal address"
        autoComplete="street-address"
        rows={3}
        required
        className="max-w-none"
        error={errors.claimant_address}
      />
      <TextField
        id="copyright-phone"
        name="claimant_phone"
        label="Phone"
        type="tel"
        autoComplete="tel"
        optional
        className="max-w-none"
        error={errors.claimant_phone}
      />
      <TextArea
        id="copyright-work"
        name="work_description"
        label="The work that's being copied"
        rows={4}
        required
        className="max-w-none"
        hint="What it is (a photo, a written description) and where the original is, if it's online."
        error={errors.work_description}
      />
      <TextArea
        id="copyright-urls"
        name="content_urls"
        label="Where it appears on DRVN"
        rows={4}
        required
        className="max-w-none"
        hint={`One link per line, up to ${COPYRIGHT_URL_LIMIT}: a listing, a post, or the photo itself (right-click → copy image address).`}
        error={errors.content_urls}
      />
      <Checkbox
        name="good_faith"
        value="yes"
        required
        label="I have a good-faith belief that this use isn't authorised by the copyright owner, its agent or the law."
        hint={errors.good_faith}
      />
      <Checkbox
        name="accurate_and_authorised"
        value="yes"
        required
        label="The information in this notice is accurate and, under penalty of perjury, I am the owner or authorised to act for the owner."
        hint={errors.accurate_and_authorised}
      />
      <TextField
        id="copyright-signature"
        name="signature"
        label="Signature"
        required
        className="max-w-none"
        hint="Type your full name. It counts as your signature on this notice."
        error={errors.signature}
      />
      <Button type="submit" variant="live" loading={pending} pendingLabel="Sending…" className="mt-3 w-full">
        Send notice
      </Button>
    </form>
  );
}
