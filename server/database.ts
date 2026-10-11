import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const DEFAULT_DATABASE_PATH = fileURLToPath(new URL("./data/roomly.sqlite", import.meta.url));

export function openDatabase(databasePath = process.env.ROOMLY_DB_PATH ?? DEFAULT_DATABASE_PATH) {
  const path = databasePath === ":memory:" ? databasePath : resolve(databasePath);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const database = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);

  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      CONSTRAINT bookings_room_date_start_time_unique UNIQUE (room_id, date, start_time)
    );
  `);

  return database;
}
