import { describe, expect, test } from "bun:test";
import { join } from "path";
import { buildSpentOutput, runSpent } from "../../src/spent.js";
import { createProgress } from "../../src/progress.js";
import type { UserData } from "../../src/metadata.js";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/spent-export");

const makeUser = (payments: UserData["payments"]): UserData => ({
  id: "1",
  username: "testuser",
  displayName: null,
  discriminator: "0000",
  email: null,
  avatarHash: null,
  relationships: [],
  payments,
});

// ─── buildSpentOutput ──────────────────────────────────────────────────────────

describe("buildSpentOutput", () => {
  test("returns no-payments message when userData is null", () => {
    const output = buildSpentOutput(null);
    expect(output).toBe("(no payment records found in this export)");
  });

  test("returns no-payments message when payments array is empty", () => {
    const output = buildSpentOutput(makeUser([]));
    expect(output).toBe("(no payment records found in this export)");
  });

  test("categorises Nitro, gift, and store payments correctly", () => {
    const payments: UserData["payments"] = [
      {
        id: "1",
        amount: 999,
        currency: "usd",
        description: "Discord Nitro Monthly",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "2",
        amount: 499,
        currency: "usd",
        description: "Gift Subscription",
        createdAt: "2024-01-02T00:00:00Z",
      },
      {
        id: "3",
        amount: 299,
        currency: "usd",
        description: "Server Boost",
        createdAt: "2024-01-03T00:00:00Z",
      },
    ];
    const output = buildSpentOutput(makeUser(payments));
    expect(output).toContain("Nitro subscriptions");
    expect(output).toContain("Gifts sent");
    expect(output).toContain("Store / cosmetics");
    expect(output).toContain("$9.99");
    expect(output).toContain("$4.99");
    expect(output).toContain("$2.99");
  });

  test("sums total per currency and displays currency code", () => {
    const payments: UserData["payments"] = [
      {
        id: "1",
        amount: 999,
        currency: "usd",
        description: "Discord Nitro Monthly",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "2",
        amount: 999,
        currency: "usd",
        description: "Discord Nitro Monthly",
        createdAt: "2024-02-01T00:00:00Z",
      },
    ];
    const output = buildSpentOutput(makeUser(payments));
    expect(output).toContain("$19.98 (USD)");
  });

  test("shows multiple currencies as separate totals", () => {
    const payments: UserData["payments"] = [
      {
        id: "1",
        amount: 999,
        currency: "usd",
        description: "Discord Nitro Monthly",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "2",
        amount: 800,
        currency: "eur",
        description: "Discord Nitro Monthly",
        createdAt: "2024-01-02T00:00:00Z",
      },
    ];
    const output = buildSpentOutput(makeUser(payments));
    expect(output).toContain("(USD)");
    expect(output).toContain("(EUR)");
    expect(output).toContain("[USD]");
    expect(output).toContain("[EUR]");
  });

  test("recent transactions are sorted newest-first and capped at 10", () => {
    const payments: UserData["payments"] = Array.from({ length: 11 }, (_, i) => ({
      id: `p${i}`,
      amount: 999,
      currency: "usd",
      description: "Discord Nitro Monthly",
      createdAt: `2024-${String(i + 1).padStart(2, "0")}-01T00:00:00Z`,
    }));
    const output = buildSpentOutput(makeUser(payments));
    // Most recent first: 2024-11-01 should appear, 2024-01-01 should not (it's the 11th)
    expect(output).toContain("2024-11-01");
    expect(output).not.toContain("2024-01-01");
  });

  test("displays payment count label correctly for single vs plural", () => {
    const payments: UserData["payments"] = [
      {
        id: "1",
        amount: 999,
        currency: "usd",
        description: "Discord Nitro Monthly",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    const output = buildSpentOutput(makeUser(payments));
    expect(output).toContain("1 payment)");
    expect(output).not.toContain("1 payments");
  });
});

// ─── runSpent (integration with fixture) ──────────────────────────────────────

describe("runSpent", () => {
  test("outputs spending summary from fixture directory", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await runSpent(FIXTURE_DIR, createProgress());
    } finally {
      console.log = orig;
    }
    const output = logs.join("\n");
    expect(output).toContain("Discord Spending Summary");
    expect(output).toContain("Total spent:");
    expect(output).toContain("Nitro subscriptions");
    expect(output).toContain("Recent transactions");
  });
});
