import { readdirSync } from "fs";
import { join } from "path";

export interface UserData {
  id: string;
  username: string;
  displayName: string | null;
  discriminator: string;
  email: string | null;
  avatarHash: string | null;
  relationships: Array<{
    id: string;
    username: string;
    displayName: string | null;
    discriminator: string;
    avatarHash: string | null;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    currency: string;
    description: string;
    createdAt: string;
  }>;
}

export interface ChannelMeta {
  id: string;
  name: string;
  isDM: boolean;
  dmPartnerId: string | null;
  guildId: string | null;
  guildName: string | null;
}

const findDirCI = (parent: string, name: string): string | undefined => {
  try {
    const entries = readdirSync(parent, { withFileTypes: true });
    const match = entries.find(
      (e) => e.isDirectory() && e.name.toLowerCase() === name.toLowerCase(),
    );
    return match ? join(parent, match.name) : undefined;
  } catch {
    return undefined;
  }
};

const findFileCI = (parent: string, name: string): string | undefined => {
  try {
    const entries = readdirSync(parent, { withFileTypes: true });
    const match = entries.find((e) => e.isFile() && e.name.toLowerCase() === name.toLowerCase());
    return match ? join(parent, match.name) : undefined;
  } catch {
    return undefined;
  }
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Load user.json from Account/ directory (case-insensitive). */
export async function loadUserData(exportDir: string): Promise<UserData | null> {
  const accountDir = findDirCI(exportDir, "account");
  if (!accountDir) return null;
  const userFile = findFileCI(accountDir, "user.json");
  if (!userFile) return null;

  const raw = (await Bun.file(userFile).json()) as Record<string, unknown>;

  const relationships: UserData["relationships"] = [];
  if (Array.isArray(raw.relationships)) {
    for (const rel of raw.relationships as unknown[]) {
      if (typeof rel !== "object" || rel === null) continue;
      const r = rel as Record<string, unknown>;
      const user =
        typeof r.user === "object" && r.user !== null ? (r.user as Record<string, unknown>) : {};
      relationships.push({
        id: str(user.id),
        username: str(user.username),
        displayName: strOrNull(r.display_name),
        discriminator: str(user.discriminator),
        avatarHash: strOrNull(user.avatar),
      });
    }
  }

  const payments: UserData["payments"] = [];
  if (Array.isArray(raw.payments)) {
    for (const pmt of raw.payments as unknown[]) {
      if (typeof pmt !== "object" || pmt === null) continue;
      const p = pmt as Record<string, unknown>;
      payments.push({
        id: str(p.id),
        amount: typeof p.amount === "number" ? p.amount : 0,
        currency: str(p.currency),
        description: str(p.description),
        createdAt: str(p.created_at),
      });
    }
  }

  return {
    id: str(raw.id),
    username: str(raw.username),
    displayName: strOrNull(raw.display_name),
    discriminator: str(raw.discriminator),
    email: strOrNull(raw.email),
    avatarHash: strOrNull(raw.avatar_hash),
    relationships,
    payments,
  };
}

const DM_PREFIX = "Direct Message with ";
const DISCRIMINATOR_SUFFIX_RE = /#\d{4}$/;

/** Strip "#NNNN" discriminator suffix from a display name. */
const stripDiscriminator = (name: string): string => name.replace(DISCRIMINATOR_SUFFIX_RE, "");

/** Load Messages/index.json (case-insensitive). Returns map of channelId → raw name string. */
export async function loadMessagesIndex(exportDir: string): Promise<Map<string, string>> {
  const msgDir = findDirCI(exportDir, "messages");
  if (!msgDir) return new Map();
  const indexFile = findFileCI(msgDir, "index.json");
  if (!indexFile) return new Map();

  const raw = (await Bun.file(indexFile).json()) as Record<string, unknown>;
  const result = new Map<string, string>();

  for (const [channelId, value] of Object.entries(raw)) {
    if (value === null || typeof value !== "string") continue;
    const name = value.startsWith(DM_PREFIX)
      ? DM_PREFIX + stripDiscriminator(value.slice(DM_PREFIX.length))
      : value;
    result.set(channelId, name);
  }

  return result;
}

/** Load Servers/index.json (case-insensitive). Returns map of guildId → guild name. */
export async function loadServersIndex(exportDir: string): Promise<Map<string, string>> {
  const serversDir = findDirCI(exportDir, "servers");
  if (!serversDir) return new Map();
  const indexFile = findFileCI(serversDir, "index.json");
  if (!indexFile) return new Map();

  const raw = (await Bun.file(indexFile).json()) as Record<string, unknown>;
  const result = new Map<string, string>();

  for (const [guildId, name] of Object.entries(raw)) {
    if (typeof name === "string") result.set(guildId, name);
  }

  return result;
}

async function loadChannelMetaInternal(
  channelDir: string,
  channelId: string,
  rawName: string,
  ownUserId: string | null,
): Promise<ChannelMeta> {
  const channelFile = findFileCI(channelDir, "channel.json");
  const isDM = rawName.startsWith(DM_PREFIX);

  let guildId: string | null = null;
  let guildName: string | null = null;
  let dmPartnerId: string | null = null;

  if (channelFile) {
    const raw = (await Bun.file(channelFile).json()) as Record<string, unknown>;

    const guild =
      typeof raw.guild === "object" && raw.guild !== null
        ? (raw.guild as Record<string, unknown>)
        : null;
    if (guild) {
      guildId = strOrNull(guild.id);
      guildName = strOrNull(guild.name);
    }

    if (isDM && Array.isArray(raw.recipients) && (raw.recipients as unknown[]).length === 2) {
      const recipients = raw.recipients as unknown[];
      if (ownUserId) {
        const partner = recipients.find((r) => str(r) !== ownUserId);
        dmPartnerId = partner !== undefined ? str(partner) : null;
      } else {
        dmPartnerId = str(recipients[0]);
      }
    }
  }

  return { id: channelId, name: rawName, isDM, dmPartnerId, guildId, guildName };
}

/** Load channel.json for a specific channel directory (case-insensitive). */
export async function loadChannelMeta(
  channelDir: string,
  channelId: string,
  rawName: string,
): Promise<ChannelMeta> {
  return loadChannelMetaInternal(channelDir, channelId, rawName, null);
}

/** Load all channels metadata at once (combines index + per-channel channel.json). */
export async function loadAllChannels(
  exportDir: string,
  userData: UserData | null,
): Promise<Map<string, ChannelMeta>> {
  const index = await loadMessagesIndex(exportDir);
  const msgDir = findDirCI(exportDir, "messages");
  const ownUserId = userData?.id ?? null;
  const result = new Map<string, ChannelMeta>();

  for (const [channelId, rawName] of index) {
    let channelDir: string | undefined;
    if (msgDir) {
      channelDir = findDirCI(msgDir, `c${channelId}`);
    }
    const meta = channelDir
      ? await loadChannelMetaInternal(channelDir, channelId, rawName, ownUserId)
      : {
          id: channelId,
          name: rawName,
          isDM: rawName.startsWith(DM_PREFIX),
          dmPartnerId: null,
          guildId: null,
          guildName: null,
        };
    result.set(channelId, meta);
  }

  return result;
}
