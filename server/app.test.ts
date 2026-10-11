import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const MOSCOW_DATE = "2026-10-12";
const TEST_NOW = new Date("2026-10-11T21:00:00.000Z");

interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

const runningApps: Array<{ app: RunningApp; directory: string }> = [];

afterEach(async () => {
  const apps = runningApps.splice(0);
  await Promise.all(apps.map(({ app }) => app.close()));
  for (const { directory } of apps) rmSync(directory, { recursive: true, force: true });
});

describe("ROOMLY HTTP API", () => {
  it("returns the public catalog and hourly Moscow availability", async () => {
    const { baseUrl } = await startApp();
    const roomsResponse = await fetch(`${baseUrl}/api/rooms`);
    expect(roomsResponse.status).toBe(200);
    const rooms = (await roomsResponse.json()) as Array<Record<string, unknown>>;
    expect(rooms).toHaveLength(3);
    expect(rooms.map(({ id }) => id)).toEqual(["garden", "atelier", "forum"]);
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
    expect(availability).toMatchObject({ roomId: "garden", date: MOSCOW_DATE, timezone: "Europe/Moscow" });
    expect(availability.slots).toHaveLength(9);
    expect(availability.slots[0]).toEqual({ startTime: "09:00", endTime: "10:00", available: true });
    expect(availability.slots.at(-1)).toEqual({ startTime: "17:00", endTime: "18:00", available: true });
  });

  it("rejects invalid booking details and dates outside the 14-day Moscow window", async () => {
    const { baseUrl } = await startApp();
    const invalidBookings = [
      { roomId: "unknown", date: MOSCOW_DATE, startTime: "09:00", name: "A", email: "a@example.com" },
      { roomId: "garden", date: "2026-02-30", startTime: "09:00", name: "A", email: "a@example.com" },
      { roomId: "garden", date: "2026-10-26", startTime: "09:00", name: "A", email: "a@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "18:00", name: "A", email: "a@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "09:00", name: " ", email: "a@example.com" },
      { roomId: "garden", date: MOSCOW_DATE, startTime: "09:00", name: "A", email: "invalid" },
    ];

    for (const booking of invalidBookings) {
      const response = await postBooking(baseUrl, booking);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  it("rejects oversized booking JSON and closes the connection without draining the request", async () => {
    const { baseUrl } = await startApp();
    const response = await postBooking(baseUrl, {
      roomId: "garden",
      date: MOSCOW_DATE,
      startTime: "09:00",
      name: "A".repeat(20 * 1024),
      email: "guest@example.com",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("connection")).toBe("close");
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rejects an oversized chunked body as soon as it crosses the limit", async () => {
    const { baseUrl } = await startApp();
    const response = await new Promise<{ statusCode: number | undefined; connection: string | undefined; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          `${baseUrl}/api/bookings`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked",
            },
          },
          (incoming) => {
            const chunks: Buffer[] = [];
            incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
            incoming.once("end", () => {
              resolve({
                statusCode: incoming.statusCode,
                connection: incoming.headers.connection,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        request.once("error", reject);
        request.end(JSON.stringify({
          roomId: "garden",
          date: MOSCOW_DATE,
          startTime: "09:00",
          name: "A".repeat(20 * 1024),
          email: "guest@example.com",
        }));
      },
    );

    expect(response.statusCode).toBe(400);
    expect(response.connection).toBe("close");
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("serves built files and the SPA entry while keeping paths inside the static directory", async () => {
    const { baseUrl } = await startApp({ staticFixture: true });

    const rootResponse = await fetch(baseUrl);
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get("content-type")).toContain("text/html");
    expect(await rootResponse.text()).toContain("ROOMLY test app");

    const fallbackResponse = await fetch(`${baseUrl}/booking/garden`);
    expect(fallbackResponse.status).toBe(200);
    expect(await fallbackResponse.text()).toContain("ROOMLY test app");

    const traversalResponse = await fetch(`${baseUrl}/%2e%2e%2fsecret.txt`);
    expect(traversalResponse.status).toBe(404);
    expect(await traversalResponse.text()).not.toContain("private test data");
  });
});

async function startApp(options: { staticFixture?: boolean } = {}): Promise<RunningApp> {
  const directory = mkdtempSync(join(tmpdir(), "roomly-test-"));
  const databasePath = join(directory, "bookings.sqlite");
  let staticDirectory: string | undefined;
  if (options.staticFixture) {
    staticDirectory = join(directory, "static");
    mkdirSync(staticDirectory);
    writeFileSync(join(staticDirectory, "index.html"), "<html>ROOMLY test app</html>");
    writeFileSync(join(directory, "secret.txt"), "private test data");
  }
  const server = createApp({ databasePath, staticDirectory, now: () => new Date(TEST_NOW) });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  let closed = false;
  const app: RunningApp = {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

function postBooking(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
