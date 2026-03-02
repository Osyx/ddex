import { describe, expect, test } from "bun:test";
import { join } from "path";
import { MessageCountAnalyzer, VoiceCollector, runServers } from "../../src/servers.js";
import { createProgress } from "../../src/progress.js";
import type { ChannelMeta } from "../../src/metadata.js";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/servers-export");

// ─── MessageCountAnalyzer ──────────────────────────────────────────────────────

describe("MessageCountAnalyzer", () => {
  const makeMeta = (id: string): ChannelMeta => ({
    id,
    name: `channel-${id}`,
    isDM: false,
    dmPartnerId: null,
    guildId: null,
    guildName: null,
  });

  test("counts messages per channel", () => {
    const analyzer = new MessageCountAnalyzer();
    const meta = makeMeta("ch1");
    analyzer.onMessage({
      id: "1",
      timestamp: new Date(),
      contents: "hi",
      attachments: "",
      channelId: "ch1",
      channelMeta: meta,
    });
    analyzer.onMessage({
      id: "2",
      timestamp: new Date(),
      contents: "hello",
      attachments: "",
      channelId: "ch1",
      channelMeta: meta,
    });
    expect(analyzer.counts.get("ch1")).toBe(2);
  });

  test("counts across multiple channels independently", () => {
    const analyzer = new MessageCountAnalyzer();
    for (const channelId of ["ch1", "ch1", "ch2", "ch3"]) {
      analyzer.onMessage({
        id: channelId,
        timestamp: new Date(),
        contents: "msg",
        attachments: "",
        channelId,
        channelMeta: makeMeta(channelId),
      });
    }
    expect(analyzer.counts.get("ch1")).toBe(2);
    expect(analyzer.counts.get("ch2")).toBe(1);
    expect(analyzer.counts.get("ch3")).toBe(1);
  });

  test("starts count at zero for unseen channels", () => {
    const analyzer = new MessageCountAnalyzer();
    expect(analyzer.counts.get("missing")).toBeUndefined();
  });
});

// ─── VoiceCollector ────────────────────────────────────────────────────────────

describe("VoiceCollector", () => {
  test("collects join events", () => {
    const collector = new VoiceCollector();
    collector.onEvent({
      event_type: "join_voice_channel",
      timestamp: "2024-01-10T14:00:00.000Z",
      channel_id: "vc1",
      guild_id: "g1",
    });
    expect(collector.joins).toHaveLength(1);
    expect(collector.joins[0]!.channelId).toBe("vc1");
    expect(collector.joins[0]!.guildId).toBe("g1");
    expect(collector.joinCount).toBe(1);
  });

  test("collects leave events", () => {
    const collector = new VoiceCollector();
    collector.onEvent({
      event_type: "leave_voice_channel",
      timestamp: "2024-01-10T15:00:00.000Z",
      channel_id: "vc1",
    });
    expect(collector.leaves).toHaveLength(1);
    expect(collector.leaves[0]!.channelId).toBe("vc1");
  });

  test("skips events with no channel_id", () => {
    const collector = new VoiceCollector();
    collector.onEvent({ event_type: "join_voice_channel", timestamp: "2024-01-10T14:00:00.000Z" });
    expect(collector.joins).toHaveLength(0);
    expect(collector.joinCount).toBe(0);
  });

  test("handles client_track_timestamp with leading quote", () => {
    const collector = new VoiceCollector();
    collector.onEvent({
      event_type: "join_voice_channel",
      client_track_timestamp: '"2024-01-10T14:00:00.000Z',
      channel_id: "vc1",
      guild_id: "g1",
    });
    expect(collector.joins).toHaveLength(1);
    expect(collector.joins[0]!.ts.getFullYear()).toBe(2024);
  });

  test("eventTypes covers join and leave", () => {
    const collector = new VoiceCollector();
    expect(collector.eventTypes.has("join_voice_channel")).toBeTrue();
    expect(collector.eventTypes.has("leave_voice_channel")).toBeTrue();
  });
});

// ─── runServers integration ────────────────────────────────────────────────────

describe("runServers", () => {
  test("runs on fixture export without throwing", async () => {
    const prog = createProgress();
    await expect(runServers(FIXTURE_DIR, prog)).resolves.toBeUndefined();
  });

  test("throws for non-existent path", async () => {
    const prog = createProgress();
    await expect(runServers("/nonexistent/path", prog)).rejects.toThrow();
  });
});
