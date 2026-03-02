import { Database } from "bun:sqlite";

export interface WordDb {
  addTokens(tokens: string[]): void;
  getWordCounts(): Map<string, number>;
  close(): void;
}

export const createWordDb = (path: string): WordDb => {
  const db = new Database(path);

  db.query(
    `CREATE TABLE IF NOT EXISTS word_counts (
      word TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    )`,
  ).run();

  const upsert = db.prepare(
    `INSERT INTO word_counts (word, count) VALUES (?, 1)
     ON CONFLICT(word) DO UPDATE SET count = count + 1`,
  );

  const addTokens = db.transaction((tokens: string[]) => {
    for (const token of tokens) {
      upsert.run(token);
    }
  });

  return {
    addTokens(tokens: string[]) {
      if (tokens.length > 0) addTokens(tokens);
    },
    getWordCounts(): Map<string, number> {
      const rows = db
        .query<{ word: string; count: number }, []>("SELECT word, count FROM word_counts")
        .all();
      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(row.word, row.count);
      }
      return map;
    },
    close() {
      db.close();
    },
  };
};
