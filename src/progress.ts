const isTTY = process.stderr.isTTY;

export interface Progress {
  phase(msg: string): void;
  update(msg: string): void;
  done(msg: string): void;
  error(msg: string): void;
}

export const createProgress = (): Progress => ({
  phase(msg: string) {
    process.stderr.write(`▶ ${msg}...\n`);
  },
  update(msg: string) {
    if (isTTY) {
      process.stderr.write(`\r\x1b[K${msg}`);
    } else {
      process.stderr.write(`${msg}\n`);
    }
  },
  done(msg: string) {
    if (isTTY) {
      process.stderr.write(`\r\x1b[K✓ ${msg}\n`);
    } else {
      process.stderr.write(`✓ ${msg}\n`);
    }
  },
  error(msg: string) {
    process.stderr.write(`✗ ${msg}\n`);
  },
});
