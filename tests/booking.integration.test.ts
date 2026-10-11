import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";

const MOSCOW_DATE = "2026-10-12";
const LAST_BOOKABLE_DATE = "2026-10-25";
const TEST_NOW = new Date("2026-10-12T06:00:00.000Z");

interface RunningApp {
  baseUrl: string;
  databasePath: string;
  close: () => Promise<void>;
}

const runningApps: Array<{ app: RunningApp; directory: string }> = [];

afterEach(async () => {
  const apps = runningApps.splice(0);
  await Promise.all(apps.map(({ app }) => app.close()));
  for (const { directory } of apps) rmSync(directory, { recursive: true, force: true });
});

describe("ROOMLY booking API integration", () => {
  it("returns the public catalog and exact Moscow availability shape", async () => {
    const { baseUrl } = await startApp();

    const roomsResponse = await fetch(`${baseUrl}/api/rooms`);
    expect(roomsResponse.status).toBe(200);
    const rooms = (await roomsResponse.json()) as Array<Record<string, unknown>>;
    expect(rooms).toHaveLength(3);
    expect(rooms.map(({ id }) => id)).toEqual(["garden", "atelier", "forum"]);
    expect(rooms.map(({ name }) => name)).toEqual(["Сад", "Ателье", "Форум"]);
    expect(rooms.map(({ capacity }) => capacity)).toEqual([4, 6, 10]);
    for (const room of rooms) {
      expect(Object.keys(room).sort()).toEqual(["capacity", "description", "features", "id", "name"]);
    }

    const availabilityResponse = await fetch(
      `${baseUrl}/api/availability?roomId=garden&date=${MOSCOW_DATE}`,
    );
    expect(availabilityResponse.status).toBe(200);
    const availability = (await availabilityResponse.json()) as {
      roomId: string;
      date: string;
      timezone: string;
      slots: Array<{ startTime: string; endTime: string; available: boolean }>;
    };
    expect(Object.keys(availability).sort()).toEqual(["date", "roomId", "slots", "timezone"]);
    expect(availability).toMatchObject({ roomId: "garden", date: MOSCOW_DATE, timezone: "Europe/Moscow" });
    expect(availability.slots).toEqual(
      Array.from({ length: 9 }, (_, index) => {
        const hour = index + 9;
        return {
          startTime: `${String(hour).padStart(2, "0")}:00`,
          endTime: `${String(hour + 1).padStart(2, "0")}:00`,
          available: hour > 9,
        };
      }),
    );
  });

  it("rejects invalid booking bodies and availability queries without creating rows", async () => {
    const { baseUrl, databasePath } = await startApp();
    const invalidBookings = [
      { roomId: "missing", date: MOSCOW_DATE, startTime: "10:00", name: "Guest", email: "guest@example.com" },
      { roomId: "garden", date: "2026-02-30", startTime: "10:00", name: "Guest", email: "guest@example.com" },
      { roomId: "garden", date: "2026-10-26", startTime: "10:00", name: "Guest", email: "guest@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "09:30", name: "Guest", email: "guest@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "18:00", name: "Guest", email: "guest@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "10:00", name: "   ", email: "guest@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "10:00", name: "Guest", email: "invalid" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "10:00", name: "Guest", email: "guest@example.com", extra: true },
    ];
    for (const booking of invalidBookings) expect((await postBooking(baseUrl, booking)).status).toBe(400);

    const malformedJson = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformedJson.status).toBe(400);

    const missingContentType = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      body: JSON.stringify(invalidBookings[0]),
    });
    expect(missingContentType.status).toBe(400);

    const invalidAvailabilityQueries = [
      "roomId=missing&date=2026-10-12",
      "roomId=garden&date=2026-02-30",
      "roomId=garden&date=2026-10-26",
      "roomId=garden&date=2026-10-12&date=2026-10-13",
    ];
    for (const query of invalidAvailabilityQueries) {
      expect((await fetch(`${baseUrl}/api/availability?${query}`)).status).toBe(400);
    }

    expect(countBookings(databasePath)).toBe(0);
  });

  it("serializes simultaneous duplicate requests, hides other PII, and persists across reopen", async () => {
    const app = await startApp();
    const submissions = [
      { roomId: "atelier", date: LAST_BOOKABLE_DATE, startTime: "10:00", name: "Alex Example", email: "alex@example.com" },
      { roomId: "atelier", date: LAST_BOOKABLE_DATE, startTime: "10:00", name: "Other Guest", email: "other@example.com" },
    ];
    const responses = await Promise.all(submissions.map((submission) => postBooking(app.baseUrl, submission)));
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);

    const successIndex = responses.findIndex(({ status }) => status === 201);
    const success = responses[successIndex];
    const confirmation = (await success.json()) as Record<string, unknown>;
    expect(Object.keys(confirmation).sort()).toEqual([
      "date", "email", "endTime", "id", "name", "roomId", "startTime",
    ]);
    expect(confirmation).toMatchObject({ ...submissions[successIndex], endTime: "11:00" });
    expect(confirmation.id).toMatch(/^[0-9a-f-]{36}$/i);
    const otherSubmission = submissions[1 - successIndex];
    expect(JSON.stringify(confirmation)).not.toContain(otherSubmission.name);
    expect(JSON.stringify(confirmation)).not.toContain(otherSubmission.email);

    const conflictText = await responses[1 - successIndex].text();
    for (const submission of submissions) {
      expect(conflictText).not.toContain(submission.name);
      expect(conflictText).not.toContain(submission.email);
    }

    const availabilityResponse = await fetch(
      `${app.baseUrl}/api/availability?roomId=atelier&date=${LAST_BOOKABLE_DATE}`,
    );
    const availability = (await availabilityResponse.json()) as {
      slots: Array<{ startTime: string; available: boolean }>;
    };
    expect(availability.slots.find(({ startTime }) => startTime === "10:00")?.available).toBe(false);
    expect(JSON.stringify(availability)).not.toContain(submissions[successIndex].email);
    expect(countBookings(app.databasePath)).toBe(1);

    await app.close();
    const reopened = await startApp(app.databasePath);
    const reopenedAvailability = await fetch(
      `${reopened.baseUrl}/api/availability?roomId=atelier&date=${LAST_BOOKABLE_DATE}`,
    );
    const reopenedBody = (await reopenedAvailability.json()) as {
      slots: Array<{ startTime: string; available: boolean }>;
    };
    expect(reopenedBody.slots.find(({ startTime }) => startTime === "10:00")?.available).toBe(false);
    expect((await postBooking(reopened.baseUrl, submissions[successIndex])).status).toBe(409);
    expect(await (await fetch(`${reopened.baseUrl}/api/rooms`)).text()).not.toContain(
      submissions[successIndex].email,
    );
  });
});

async function startApp(databasePath?: string): Promise<RunningApp> {
  const directory = mkdtempSync(join(tmpdir(), "roomly-booking-integration-"));
  const resolvedDatabasePath = databasePath ?? join(directory, "bookings.sqlite");
  const server = createApp({ databasePath: resolvedDatabasePath, now: () => new Date(TEST_NOW) });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");

  let closed = false;
  const app: RunningApp = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    databasePath: resolvedDatabasePath,
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  runningApps.push({ app, directory });
  return app;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function postBooking(baseUrl: string, booking: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking),
  });
}

function countBookings(databasePath: string): number {
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare("SELECT COUNT(*) AS count FROM bookings").get() as { count: number };
    return Number(row.count);
  } finally {
    database.close();
  }
}
