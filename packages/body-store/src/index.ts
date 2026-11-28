import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
const defaultDir = process.env.BOGUAN_BODIES ?? "data/bodies";

function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "bun.lock"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export const defaultBodiesDir = isAbsolute(defaultDir)
  ? defaultDir
  : join(workspaceRoot(), defaultDir);

export interface BodyStore {
  put: (postId: number, text: string) => void;
  read: (postId: number) => string | null;
  has: (postId: number) => boolean;
  delete: (postId: number) => void;
  ids: () => number[];
  prune: (keep: ReadonlySet<number>) => number;
}

const BODY_FILE = /^(\d+)\.txt\.gz$/;

const GZIP_LEVEL = 6;

export function openBodyStore(dir = defaultBodiesDir): BodyStore {
  const fileOf = (postId: number): string => join(dir, `${postId}.txt.gz`);

  const ensureDir = (): void => {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
  };

  const ids = (): number[] => {
    if (!existsSync(dir)) return [];
    const found: number[] = [];
    for (const name of readdirSync(dir)) {
      const match = BODY_FILE.exec(name);
      if (match) found.push(Number(match[1]));
    }
    return found.sort((a, b) => a - b);
  };

  const remove = (postId: number): void => {
    rmSync(fileOf(postId), { force: true });
  };

  const put = (postId: number, text: string): void => {
    ensureDir();
    const target = fileOf(postId);
    const temp = `${target}.tmp`;
    writeFileSync(temp, gzipSync(Buffer.from(text, "utf8"), { level: GZIP_LEVEL }));
    renameSync(temp, target);
  };

  const read = (postId: number): string | null => {
    const target = fileOf(postId);
    if (!existsSync(target)) return null;
    try {
      return gunzipSync(readFileSync(target)).toString("utf8");
    } catch {
      return null;
    }
  };

  const prune = (keep: ReadonlySet<number>): number => {
    let removed = 0;
    for (const id of ids()) {
      if (keep.has(id)) continue;
      remove(id);
      removed += 1;
    }
    return removed;
  };

  return {
    put,
    read,
    has: (postId) => existsSync(fileOf(postId)),
    delete: remove,
    ids,
    prune,
  };
}
