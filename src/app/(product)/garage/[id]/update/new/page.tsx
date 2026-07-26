import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SectionLabel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { UpdateComposer } from "./update-composer";

export const metadata = { title: "New update - DRVN" };

export default async function NewUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: car } = await supabase
    .from("cars")
    .select("id, name")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!car) notFound();

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-10 md:py-14">
      <Link
        href={`/garage/${car.id}/edit`}
        className="text-sm text-text-muted transition hover:text-text-secondary"
      >
        ← {car.name}
      </Link>
      <div className="mt-6">
        <SectionLabel>New build update</SectionLabel>
      </div>
      <UpdateComposer carId={car.id} userId={user.id} />
    </div>
  );
}
