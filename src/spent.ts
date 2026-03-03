import { resolveExport } from "./extractor.js";
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

/** Pure function: formats payment data into the spending summary string. */
export function buildSpentOutput(userData: UserData | null): string {
  if (!userData || userData.payments.length === 0) {
    return "(no payment records found in this export)";
  }

  const payments = userData.payments;

  // Group totals by currency (uppercased)
  const byCurrency = new Map<string, CurrencyTotals>();
  for (const payment of payments) {
    const currency = payment.currency.toUpperCase();
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
  const sorted = [...payments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const recent = sorted.slice(0, 10);

  const w = termWidth();
  const lines: string[] = [];
  lines.push("Discord Spending Summary");
  lines.push("─".repeat(Math.min(w, 24)));

  for (const [currency, data] of byCurrency) {
    lines.push(`Total spent: $${data.total.toFixed(2)} (${currency})`);
  }

  lines.push("");
  lines.push("Breakdown by category:");

  for (const [currency, data] of byCurrency) {
    if (byCurrency.size > 1) lines.push(`  [${currency}]`);
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const pl = (n: number) => `${n} payment${n !== 1 ? "s" : ""}`;
    lines.push(`  Nitro subscriptions  ${fmt(data.nitro).padStart(7)}   (${pl(data.nitroCount)})`);
    lines.push(`  Gifts sent           ${fmt(data.gifts).padStart(7)}   (${pl(data.giftsCount)})`);
    lines.push(`  Store / cosmetics    ${fmt(data.store).padStart(7)}   (${pl(data.storeCount)})`);
  }

  lines.push("");
  lines.push("Recent transactions (last 10):");

  for (const payment of recent) {
    const date = payment.createdAt.slice(0, 10);
    const amount = `$${(payment.amount / 100).toFixed(2)}`;
    lines.push(truncate(`  ${date}  ${payment.description.padEnd(30)}  ${amount}`, w));
  }

  return lines.join("\n");
}

export async function runSpent(exportPath: string, prog: Progress): Promise<void> {
  const { exportDir, cleanup } = await resolveExport(exportPath, prog);
  try {
    prog.phase("Loading user data");
    const userData = await loadUserData(exportDir);
    prog.done("Loaded user data");
    console.log(buildSpentOutput(userData));
  } finally {
    await cleanup();
  }
}
