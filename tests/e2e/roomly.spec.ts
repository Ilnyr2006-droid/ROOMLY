import { expect, test } from '@playwright/test';

function moscowDate(offset: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offset));
  return date.toISOString().slice(0, 10);
}

for (const width of [390, 768, 1440]) {
  test(`renders the real catalog without page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.room-grid button')).toHaveCount(3);
    await expect(page.locator('.room-grid img')).toHaveCount(3);
    await expect(page.getByText('Листайте даты')).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )).toBeLessThanOrEqual(1);
  });
}

test('books a room through the UI and shows occupied availability after reload', async ({ page, request }) => {
  const catalog = await request.get('/api/rooms');
  expect(catalog.ok()).toBeTruthy();
  const rooms = await catalog.json() as { id: string }[];

  await page.goto('/');
  await expect(page.locator('.room-grid button')).toHaveCount(3);
  await page.locator('.date-option').nth(1).click();
  const slot = page.locator('.time-option:not([disabled])').first();
  await expect(slot).toBeVisible();
  const start = (await slot.getAttribute('aria-label'))!.slice(0, 5);
  await slot.click();
  await page.getByRole('textbox', { name: 'Ваше имя' }).fill('Тестовый гость');
  await page.getByRole('textbox', { name: 'Электронная почта' }).fill(`roomly-${Date.now()}@example.com`);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/bookings') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Забронировать комнату/ }).click();
  expect((await responsePromise).status()).toBe(201);
  await expect(page.getByText('БРОНЬ ПОДТВЕРЖДЕНА')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Всё готово.' })).toBeFocused();

  const availability = await request.get(`/api/availability?roomId=${rooms[0].id}&date=${moscowDate(1)}`);
  expect(availability.ok()).toBeTruthy();
  const data = await availability.json() as { slots: { startTime: string; available: boolean }[] };
  expect(data.slots.find((item) => item.startTime === start)?.available).toBe(false);
});

test('shows a conflict and refreshes the occupied slot', async ({ page, request }) => {
  const catalog = await request.get('/api/rooms');
  const rooms = await catalog.json() as { id: string }[];
  await page.goto('/');
  await expect(page.locator('.room-grid button')).toHaveCount(3);
  await page.locator('.room-grid button').nth(1).click();
  await page.locator('.date-option').nth(2).click();
  const slot = page.locator('.time-option:not([disabled])').first();
  await expect(slot).toBeVisible();
  const start = (await slot.getAttribute('aria-label'))!.slice(0, 5);
  await slot.click();

  const date = moscowDate(2);
  const competitor = await request.post('/api/bookings', {
    data: { roomId: rooms[1].id, date, startTime: start, name: 'Другой гость', email: 'other@example.com' },
  });
  expect(competitor.status()).toBe(201);

  await page.getByRole('textbox', { name: 'Ваше имя' }).fill('Поздний гость');
  await page.getByRole('textbox', { name: 'Электронная почта' }).fill('late@example.com');
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/bookings') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Забронировать комнату/ }).click();
  expect((await responsePromise).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText('уже заняли');
  await expect(page.locator('.time-option').filter({ hasText: start })).toBeDisabled();
});
