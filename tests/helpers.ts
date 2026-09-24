import { expect } from "vitest";

/** Asserts |actual − expected| ≤ tolerance, with a readable failure message. */
export function expectWithin(actual: number | null | undefined, expected: number, tolerance: number): void {
  expect(actual, `expected ${actual} to be within ±${tolerance} of ${expected}`).not.toBeNull();
  expect(
    Math.abs((actual as number) - expected),
    `expected ${actual} to be within ±${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance + 1e-12);
}
