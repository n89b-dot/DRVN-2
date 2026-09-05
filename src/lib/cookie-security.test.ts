import { expect, it } from "vitest";
import { secureCookies } from "./cookie-security";
it("keeps production cookies Secure unless both endpoints are the explicit local HTTP test stack", () => {
  const local = { NODE_ENV: "production", E2E_TEST_PROJECT_REF: "local-drvn-remediation", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
  expect(secureCookies(local)).toBe(false);
  expect(secureCookies({ ...local, E2E_TEST_PROJECT_REF: undefined })).toBe(true);
  expect(secureCookies({ ...local, NEXT_PUBLIC_SITE_URL: "https://drvn.example" })).toBe(true);
  expect(secureCookies({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" })).toBe(true);
  expect(secureCookies({ NODE_ENV: "production" })).toBe(true);
});
