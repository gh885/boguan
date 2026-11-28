import { openReadonlyDatabase, type Db } from "./connection";

let webDb: Db | null = null;

export function openWebDatabase(): Db {
  webDb ??= openReadonlyDatabase();
  return webDb;
}

export * from "./queries/posts";
export * from "./queries/search";
