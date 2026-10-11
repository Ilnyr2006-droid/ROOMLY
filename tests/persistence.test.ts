import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, expect, test } from 'vitest';
import { createApp } from '../server/index.js';

const directory = join(process.cwd(), '.test-data', randomUUID());
mkdirSync(directory, { recursive: true });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('a booking remains unavailable after the server is restarted with the same SQLite file', async () => {
  const databasePath = join(directory, 'bookings.sqlite');
  const now = () => new Date('2026-10-12T03:00:00.000Z');
  const first = createApp({ databasePath, now });
  const firstUrl = await listen(first);
  try {
    const response = await fetch(`${firstUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'garden',
        date: '2026-10-12',
        startTime: '09:00',
        name: 'Первый гость',
        email: 'first@example.com',
      }),
    });
    expect(response.status).toBe(201);
  } finally {
    await close(first);
  }

  const second = createApp({ databasePath, now });
  const secondUrl = await listen(second);
  try {
    const response = await fetch(
      `${secondUrl}/api/availability?roomId=garden&date=2026-10-12`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { slots: { startTime: string; available: boolean }[] };
    expect(payload.slots.find((slot) => slot.startTime === '09:00')?.available).toBe(false);
  } finally {
    await close(second);
  }
});
