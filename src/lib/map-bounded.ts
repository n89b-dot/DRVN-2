/** Await every in-flight operation, even when a peer fails; never leave detached effects. */
export async function mapBounded<T>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<void>): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  let cursor = 0;
  const failures: unknown[] = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { await operation(item); } catch (error) { failures.push(error); }
    }
  }));
  if (failures.length) throw new AggregateError(failures, "Batch operations failed");
}
