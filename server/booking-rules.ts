import { findRoom } from "./catalog.js";

export const BOOKING_DAYS = 14;
export const SLOT_STARTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
] as const;

export type SlotStart = (typeof SLOT_STARTS)[number];

export interface BookingInput {
  roomId: string;
  date: string;
  startTime: SlotStart;
  name: string;
  email: string;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function moscowDateTime(now: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isWithinBookingWindow(date: string, now: Date): boolean {
  const today = moscowDateTime(now).date;
  const todayUtc = Date.parse(`${today}T00:00:00.000Z`);
  const requestedUtc = Date.parse(`${date}T00:00:00.000Z`);
  const dayOffset = (requestedUtc - todayUtc) / 86_400_000;
  return Number.isInteger(dayOffset) && dayOffset >= 0 && dayOffset < BOOKING_DAYS;
}

export function isSlotInFuture(date: string, slot: SlotStart, now: Date): boolean {
  const { date: today, hour } = moscowDateTime(now);
  if (date !== today) return true;
  const [slotHour] = slot.split(":").map(Number);
  return hour < slotHour;
}

export function parseBookingInput(value: unknown, now: Date): BookingInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("Booking must be a JSON object.");
  }

  const body = value as Record<string, unknown>;
  const allowedFields = new Set(["roomId", "date", "startTime", "name", "email"]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new ValidationError("Booking contains an unsupported field.");
  }

  const roomId = requiredString(body.roomId, "roomId", 64);
  const date = requiredString(body.date, "date", 10);
  const startTime = requiredString(body.startTime, "startTime", 5);
  const name = requiredString(body.name, "name", 100);
  const email = requiredString(body.email, "email", 254);

  if (!findRoom(roomId)) throw new ValidationError("Choose a valid room.");
  if (!isValidCalendarDate(date) || !isWithinBookingWindow(date, now)) {
    throw new ValidationError("Choose a date within the next 14 Moscow calendar days.");
  }
  if (!SLOT_STARTS.includes(startTime as SlotStart)) {
    throw new ValidationError("Choose an hourly slot between 09:00 and 18:00.");
  }
  if (!isSlotInFuture(date, startTime as SlotStart, now)) {
    throw new ValidationError("The selected time has already passed.");
  }
  if (!/^(?!\.)(?!.*\.\.)[^\s@]+(?<!\.)@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Enter a valid email address.");
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ValidationError("Enter a valid name.");
  }

  return { roomId, date, startTime: startTime as SlotStart, name, email };
}

export function validateAvailabilityQuery(roomId: string | null, date: string | null, now: Date) {
  if (!roomId || !findRoom(roomId)) throw new ValidationError("Choose a valid room.");
  if (!date || !isValidCalendarDate(date) || !isWithinBookingWindow(date, now)) {
    throw new ValidationError("Choose a date within the next 14 Moscow calendar days.");
  }
  return { roomId, date };
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(`Enter a valid ${field}.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ValidationError(`Enter a valid ${field}.`);
  }
  return normalized;
}
