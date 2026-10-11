# ROOMLY

ROOMLY is a local meeting-room booking app for small teams. It pairs a React interface with a Node REST API and a SQLite booking database. The three rooms and their imagery are illustrative.

## Requirements

- Node.js 22.17 or newer (uses built-in `node:sqlite`)
- npm

## Run locally

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite server proxies `/api` to the Node API on port `3001`. Bookings are stored in `server/data/roomly.sqlite`, which is created on first run. Set `ROOMLY_DB_PATH` to use another SQLite file, and `PORT` to change the API port (update the Vite proxy too when developing on a non-default port).

## Build and checks

```bash
npm run build
npm start
```

`npm start` serves the built app and API at `http://127.0.0.1:3001`.

To run the automated checks:

```bash
npm test
npm run test:e2e
```

The browser suite uses a locally installed Chrome and a separate temporary SQLite file in `.e2e-data`. It checks the user flow at desktop and mobile widths. The server tests include validation, concurrency, and availability after conflict.

## Booking rules

Users can reserve one-hour slots starting at 09:00 through 17:00 Moscow time on the current Moscow date or the following 13 dates. Past or occupied slots cannot be booked. An atomic SQLite uniqueness constraint on room, date, and start time ensures one winner for simultaneous requests; the other request receives HTTP 409. Malformed bookings receive HTTP 400.

The public API exposes the room catalog and slot availability, never another guest's name or email. The successful booking response contains only the caller's newly created booking.

## API

- `GET /api/rooms`
- `GET /api/availability?roomId=garden&date=YYYY-MM-DD`
- `POST /api/bookings` with JSON `{ "roomId", "date", "startTime", "name", "email" }`

No external service account or API key is required.
