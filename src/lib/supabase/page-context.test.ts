import { beforeEach, expect, it, vi } from "vitest";
import { getViewer } from "./page-context";

const { getClaims, getUser } = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock("./server", () => ({ createClient: async () => ({ auth: { getClaims, getUser } }) }));
beforeEach(() => vi.clearAllMocks());

it("uses only the verified subject for browsing, never editable metadata", async () => {
  getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user", user_metadata: { id: "another-user", role: "admin" } } }, error: null });
  expect(await getViewer()).toEqual({ id: "verified-user" });
  expect(getUser).not.toHaveBeenCalled();
});

it.each([
  { data: null, error: null },
  { data: { claims: { sub: "untrusted" } }, error: new Error("Invalid signature") },
  { data: { claims: {} }, error: null },
  { data: { claims: { sub: "" } }, error: null },
])("fails closed when verified identity is unavailable: %j", async result => {
  getClaims.mockResolvedValue(result);
  expect(await getViewer()).toBeNull();
});
