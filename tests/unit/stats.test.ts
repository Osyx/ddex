import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { runStats } from "../../src/stats.js";
import { createProgress } from "../../src/progress.js";

const makeTempExport = (
  messages: object[],
  opts: { withUser?: boolean; withAnalytics?: boolean } = {},
): string => {
  const dir = mkdtempSync(join(tmpdir(), "ddex-stats-test-"));
  const msgDir = join(dir, "messages", "c111000000000000001");
  mkdirSync(msgDir, { recursive: true });
  writeFileSync(join(msgDir, "messages.json"), JSON.stringify(messages));

  if (opts.withUser) {
    const accountDir = join(dir, "Account");
    mkdirSync(accountDir, { recursive: true });
    writeFileSync(
      join(accountDir, "user.json"),
      JSON.stringify({
        id: "1",
        username: "tester",
        discriminator: "0000",
        relationships: [{ user: { id: "2", username: "friend", discriminator: "0001" } }],
        payments: [
          {
            id: "p1",
            amount: 999,
            currency: "usd",
            description: "Nitro",
            created_at: "2024-01-01",
          },
        ],
      }),
    );
  }

  if (opts.withAnalytics) {
    const analyticsDir = join(dir, "package", "Activity", "analytics");
    mkdirSync(analyticsDir, { recursive: true });
    writeFileSync(
      join(analyticsDir, "events-2024-00000-of-00001.json"),
      [
        JSON.stringify({
          event_type: "session_start",
          timestamp: "2024-01-01T10:00:00Z",
          extra_field_1: "Linux",
        }),
        JSON.stringify({ event_type: "notification_clicked", timestamp: "2024-01-01T10:01:00Z" }),
      ].join("\n"),
    );
  }

  return dir;
};

describe("runStats", () => {
  test("runs without throwing on empty export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ddex-stats-empty-"));
    mkdirSync(join(dir, "messages"), { recursive: true });
    try {
      const prog = createProgress();
      await expect(runStats(dir, prog)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs without throwing on export with messages", async () => {
    const dir = makeTempExport([
      {
        ID: "1",
        Timestamp: "2024-01-01 10:00:00",
        Contents: "hello world 😂",
        Attachments: "https://cdn.discord.com/attachment.png",
      },
      { ID: "2", Timestamp: "2024-01-02 11:00:00", Contents: "test message", Attachments: "" },
    ]);
    try {
      const prog = createProgress();
      await expect(runStats(dir, prog)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs without throwing with user data and payments", async () => {
    const dir = makeTempExport(
      [{ ID: "1", Timestamp: "2024-01-01 10:00:00", Contents: "hey", Attachments: "" }],
      { withUser: true },
    );
    try {
      const prog = createProgress();
      await expect(runStats(dir, prog)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs without throwing with analytics data", async () => {
    const dir = makeTempExport(
      [{ ID: "1", Timestamp: "2024-03-15 12:00:00", Contents: "hello 👋", Attachments: "" }],
      { withAnalytics: true },
    );
    try {
      const prog = createProgress();
      await expect(runStats(dir, prog)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
