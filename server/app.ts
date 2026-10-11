import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ROOMS } from "./catalog.js";
import {
  isSlotInFuture,
  moscowDateTime,
  parseBookingInput,
  SLOT_STARTS,
  validateAvailabilityQuery,
  ValidationError,
  type SlotStart,
} from "./booking-rules.js";
import { openDatabase } from "./database.js";

const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_READ_TIMEOUT_MS = 15_000;
const BODY_TOO_LARGE = Symbol("body-too-large");

export interface CreateAppOptions {
  databasePath?: string;
  staticDirectory?: string;
  now?: () => Date;
}

interface BookingRecord {
  id: string;
  roomId: string;
  date: string;
  startTime: SlotStart;
  endTime: string;
  name: string;
  email: string;
}

export function createApp(options: CreateAppOptions = {}): Server {
  const database = openDatabase(options.databasePath);
  const now = options.now ?? (() => new Date());
  const staticDirectory = options.staticDirectory ?? "dist";
  const server = createServer((request, response) => {
    void handleRequest(request, response, database, now, staticDirectory).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof ValidationError) {
        sendError(response, 400, "VALIDATION_ERROR", error.message);
        return;
      }
      sendError(response, 500, "INTERNAL_ERROR", "The request could not be completed.");
    });
  });
  server.requestTimeout = REQUEST_READ_TIMEOUT_MS;
  server.once("close", () => database.close());
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  database: DatabaseSync,
  now: () => Date,
  staticDirectory: string,
) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  if (url.pathname === "/api/rooms" && method === "GET") {
    sendJson(response, 200, ROOMS);
    return;
  }

  if (url.pathname === "/api/availability" && method === "GET") {
    const currentTime = now();
    const query = validateAvailabilityQuery(
      singleQueryValue(url.searchParams, "roomId"),
      singleQueryValue(url.searchParams, "date"),
      currentTime,
    );
    const bookings = database
      .prepare("SELECT start_time AS startTime FROM bookings WHERE room_id = ? AND date = ?")
      .all(query.roomId, query.date) as Array<{ startTime: string }>;
    const bookedSlots = new Set(bookings.map((booking) => booking.startTime));

    sendJson(response, 200, {
      roomId: query.roomId,
      date: query.date,
      timezone: "Europe/Moscow",
      slots: SLOT_STARTS.map((start) => {
        const hour = Number(start.slice(0, 2));
        const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
        return {
          startTime: start,
          endTime,
          available: !bookedSlots.has(start) && isSlotInFuture(query.date, start, currentTime),
        };
      }),
    });
    return;
  }

  if (url.pathname === "/api/bookings" && method === "POST") {
    if (!isJsonContentType(request.headers["content-type"])) {
      rejectUnconsumedBody(request, response, "Send a JSON booking request.");
      return;
    }
    const body = await readJsonBody(request, response);
    if (body === BODY_TOO_LARGE) return;
    const input = parseBookingInput(body, now());
    const startHour = Number(input.startTime.slice(0, 2));
    const booking: BookingRecord = {
      id: randomUUID(),
      ...input,
      endTime: `${String(startHour + 1).padStart(2, "0")}:00`,
    };
    try {
      database
        .prepare(
          `INSERT INTO bookings (id, room_id, date, start_time, name, email)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(booking.id, booking.roomId, booking.date, booking.startTime, booking.name, booking.email);
    } catch (error) {
      if (isSlotUniqueConflict(error)) {
        sendError(response, 409, "SLOT_UNAVAILABLE", "This time slot is no longer available.");
        return;
      }
      throw error;
    }

    sendJson(response, 201, booking);
    return;
  }

  if (["/api/rooms", "/api/availability", "/api/bookings"].includes(url.pathname)) {
    response.setHeader("Allow", allowedMethods(url.pathname));
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This method is not allowed for this route.");
    return;
  }

  if (!url.pathname.startsWith("/api/") && (method === "GET" || method === "HEAD")) {
    await serveStaticFile(request, response, staticDirectory, url.pathname);
    return;
  }

  sendError(response, 404, "NOT_FOUND", "Route not found.");
}

async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  staticDirectory: string,
  encodedPathname: string,
) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    sendError(response, 404, "NOT_FOUND", "File not found.");
    return;
  }

  if (pathname.includes("\0")) {
    sendError(response, 404, "NOT_FOUND", "File not found.");
    return;
  }

  const rootPath = resolve(staticDirectory);
  const targetPath = resolve(rootPath, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!isWithinDirectory(rootPath, targetPath)) {
    sendError(response, 404, "NOT_FOUND", "File not found.");
    return;
  }

  try {
    const rootRealPath = await realpath(rootPath);
    const targetRealPath = await realpath(targetPath);
    if (!isWithinDirectory(rootRealPath, targetRealPath)) {
      sendError(response, 404, "NOT_FOUND", "File not found.");
      return;
    }
    if ((await stat(targetRealPath)).isFile()) {
      await sendStaticFile(response, targetRealPath, request.method === "HEAD");
      return;
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  if (pathname === "/") {
    sendError(response, 404, "NOT_FOUND", "File not found.");
    return;
  }
  if (extname(pathname) !== "") {
    sendError(response, 404, "NOT_FOUND", "File not found.");
    return;
  }

  await serveSpaFallback(response, rootPath, request.method === "HEAD");
}

async function serveSpaFallback(response: ServerResponse, rootPath: string, isHeadRequest: boolean) {
  try {
    const rootRealPath = await realpath(rootPath);
    const indexPath = await realpath(resolve(rootRealPath, "index.html"));
    if (!isWithinDirectory(rootRealPath, indexPath) || !(await stat(indexPath)).isFile()) {
      sendError(response, 404, "NOT_FOUND", "File not found.");
      return;
    }
    await sendStaticFile(response, indexPath, isHeadRequest);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    sendError(response, 404, "NOT_FOUND", "File not found.");
  }
}

async function sendStaticFile(response: ServerResponse, path: string, isHeadRequest: boolean) {
  const content = await readFile(path);
  const extension = extname(path).toLowerCase();
  response.writeHead(200, {
    "Content-Type": staticContentType(extension),
    "Content-Length": content.byteLength,
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(isHeadRequest ? undefined : content);
}

function staticContentType(extension: string): string {
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return contentTypes[extension] ?? "application/octet-stream";
}

function isWithinDirectory(rootPath: string, targetPath: string): boolean {
  const pathFromRoot = relative(rootPath, targetPath);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readJsonBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<unknown | typeof BODY_TOO_LARGE> {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    rejectUnconsumedBody(request, response, "Booking request is too large.");
    return BODY_TOO_LARGE;
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  const body = await new Promise<Buffer | typeof BODY_TOO_LARGE>((resolveBody, reject) => {
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        cleanup();
        rejectUnconsumedBody(request, response, "Booking request is too large.");
        resolveBody(BODY_TOO_LARGE);
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      resolveBody(Buffer.concat(chunks));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAborted = () => {
      cleanup();
      reject(new ValidationError("Send a complete JSON booking request."));
    };

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
  if (body === BODY_TOO_LARGE) return BODY_TOO_LARGE;

  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new ValidationError("Send valid JSON.");
  }
}

function rejectUnconsumedBody(request: IncomingMessage, response: ServerResponse, message: string) {
  request.pause();
  response.shouldKeepAlive = false;
  response.setHeader("Connection", "close");
  sendError(response, 400, "VALIDATION_ERROR", message);
}

function singleQueryValue(parameters: URLSearchParams, key: string): string | null {
  const values = parameters.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  return typeof value === "string" && /^application\/json(?:\s*;|\s*$)/i.test(value);
}

function isSlotUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    (error as { errcode?: unknown }).errcode === 2067
  );
}

function allowedMethods(path: string): string {
  return path === "/api/bookings" ? "POST" : "GET";
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, code: string, message: string) {
  sendJson(response, status, { error: { code, message } });
}

export { moscowDateTime };
