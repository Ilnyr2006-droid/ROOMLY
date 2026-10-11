# ROOMLY design system

## Product and audience

ROOMLY helps small teams find and reserve a meeting room without a back-and-forth. The interface is Russian-language and keeps room details, Moscow time, and booking status clear at every step.

**Positioning:** warm, considered, precise.

## Creative direction

**A small design hotel meets a precise timetable.** Treat rooms like welcoming hospitality spaces and the schedule like a dependable instrument. Use editorial typography and a single photographic anchor in the hero. Keep the booking path obvious without turning the page into a generic SaaS dashboard.

Avoid random gradients, glass panels, dense bento layouts, decorative analytics, fabricated prices or addresses, and availability communicated by color alone.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#F4F1EA` | Main page background |
| Warm white | `#FFFDF8` | Raised surfaces and forms |
| Ink | `#202A26` | Main text and controls |
| Forest | `#315749` | Primary action and selected states |
| Forest deep | `#223D34` | Booking section background |
| Clay | `#A9573B` | Primary booking action and accents |
| Sage | `#E8EEE7` | Available slots and quiet surfaces |
| Bark | `#696961` | Supporting text |
| Line | `#D8D4CA` | Borders and separators |

Use ink on paper or warm white for body copy. Check contrast before using clay for small text. Pair every status color with a visible word or icon.

## Type and layout

- Headlines use the system serif stack with Georgia fallback. Interface text uses the platform sans stack and times use the platform monospace stack; no remote font is required.
- Use tabular numerals for dates, capacities, and times.
- Keep a comfortable editorial measure for descriptive copy and a compact, aligned measure for schedules and booking fields.
- The hero introduces the service and leads directly into room discovery. Room listings use a large, consistent photograph, a discreet room-number/wayfinding cue, capacity, concise description, features, and a clear booking action.
- The schedule groups dates and hourly slots into a single readable booking area. A slot runs for one hour; starts are 09:00 through 17:00 and 18:00 is the closing time. All labels use `Europe/Moscow`.

## Components and states

- Navigation uses real links and buttons with visible focus.
- Date, room, and slot controls have persistent labels and are keyboard operable.
- Available slots, occupied slots, and past slots have both a text label and a distinct visual treatment. Occupied and past slots are disabled.
- Booking forms identify required fields, show server validation beside the relevant field, preserve entered values on a conflict, and announce errors and confirmation to assistive technology.
- Loading, empty, offline/error, conflict, and success states are designed explicitly. Success appears only after the server confirms the reservation.
- Confirmation contains only the booking just created. Other bookings and their personal data are never rendered.

## Motion

Use short transitions (about 140–200 ms) for selection, disclosure, and confirmation. Motion should explain state changes, not decorate the page. Disable nonessential movement under `prefers-reduced-motion: reduce`.

## Responsive behavior and accessibility

- Support widths from 390 px upward, with deliberate layouts at 390, 768, and 1440 px.
- On phones, prioritize date selection, available rooms, slot choice, and the booking action; stack room details and use a compact list of time choices instead of a dense timetable.
- Keep interactive targets at least 44 × 44 px, maintain logical heading order, provide meaningful image alt text, and never make hover the only way to find information.
- Use semantic buttons, links, form labels, and a clearly announced booking result. Focus remains visible and moves to a dialog or confirmation heading when appropriate.
- Honor reduced motion and verify text/control contrast to WCAG AA wherever practical.

## Photography and content integrity

The four image files are bundled locally in `public/images/`. Each is an Unsplash photograph used under the [Unsplash License](https://unsplash.com/license). These are illustrative stock images for a fictional prototype; they do not depict the actual reservable rooms.

| Local file | Photographer | Exact source page |
| --- | --- | --- |
| `room-hero.jpg` | Caroline Badran | [Modern office interior with glass walls and plants](https://unsplash.com/photos/modern-office-interior-with-glass-walls-and-plants-B74lBYC3PXI) |
| `room-library.jpg` | Slidebean | [Empty meeting room](https://unsplash.com/photos/empty-meeting-room-6MtJ-y1hzTs) |
| `room-atelier.jpg` | David Kristianto | [Modern conference room with chairs and table](https://unsplash.com/photos/modern-conference-room-with-chairs-and-table-6jpbs2ykacU) |
| `room-boardroom.jpg` | Caroline Badran | [Modern conference room with leather chairs and table](https://unsplash.com/photos/modern-conference-room-with-leather-chairs-and-table-Q31mm9jfUWU) |

Room cards label the image as an illustration. Their `alt` text is empty because the photo is decorative and each room button has an accessible name containing the room name and capacity.

Room capacity and descriptions are product examples for the prototype. Do not add claims about venue address, equipment, prices, ratings, opening hours, or availability beyond the API's returned schedule.

## Implemented booking details

- The client follows the backend contract: a room array with `features`, availability `{ roomId, date, timezone, slots: [{ startTime, endTime, available }] }`, and booking request `{ roomId, date, startTime, name, email }` with a bare booking record in the response. Room imagery maps to the current `garden`, `atelier`, and `forum` IDs.
- On first load, it scans the 14 Moscow calendar dates in order and selects the first one with a future available slot. Past slots are labeled separately from booked slots and cannot be selected.
- Booking success is shown in the page. No email confirmation is promised because the prototype does not send email.
- The 14-day range rolls over using `Europe/Moscow`; a `409` refreshes the selected room/date schedule and asks the visitor to choose another available hour.

## Governance

Sol owns product scope and technical acceptance. Design direction is informed by the Design Director; Frontend owns implementation; Visual QA supplies browser evidence. This file records the approved visual direction for the ROOMLY prototype.
