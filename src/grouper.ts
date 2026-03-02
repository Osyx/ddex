import { doubleMetaphone } from "double-metaphone";
import { distance as levenshtein } from "fastest-levenshtein";
import type { WordGroup, VariantCount } from "./types.js";

/** Collapse runs of 3+ of the same character to 2, to normalise elongations like `niiice` → `niice`. */
const normalizeRepeats = (word: string): string => word.replace(/(.)\1{2,}/gu, "$1$1");

const phoneticKey = (word: string): string => {
  const [primary = "", secondary = ""] = doubleMetaphone(normalizeRepeats(word));
  return primary !== "" ? primary : secondary !== "" ? secondary : word;
};

/**
 * Max edit distance allowed for two words to be considered variants.
 * Uses the shorter word's normalised length so short words (≤ 3 chars) are
 * never fuzzily merged, preventing cross-language false positives like
 * `typ`/`top` or `lol`/`loli`.
 */
const editThreshold = (minNormLen: number): number => {
  if (minNormLen <= 3) return 0;
  if (minNormLen <= 6) return 1;
  return 2;
};

/** Cluster a frequency map into fuzzy word groups. */
export const cluster = (counts: Map<string, number>): WordGroup[] => {
  // Sort words by frequency desc so the most common word drives the cluster canonical
  const entries = [...counts.entries()].toSorted((a, b) => b[1] - a[1]);

  // bucket: phonetic key -> list of (word, count)
  const buckets = new Map<string, VariantCount[]>();

  for (const [word, count] of entries) {
    const key = phoneticKey(word);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push({ word, count });
  }

  const groups: WordGroup[] = [];

  for (const variants of buckets.values()) {
    // Re-sort: frequency descending (primary) then normalised form (secondary)
    // so the most-frequent word still wins the canonical slot while similar-
    // looking words are adjacent, meaning the scan over group representatives
    // terminates quickly.
    variants.sort(
      (a, b) =>
        b.count - a.count || normalizeRepeats(a.word).localeCompare(normalizeRepeats(b.word)),
    );

    // Guard: skip edit-distance merging for degenerate buckets to cap O(n²).
    if (variants.length > 50) {
      for (const variant of variants) {
        groups.push({ canonical: variant.word, total: variant.count, variants: [variant] });
      }
      continue;
    }

    // Within a phonetic bucket, further merge by edit distance
    const merged: VariantCount[][] = [];

    for (const variant of variants) {
      let placed = false;
      for (const group of merged) {
        // Compare against the most-frequent word in this group (first element)
        const representative = group[0]?.word;
        if (representative === undefined) continue;
        const normVariant = normalizeRepeats(variant.word);
        const normRep = normalizeRepeats(representative);
        const minLen = Math.min(normVariant.length, normRep.length);
        const threshold = editThreshold(minLen);
        if (levenshtein(normVariant, normRep) <= threshold) {
          group.push(variant);
          placed = true;
          break;
        }
      }
      if (!placed) {
        merged.push([variant]);
      }
    }

    for (const group of merged) {
      const total = group.reduce((s, v) => s + v.count, 0);
      // The canonical name is the most frequent variant (first due to pre-sort)
      const canonical = group[0]?.word;
      if (canonical === undefined) continue;
      groups.push({ canonical, total, variants: group });
    }
  }

  // Sort groups by total count descending
  groups.sort((a, b) => b.total - a.total);
  return groups;
};
