import { describe, expect, test } from "bun:test";
import { join } from "path";
import { computePeopleStats, buildPeopleOutput, runPeople } from "../../src/people.js";
import { createProgress } from "../../src/progress.js";
import type { UserData, ChannelMeta } from "../../src/metadata.js";
import type { PeopleStats } from "../../src/people.js";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/people-export");

const makeUser = (overrides: Partial<UserData> = {}): UserData => ({
  id: "900000000000000001",
  username: "testuser",
  displayName: null,
  discriminator: "0000",
  email: null,
  avatarHash: null,
  relationships: [],
  payments: [],
  ...overrides,
});

const makeDMChannel = (
  id: string,
  name: string,
  dmPartnerId: string | null = null,
): ChannelMeta => ({
  id,
  name: `Direct Message with ${name}`,
  isDM: true,
  isGroupDM: false,
  dmPartnerId,
  guildId: null,
  guildName: null,
});

// ─── computePeopleStats ────────────────────────────────────────────────────────

describe("computePeopleStats", () => {
  test("counts friends from relationships", () => {
    const user = makeUser({
      relationships: [
        { id: "u1", username: "alice", displayName: null, discriminator: "0000", avatarHash: null },
        { id: "u2", username: "bob", displayName: null, discriminator: "0000", avatarHash: null },
      ],
    });
    const stats = computePeopleStats(user, new Map(), new Map(), new Set(), [], 0);
    expect(stats.friendCount).toBe(2);
  });

  test("counts DM channel count", () => {
    const channels = new Map<string, ChannelMeta>([
      ["ch1", makeDMChannel("ch1", "alice", "u1")],
      ["ch2", makeDMChannel("ch2", "bob", "u2")],
      [
        "ch3",
        {
          id: "ch3",
          name: "server-channel",
          isDM: false,
          isGroupDM: false,
          dmPartnerId: null,
          guildId: "g1",
          guildName: "MyServer",
        },
      ],
    ]);
    const stats = computePeopleStats(null, channels, new Map(), new Set(), [], 0);
    expect(stats.dmChannelCount).toBe(2);
  });

  test("counts distinct mentioned users", () => {
    const mentioned = new Set(["uid_a", "uid_b", "uid_c"]);
    const stats = computePeopleStats(null, new Map(), new Map(), mentioned, [], 0);
    expect(stats.mentionedCount).toBe(3);
  });

  test("computes distinct interactions as union of friends, DM partners, and mentions", () => {
    const user = makeUser({
      relationships: [
        {
          id: "shared",
          username: "alice",
          displayName: null,
          discriminator: "0000",
          avatarHash: null,
        },
        {
          id: "friend_only",
          username: "bob",
          displayName: null,
          discriminator: "0000",
          avatarHash: null,
        },
      ],
    });
    const channels = new Map<string, ChannelMeta>([
      ["ch1", makeDMChannel("ch1", "alice", "shared")], // partner overlaps with friend
      ["ch2", makeDMChannel("ch2", "carol", "dm_only")],
    ]);
    const mentioned = new Set(["mention_only"]);
    // union: shared, friend_only, dm_only, mention_only = 4
    const stats = computePeopleStats(user, channels, new Map(), mentioned, [], 0);
    expect(stats.distinctInteractions).toBe(4);
  });

  test("top DM partners sorted by message count descending", () => {
    const channels = new Map<string, ChannelMeta>([
      ["ch1", makeDMChannel("ch1", "alice", "u1")],
      ["ch2", makeDMChannel("ch2", "bob", "u2")],
      ["ch3", makeDMChannel("ch3", "carol", "u3")],
    ]);
    const msgCounts = new Map([
      ["ch1", 100],
      ["ch2", 300],
      ["ch3", 50],
    ]);
    const stats = computePeopleStats(null, channels, msgCounts, new Set(), [], 0);
    expect(stats.topDmPartners[0]!.name).toBe("bob");
    expect(stats.topDmPartners[0]!.messages).toBe(300);
    expect(stats.topDmPartners[1]!.name).toBe("alice");
    expect(stats.topDmPartners[1]!.messages).toBe(100);
    expect(stats.topDmPartners[2]!.name).toBe("carol");
  });

  test("voice hours accumulate correctly for DM sessions (no guild_id)", () => {
    const channels = new Map<string, ChannelMeta>([["ch1", makeDMChannel("ch1", "alice", "u1")]]);
    const sessions = [
      { channelId: "vc1", guildId: null, durationMs: 3_600_000 }, // 1 h DM call
      { channelId: "vc2", guildId: null, durationMs: 1_800_000 }, // 0.5 h DM call
      { channelId: "vc3", guildId: "guild1", durationMs: 3_600_000 }, // 1 h server — excluded
    ];
    const stats = computePeopleStats(null, channels, new Map([["ch1", 5]]), new Set(), sessions, 2);
    expect(stats.totalDmVoiceHours).toBeCloseTo(1.5);
    expect(stats.voiceCallsJoined).toBe(2);
  });

  test("excludes DM partners with zero messages from top list", () => {
    const channels = new Map<string, ChannelMeta>([
      ["ch1", makeDMChannel("ch1", "alice", "u1")],
      ["ch2", makeDMChannel("ch2", "bob", "u2")],
    ]);
    const msgCounts = new Map([["ch1", 5]]); // bob has 0 messages
    const stats = computePeopleStats(null, channels, msgCounts, new Set(), [], 0);
    expect(stats.topDmPartners).toHaveLength(1);
    expect(stats.topDmPartners[0]!.name).toBe("alice");
  });

  test("counts calls per DM channel from callsByChannel", () => {
    const channels = new Map<string, ChannelMeta>([
      ["ch1", makeDMChannel("ch1", "alice", "u1")],
      ["ch2", makeDMChannel("ch2", "bob", "u2")],
    ]);
    const msgCounts = new Map([
      ["ch1", 10],
      ["ch2", 5],
    ]);
    const callsByChannel = new Map([
      ["ch1", 3],
      ["ch2", 1],
    ]);
    const stats = computePeopleStats(null, channels, msgCounts, new Set(), [], 0, callsByChannel);
    expect(stats.topDmPartners[0]!.calls).toBe(3);
    expect(stats.topDmPartners[1]!.calls).toBe(1);
  });

  test("strips DM prefix from channel name for display", () => {
    const channels = new Map<string, ChannelMeta>([["ch1", makeDMChannel("ch1", "alice", "u1")]]);
    const stats = computePeopleStats(null, channels, new Map([["ch1", 1]]), new Set(), [], 0);
    expect(stats.topDmPartners[0]!.name).toBe("alice");
    expect(stats.topDmPartners[0]!.name).not.toContain("Direct Message");
  });
});

