import { notFound, redirect } from "next/navigation";

/** The lookup form on /admin/agent posts here; an id goes to the member's page. */
export default async function AdminAgentMemberLookup({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const value = (id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) notFound();
  redirect(`/admin/agent/members/${value}`);
}
