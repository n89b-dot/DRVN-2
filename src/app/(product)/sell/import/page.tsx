import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState, Foot, PageHead } from "@/components/ui";
import { resolveImportConfig } from "@/lib/listing-import/config";
import { getBetaAccess } from "@/lib/beta-access";
import { createClient } from "@/lib/supabase/server";

import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import a listing - DRVN" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const { resume } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const betaAccess = await getBetaAccess(user.id, "seller");
  if (!betaAccess.eligible) {
    return (
      <div className="wrap pb-10">
        <EmptyState mark="β" title="Listing imports are limited to invited sellers">
          Existing orders remain available, but this account cannot start new selling activity.
        </EmptyState>
      </div>
    );
  }

  const [{ data: profile }, config] = await Promise.all([
    supabase.from("profiles").select("import_attested_at").eq("id", user.id).maybeSingle(),
    Promise.resolve(resolveImportConfig()),
  ]);

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
      <PageHead
        className="pagehead--task"
        eyebrow="Bring over a listing — nothing publishes without you"
        title={
          <>
            Import an existing <span className="live-word">listing.</span>
          </>
        }
        sub="Already posted this part somewhere else? Paste the link, or the post itself, and we'll do the formatting — you review everything before it goes anywhere."
      />

      {config.aiMode === "disabled" ? (
        <EmptyState
          mark="⏱"
          title="Importing is temporarily unavailable"
          action={
            <Link href="/sell" className="jumplink">
              Create the listing yourself →
            </Link>
          }
        >
          The organizer behind imports is offline right now — your post is safe where it is.
        </EmptyState>
      ) : (
        <ImportFlow
          attested={Boolean(profile?.import_attested_at)}
          resumeImportId={resume ?? null}
        />
      )}

      <Foot
        left="DRVN — imports expire after 48 hours if you don't finish them"
        right={<Link href="/sell">← Start a listing from scratch</Link>}
      />
    </div>
  );
}