// ─── buildPeopleOutput ─────────────────────────────────────────────────────────

const makeStats = (overrides: Partial<PeopleStats> = {}): PeopleStats => ({
  friendCount: 5,
  dmChannelCount: 3,
  mentionedCount: 2,
  distinctInteractions: 7,
  voiceCallsJoined: 4,
  totalDmVoiceHours: 0,
  topDmPartners: [],
  ...overrides,
});

describe("buildPeopleOutput", () => {
  test("includes all totals fields", () => {
    const output = buildPeopleOutput(
      makeStats({
        friendCount: 42,
        dmChannelCount: 18,
        mentionedCount: 12,
        distinctInteractions: 51,
        voiceCallsJoined: 87,
        totalDmVoiceHours: 23.5,
      }),
    );
    expect(output).toContain("Friends:              42");
    expect(output).toContain("Distinct DM partners: 18");
    expect(output).toContain("Distinct users mentioned: 12");
    expect(output).toContain("Total distinct interactions: 51");
    expect(output).toContain("Voice calls joined:   87");
    expect(output).toContain("DM voice hours:       23.5h");
  });

  test("renders top DM partners table", () => {
    const stats = makeStats({
      topDmPartners: [
        { name: "alice", messages: 342, calls: 7 },
        { name: "bob", messages: 201, calls: 0 },
      ],
    });
    const output = buildPeopleOutput(stats);
    expect(output).toContain("alice");
    expect(output).toContain("342");
    expect(output).toContain("7"); // calls column shown when any > 0
    expect(output).toContain("bob");
    expect(output).toContain("201");
  });

  test("has Social Graph header and separator", () => {
    const output = buildPeopleOutput(makeStats());
    expect(output).toContain("Social Graph");
    expect(output).toContain("─");
  });
});

// ─── runPeople (integration with fixture) ─────────────────────────────────────

describe("runPeople", () => {
  test("outputs social graph from fixture directory", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await runPeople(FIXTURE_DIR, createProgress());
    } finally {
      console.log = orig;
    }
    const output = logs.join("\n");
    expect(output).toContain("Social Graph");
    expect(output).toContain("Friends:              3");
    expect(output).toContain("Distinct DM partners: 2");
    expect(output).toContain("alice");
    expect(output).toContain("bob");
  });

  test("counts DM messages correctly from fixture", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await runPeople(FIXTURE_DIR, createProgress());
    } finally {
      console.log = orig;
    }
    const output = logs.join("\n");
    // alice has 5 messages, should rank above bob with 2
    const aliceIdx = output.indexOf("alice");
    const bobIdx = output.indexOf("bob");
    expect(aliceIdx).toBeLessThan(bobIdx);
    expect(output).toContain("5");
  });
});
