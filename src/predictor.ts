import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";
import yauzl from "yauzl";
import type { Progress } from "./progress.js";
import { findEventsFile } from "./analytics.js";

export { findEventsFile };

export interface Prediction {
  value: string;
  probability: number;
}

export interface PredictionResult {
  age: Prediction | null;
  gender: Prediction | null;
}

/** Deep-searches a parsed JSON value for an object that has both `targetKey` and `"probability"`. */
export const findPrediction = (val: unknown, targetKey: string): Prediction | null => {
  if (!val || typeof val !== "object") return null;
  if (Array.isArray(val)) {
    for (const item of val) {
      const found = findPrediction(item, targetKey);
      if (found) return found;
    }
    return null;
  }
  const obj = val as Record<string, unknown>;
  if (targetKey in obj && "probability" in obj) {
    return { value: String(obj[targetKey]), probability: Number(obj.probability) };
  }
  for (const v of Object.values(obj)) {
    const found = findPrediction(v, targetKey);
    if (found) return found;
  }
  return null;
};

const isEventsEntry = (fileName: string): boolean =>
  /\/analytics\/events-\d{4}-00000-of-00001\.json$/i.test(fileName.replace(/\\/g, "/"));

const parseStream = async (
  stream: NodeJS.ReadableStream,
  prog: Progress,
): Promise<PredictionResult> => {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const result: PredictionResult = { age: null, gender: null };
  let lines = 0;

  for await (const line of rl) {
    lines++;
    if (lines % 500_000 === 0) {
      prog.update(`  Scanned ${(lines / 1_000_000).toFixed(1)}M lines...`);
    }

    if (!line.includes('"predicted_age"') && !line.includes('"predicted_gender"')) continue;

    try {
      const parsed: unknown = JSON.parse(line);
      if (!result.age) result.age = findPrediction(parsed, "predicted_age");
      if (!result.gender) result.gender = findPrediction(parsed, "predicted_gender");
    } catch {
      // skip malformed lines
    }

    if (result.age && result.gender) break;
  }

  rl.close();
  return result;
};

const streamFromZip = (zipPath: string, prog: Progress): Promise<PredictionResult> =>
  new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error("Failed to open ZIP"));

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (!isEventsEntry(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            return reject(streamErr ?? new Error("Failed to open entry stream"));
          }
          parseStream(readStream, prog).then(resolve).catch(reject);
        });
      });

      zipfile.on("end", () =>
        reject(
          new Error(
            "Analytics events file not found in ZIP.\n" +
              "Expected: package/Activity/analytics/events-YYYY-00000-of-00001.json",
          ),
        ),
      );
      zipfile.on("error", reject);
    });
  });

export const runPrediction = async (input: string, prog: Progress): Promise<PredictionResult> => {
  const s = await stat(input).catch(() => {
    throw new Error(`Path not found: ${input}`);
  });

  prog.phase("Scanning analytics");

  let result: PredictionResult;

  if (s.isDirectory()) {
    const eventsPath = findEventsFile(input);
    if (!eventsPath) {
      throw new Error(
        "Analytics events file not found.\n" +
          "Expected: package/Activity/analytics/events-YYYY-00000-of-00001.json",
      );
    }
    result = await parseStream(createReadStream(eventsPath), prog);
  } else if (input.toLowerCase().endsWith(".zip")) {
    result = await streamFromZip(input, prog);
  } else {
    throw new Error(`Input must be a directory or a .zip file, got: ${input}`);
  }

  prog.done("Scan complete");
  return result;
};
