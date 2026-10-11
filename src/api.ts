export interface Room {
  id: string;
  name: string;
  description: string;
  capacity: number;
  features: string[];
}

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface Availability {
  roomId: string;
  date: string;
  timezone: 'Europe/Moscow';
  slots: AvailabilitySlot[];
}

export interface BookingConfirmation {
  id: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestJson(url: string, init: RequestInit = {}, expectedStatus?: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Сервер пока не отвечает. Проверьте соединение и попробуйте снова.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const code = typeof errorBody?.code === 'string' ? errorBody.code : undefined;
    const message = typeof errorBody?.message === 'string' ? errorBody.message : undefined;
    throw new ApiError(message ?? 'Не удалось выполнить запрос. Попробуйте ещё раз.', response.status, code);
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new ApiError('Сервер не подтвердил бронирование. Обновите расписание и попробуйте ещё раз.', response.status);
  }
  return payload;
}

function parseRoom(value: unknown): Room {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.capacity !== 'number' ||
    !Array.isArray(value.features) ||
    !value.features.every((feature) => typeof feature === 'string')
  ) {
    throw new ApiError('Каталог переговорных пришёл в неожиданном формате. Обновите данные позже.');
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    capacity: value.capacity,
    features: value.features,
  };
}

export async function getRooms(signal?: AbortSignal): Promise<Room[]> {
  const payload = await requestJson('/api/rooms', { signal });
  if (!Array.isArray(payload)) {
    throw new ApiError('Каталог переговорных пришёл в неожиданном формате. Обновите данные позже.');
  }
  return payload.map(parseRoom);
}

export async function getAvailability(
  roomId: string,
  date: string,
  signal?: AbortSignal,
): Promise<Availability> {
  const query = new URLSearchParams({ roomId, date });
  const payload = await requestJson(`/api/availability?${query}`, { signal });
  if (
    !isRecord(payload) ||
    payload.roomId !== roomId ||
    payload.date !== date ||
    payload.timezone !== 'Europe/Moscow' ||
    !Array.isArray(payload.slots)
  ) {
    throw new ApiError('Расписание пришло в неожиданном формате. Попробуйте загрузить его ещё раз.');
  }

  const slots = payload.slots.map((slot): AvailabilitySlot => {
    if (
      !isRecord(slot) ||
      typeof slot.startTime !== 'string' ||
      typeof slot.endTime !== 'string' ||
      typeof slot.available !== 'boolean'
    ) {
      throw new ApiError('Расписание пришло в неожиданном формате. Попробуйте загрузить его ещё раз.');
    }
    return { startTime: slot.startTime, endTime: slot.endTime, available: slot.available };
  });

  return { roomId, date, timezone: 'Europe/Moscow', slots };
}

export async function createBooking(input: {
  roomId: string;
  date: string;
  startTime: string;
  name: string;
  email: string;
}): Promise<BookingConfirmation> {
  const payload = await requestJson('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, 201);
  if (
    !isRecord(payload) ||
    typeof payload.id !== 'string' ||
    payload.roomId !== input.roomId ||
    payload.date !== input.date ||
    payload.startTime !== input.startTime ||
    typeof payload.endTime !== 'string'
  ) {
    throw new ApiError('Сервер подтвердил бронь без данных подтверждения. Обновите расписание.');
  }
  return {
    id: payload.id,
    roomId: payload.roomId,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
  };
}
