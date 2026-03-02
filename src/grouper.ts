import { doubleMetaphone } from "double-metaphone";
import { distance as levenshtein } from "fastest-levenshtein";
import type { WordGroup, VariantCount } from "./types.js";

const phoneticKey = (word: string): string => {
  const [primary = "", secondary = ""] = doubleMetaphone(word);
  return primary !== "" ? primary : secondary !== "" ? secondary : word;
};

const editThreshold = (wordLen: number): number => {
  return Math.max(1, Math.floor(wordLen / 3));
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
    // Within a phonetic bucket, further merge by edit distance
    const merged: VariantCount[][] = [];

    for (const variant of variants) {
      let placed = false;
      for (const group of merged) {
        // Compare against the most-frequent word in this group (first element)
        const representative = group[0]?.word;
        if (representative === undefined) continue;
        const maxLen = Math.max(variant.word.length, representative.length);
        const threshold = editThreshold(maxLen);
        if (levenshtein(variant.word, representative) <= threshold) {
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
