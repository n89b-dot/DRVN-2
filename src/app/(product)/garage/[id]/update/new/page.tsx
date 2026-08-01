import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
    <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
      <header className="pagehead">
        <span className="microlabel">
          <Link href={`/garage/${car.id}/edit`} className="hover:text-live">
            ← {car.name}
          </Link>{" "}
          · new build update — nothing is public until you publish
        </span>
      </header>
      <UpdateComposer carId={car.id} userId={user.id} />
    </div>
  );
}
