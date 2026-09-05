import approved from "./approved-test-projects.json";

type TestTarget = { url?: string; projectRef?: string };

/** A matching environment variable is not proof that a hosted DB is disposable.
 * Hosted projects must also appear in the reviewed provisioning inventory. */
export function assertIsolatedTestTarget(
  config: TestTarget,
  approvedHostedRefs: readonly string[] = approved.hostedProjectRefs
): void {
  if (!config.url || !config.projectRef) {
    throw new Error("Tests require explicit isolated Supabase URL and project reference");
  }
  const target = new URL(config.url);
  if (target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("Test target must be a canonical Supabase origin");
  }
  if (config.projectRef === "local-drvn-remediation") {
    if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "54321") {
      throw new Error("Local fixtures require the isolated DRVN loopback stack on port 54321");
    }
    return;
  }
  if (target.protocol !== "https:" || target.port || target.hostname !== `${config.projectRef}.supabase.co`) {
    throw new Error("Fixture target does not match the canonical test project origin");
  }
  if (!approvedHostedRefs.includes(config.projectRef)) {
    throw new Error("Hosted test project is not in the reviewed disposable-project inventory");
  }
}
