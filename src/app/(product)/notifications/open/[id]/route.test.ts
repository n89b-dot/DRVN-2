import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ markNotificationRead: vi.fn() }));
vi.mock("../../actions", () => ({ markNotificationRead: mocks.markNotificationRead }));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

it("redirects to the notification destination only after a successful read receipt", async () => {
  mocks.markNotificationRead.mockResolvedValue({ href: "/orders/order-1" });
  const response = await GET(new Request("https://drvn.test/notifications/open/notice-1"), { params: Promise.resolve({ id: "notice-1" }) });
  expect(response.headers.get("location")).toBe("https://drvn.test/orders/order-1");
});

it("returns to notifications with failure feedback when the read receipt was not saved", async () => {
  mocks.markNotificationRead.mockResolvedValue({ error: "write_failed" });
  const response = await GET(new Request("https://drvn.test/notifications/open/notice-1"), { params: Promise.resolve({ id: "notice-1" }) });
  expect(response.headers.get("location")).toBe("https://drvn.test/notifications?notice=read_failed");
});
