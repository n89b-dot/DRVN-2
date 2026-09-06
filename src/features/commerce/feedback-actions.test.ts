import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allow: vi.fn(),
  order: vi.fn(),
  questionInsert: vi.fn(),
  questionRead: vi.fn(),
  refresh: vi.fn(),
  reportError: vi.fn(),
  reviewInsert: vi.fn(),
  reviewRead: vi.fn(),
}));

function readable(result: ReturnType<typeof vi.fn>) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: result,
  };
  return query;
}

vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { askQuestion: {} },
  allowAction: mocks.allow,
  rateLimitMessage: () => "Too many questions.",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "author" } } }) },
    from: (table: string) => {
      if (table === "listing_questions") {
        return { ...readable(mocks.questionRead), insert: mocks.questionInsert };
      }
      if (table === "reviews") {
        return { ...readable(mocks.reviewRead), insert: mocks.reviewInsert };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => readable(mocks.order) }),
}));

import { askQuestion, submitReview } from "./feedback-actions";

const OPERATION_ID = "12345678-1234-4234-8234-123456789012";
const question = {
  author_id: "author",
  listing_id: "listing",
  parent_id: null,
  body: "Does this include the bracket?",
};
const review = {
  reviewer_id: "author",
  reviewee_id: "seller",
  rating: 5,
  body: "Exactly as described",
};

function questionForm(body = question.body) {
  const form = new FormData();
  form.set("operation_id", OPERATION_ID);
  form.set("listing_id", "listing");
  form.set("body", body);
  return form;
}

function reviewForm(body = review.body) {
  const form = new FormData();
  form.set("order_id", "order");
  form.set("rating", "5");
  form.set("body", body);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allow.mockResolvedValue(true);
  mocks.order.mockResolvedValue({
    data: { buyer_id: "author", seller_id: "seller", status: "delivered" },
    error: null,
  });
  mocks.questionRead.mockResolvedValue({ data: null, error: null });
  mocks.questionInsert.mockResolvedValue({ error: null });
  mocks.reviewRead.mockResolvedValue({ data: null, error: null });
  mocks.reviewInsert.mockResolvedValue({ error: null });
});

describe("question submission recovery", () => {
  it("adopts an exact committed retry before consuming another rate limit", async () => {
    mocks.questionRead.mockResolvedValue({ data: question, error: null });

    await expect(askQuestion({}, questionForm())).resolves.toEqual({
      ok: "Posted.",
      operationId: OPERATION_ID,
    });
    expect(mocks.questionInsert).not.toHaveBeenCalled();
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith("/listings/listing");
  });

  it("does not adopt another author or changed text under the same identity", async () => {
    mocks.questionRead.mockResolvedValue({
      data: { ...question, author_id: "someone-else" },
      error: null,
    });

    const result = await askQuestion({}, questionForm());
    expect(result.error).toContain("changed");
    expect(mocks.questionInsert).not.toHaveBeenCalled();
  });

  it("reconciles an insert response lost after commit", async () => {
    mocks.questionRead
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: question, error: null });
    mocks.questionInsert.mockResolvedValue({ error: { message: "response unavailable" } });

    await expect(askQuestion({}, questionForm())).resolves.toEqual({
      ok: "Posted.",
      operationId: OPERATION_ID,
    });
    expect(mocks.questionInsert).toHaveBeenCalledWith({
      id: OPERATION_ID,
      listing_id: "listing",
      author_id: "author",
      parent_id: null,
      body: question.body,
    });
  });

  it("fails closed when the prior-operation lookup cannot be completed", async () => {
    mocks.questionRead.mockResolvedValue({ data: null, error: { message: "offline" } });

    const result = await askQuestion({}, questionForm());
    expect(result.error).toContain("check whether");
    expect(mocks.questionInsert).not.toHaveBeenCalled();
  });
});

describe("review submission recovery", () => {
  it("treats an exact existing review as the successful retry it is", async () => {
    mocks.reviewRead.mockResolvedValue({ data: review, error: null });

    await expect(submitReview({}, reviewForm())).resolves.toEqual({ ok: "Review posted." });
    expect(mocks.reviewInsert).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith("/orders/order");
  });

  it("keeps a changed retry as a conflict", async () => {
    mocks.reviewRead.mockResolvedValue({ data: { ...review, rating: 4 }, error: null });

    await expect(submitReview({}, reviewForm())).resolves.toEqual({
      error: "You've already reviewed this order.",
    });
    expect(mocks.reviewInsert).not.toHaveBeenCalled();
  });

  it("reconciles a unique conflict after a committed response was lost", async () => {
    mocks.reviewRead
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: review, error: null });
    mocks.reviewInsert.mockResolvedValue({ error: { code: "23505" } });

    await expect(submitReview({}, reviewForm())).resolves.toEqual({ ok: "Review posted." });
  });

  it("hides database details when a failed insert cannot be confirmed", async () => {
    mocks.reviewInsert.mockResolvedValue({ error: { message: "private database detail" } });

    const result = await submitReview({}, reviewForm());
    expect(result.error).toContain("Try again with the same review");
    expect(result.error).not.toContain("private");
  });
});
