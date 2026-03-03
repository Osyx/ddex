import { resolveExport, ExportFilter } from "./extractor.js";
import { loadUserData } from "./metadata.js";
import type { UserData } from "./metadata.js";
import type { Progress } from "./progress.js";
import { termWidth, truncate } from "./display.js";

interface CurrencyTotals {
  total: number;
  nitro: number;
  nitroCount: number;
  gifts: number;
  giftsCount: number;
  store: number;
  storeCount: number;
}

/** ISO 4217 fiat currency codes — anything else is treated as virtual (orbs/credits). */
const FIAT_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "JPY",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "HKD",
  "KRW",
  "BRL",
  "MXN",
  "INR",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
  "RUB",
  "ZAR",
  "TWD",
  "THB",
  "IDR",
  "MYR",
  "PHP",
]);

const fmtVirtual = (c: string, v: number) =>
  c === "DISCORD_ORB" ? `${v.toFixed(0)} Orbs` : `${v.toFixed(0)} ${c}`;

const fmt = (n: number) => n.toFixed(2);

const pl = (n: number) => `${n} payment${n !== 1 ? "s" : ""}`;

/** Pure function: formats payment data into the spending summary string. */
export const buildSpentOutput = (userData: UserData | null): string => {
  if (!userData || userData.payments.length === 0) {
    return "(no payment records found in this export)";
  }

  const payments = userData.payments;

  // Group totals by currency (uppercased)
  const byCurrency = new Map<string, CurrencyTotals>();
  const byVirtual = new Map<string, number>(); // orbs / credits / etc.
  for (const payment of payments) {
    const currency = payment.currency.toUpperCase();
    const isFiat = FIAT_CURRENCIES.has(currency);

    if (!isFiat) {
      byVirtual.set(currency, (byVirtual.get(currency) ?? 0) + payment.amount / 100);
      continue;
    }

    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        total: 0,
        nitro: 0,
        nitroCount: 0,
        gifts: 0,
        giftsCount: 0,
        store: 0,
        storeCount: 0,
      });
    }
    const entry = byCurrency.get(currency)!;
    const amount = payment.amount / 100;
    entry.total += amount;

    const desc = payment.description.toLowerCase();
    if (desc.includes("nitro")) {
      entry.nitro += amount;
      entry.nitroCount++;
    } else if (desc.includes("gift")) {
      entry.gifts += amount;
      entry.giftsCount++;
    } else {
      entry.store += amount;
      entry.storeCount++;
    }
  }

  // Sort payments newest-first for the recent transactions list
  const sorted = [...payments].toSorted(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const recent = sorted.slice(0, 10);

  const w = termWidth();
  const lines: string[] = [];
  lines.push("Discord Spending Summary");
  lines.push("─".repeat(Math.min(w, 24)));

  // Grand total across all fiat currencies, orbs in parentheses
  const orbSuffix =
    byVirtual.size > 0
      ? "  (" + [...byVirtual.entries()].map(([c, v]) => fmtVirtual(c, v)).join(", ") + ")"
      : "";
  if (byCurrency.size === 0) {
    lines.push(`Total spent: 0.00${orbSuffix}`);
  } else if (byCurrency.size === 1) {
    for (const [currency, data] of byCurrency) {
      lines.push(`Total spent: ${data.total.toFixed(2)} ${currency}${orbSuffix}`);
    }
  } else {
    // Multiple fiat currencies — show each, then a note about orbs
    for (const [currency, data] of byCurrency) {
      lines.push(`Total spent: ${data.total.toFixed(2)} ${currency}`);
    }
    if (orbSuffix) lines.push(`Virtual currency:${orbSuffix.trim()}`);
  }

  lines.push("");
  lines.push("Breakdown by category:");

  for (const [currency, data] of byCurrency) {
    if (byCurrency.size > 1) lines.push(`  [${currency}]`);
    lines.push(`  Nitro subscriptions  ${fmt(data.nitro).padStart(7)}   (${pl(data.nitroCount)})`);
    lines.push(`  Gifts sent           ${fmt(data.gifts).padStart(7)}   (${pl(data.giftsCount)})`);
    lines.push(`  Store / cosmetics    ${fmt(data.store).padStart(7)}   (${pl(data.storeCount)})`);
  }

  lines.push("");
  lines.push("Recent transactions (last 10):");

  for (const payment of recent) {
    const date = payment.createdAt.slice(0, 10);
    const amount = (payment.amount / 100).toFixed(2);
    lines.push(truncate(`  ${date}  ${payment.description.padEnd(30)}  ${amount}`, w));
  }

  return lines.join("\n");
};

export const runSpent = async (exportPath: string, prog: Progress): Promise<void> => {
  const { exportDir, cleanup } = await resolveExport(exportPath, prog, ExportFilter.account);
  try {
    prog.phase("Loading user data");
    const userData = await loadUserData(exportDir);
    prog.done("Loaded user data");
    console.log(buildSpentOutput(userData));
  } finally {
    await cleanup();
  }
};
