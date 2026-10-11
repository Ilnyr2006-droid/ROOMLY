import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  createBooking,
  getAvailability,
  getRooms,
  type Availability,
  type BookingConfirmation,
  type Room,
} from './api';

type RequestState = 'loading' | 'ready' | 'error';

const ROOM_IMAGES: Record<string, string> = {
  garden: '/images/room-library.jpg',
  atelier: '/images/room-atelier.jpg',
  forum: '/images/room-boardroom.jpg',
};

const ROOM_NUMBERS: Record<string, string> = {
  garden: '01',
  atelier: '02',
  forum: '03',
};

function moscowToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function moscowTime(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}`;
}

function isPastSlot(date: string, start: string): boolean {
  const today = moscowToday();
  return date < today || (date === today && start <= moscowTime());
}

function bookingDates(from: string): string[] {
  const [year, month, day] = from.split('-').map(Number);
  return Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return date.toISOString().slice(0, 10);
  });
}

function dateAtUtcNoon(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function weekday(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(dateAtUtcNoon(value)).replace('.', '');
}

function shortDate(value: string): { day: string; month: string } {
  const date = dateAtUtcNoon(value);
  return {
    day: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', timeZone: 'UTC' }).format(date),
    month: new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' })
      .format(date)
      .replace('.', ''),
  };
}

function longDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dateAtUtcNoon(value));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requestError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 400) return 'Не удалось проверить запрос. Обновите данные и попробуйте ещё раз.';
  if (error.status === 404) return 'Не удалось найти выбранную комнату или дату.';
  if (typeof error.status === 'number' && error.status >= 500) {
    return 'Сервис временно недоступен. Попробуйте ещё раз чуть позже.';
  }
  if (typeof error.status === 'number') return fallback;
  return error.message || fallback;
}

function bookingRequestError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Проверьте имя, почту и выбранное время.';
    if (error.status === 409) return 'Это время уже заняли. Обновляю расписание — выберите другой час.';
    if (typeof error.status === 'number' && error.status >= 500) {
      return 'Сейчас не удалось создать бронь. Попробуйте ещё раз чуть позже.';
    }
    if (typeof error.status === 'number') return 'Не удалось отправить бронь. Проверьте данные и попробуйте ещё раз.';
    return error.message;
  }
  return 'Не удалось отправить бронь. Проверьте соединение и попробуйте ещё раз.';
}

function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsState, setRoomsState] = useState<RequestState>('loading');
  const [roomsError, setRoomsError] = useState('');
  const [roomsAttempt, setRoomsAttempt] = useState(0);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [moscowDay, setMoscowDay] = useState(moscowToday);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityState, setAvailabilityState] = useState<RequestState>('loading');
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [selectedStartTime, setSelectedStartTime] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirmation) confirmationHeadingRef.current?.focus();
  }, [confirmation]);

  useEffect(() => {
    const updateMoscowDay = () => setMoscowDay(moscowToday());
    const timer = window.setInterval(updateMoscowDay, 30_000);
    window.addEventListener('focus', updateMoscowDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateMoscowDay);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setRoomsState('loading');
    setRoomsError('');

    getRooms(controller.signal)
      .then((nextRooms) => {
        setRooms(nextRooms);
        setRoomsState('ready');
        setSelectedRoomId((current) =>
          nextRooms.some((room) => room.id === current) ? current : (nextRooms[0]?.id ?? ''),
        );
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setRoomsError(requestError(error, 'Не удалось загрузить комнаты. Проверьте соединение и попробуйте ещё раз.'));
        setRoomsState('error');
      });

    return () => controller.abort();
  }, [roomsAttempt]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const dates = useMemo(() => bookingDates(moscowDay), [moscowDay]);
  const visibleDate = selectedDate || dates[0];
  const selectedSlot = availability?.roomId === selectedRoomId && availability.date === visibleDate
    ? availability.slots.find(
      (slot) => slot.startTime === selectedStartTime && slot.available && !isPastSlot(visibleDate, slot.startTime),
      )
    : undefined;
  const availableSlotCount = availability?.slots.filter(
    (slot) => slot.available && !isPastSlot(visibleDate, slot.startTime),
  ).length ?? 0;

  useEffect(() => {
    if (selectedDate && !dates.includes(selectedDate)) setSelectedDate('');
  }, [dates, selectedDate]);

  useEffect(() => {
    if (!selectedRoom) {
      setAvailability(null);
      setAvailabilityState('loading');
      return;
    }

    const controller = new AbortController();
    const roomId = selectedRoom.id;
    setAvailability(null);
    setAvailabilityError('');
    setAvailabilityState('loading');
    setSelectedStartTime('');

    async function loadAvailability() {
      try {
        if (!selectedDate) {
          let firstDayAvailability: Availability | null = null;
          for (const date of dates) {
            const nextAvailability = await getAvailability(roomId, date, controller.signal);
            firstDayAvailability ??= nextAvailability;
            if (nextAvailability.slots.some((slot) => slot.available && !isPastSlot(date, slot.startTime))) {
              setAvailability(nextAvailability);
              setAvailabilityState('ready');
              setSelectedDate(date);
              return;
            }
          }
          setAvailability(firstDayAvailability);
          setAvailabilityState('ready');
          setSelectedDate(dates[0] ?? '');
          return;
        }

        const nextAvailability = await getAvailability(roomId, selectedDate, controller.signal);
        setAvailability(nextAvailability);
        setAvailabilityState('ready');
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        setAvailabilityError(
          requestError(error, 'Не удалось загрузить расписание. Проверьте соединение и попробуйте ещё раз.'),
        );
        setAvailabilityState('error');
      }
    }

    void loadAvailability();

    return () => controller.abort();
  }, [selectedRoom?.id, selectedDate, availabilityAttempt, dates]);

  function selectRoom(roomId: string) {
    setSelectedRoomId(roomId);
    setSelectedStartTime('');
    setBookingError('');
    setConfirmation(null);
  }

  function selectDate(date: string) {
    setSelectedDate(date);
    setSelectedStartTime('');
    setBookingError('');
    setConfirmation(null);
  }

  function selectTime(time: string) {
    setSelectedStartTime(time);
    setBookingError('');
    setConfirmation(null);
  }

  async function handleBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRoom || !selectedSlot || submitting) return;

    setSubmitting(true);
    setBookingError('');
    setConfirmation(null);
    try {
      const result = await createBooking({
        roomId: selectedRoom.id,
        date: selectedDate,
        startTime: selectedSlot.startTime,
        name: name.trim(),
        email: email.trim(),
      });
      setConfirmation(result);
      setAvailabilityAttempt((attempt) => attempt + 1);
    } catch (error) {
      setBookingError(bookingRequestError(error));
      if (error instanceof ApiError && error.status === 409) {
        setSelectedStartTime('');
        setAvailabilityAttempt((attempt) => attempt + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">К содержанию</a>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="ROOMLY — на главную">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">ROOMLY<span className="brand-period">.</span></span>
        </a>
        <nav className="primary-nav" aria-label="Основная навигация">
          <a href="#rooms">Комнаты</a>
          <a href="#booking">Бронирование</a>
        </nav>
        <a className="header-cta" href="#booking">
          Выбрать время <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main id="main-content">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> ПРОСТРАНСТВА ДЛЯ ВАЖНЫХ ВСТРЕЧ</p>
            <h1 id="hero-title">Место, где<br />встречи <em>складываются.</em></h1>
            <p className="hero-description">
              Три комнаты с характером — для разговоров, решений и идей, которым нужен простор.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#rooms">
                Найти свою комнату <span aria-hidden="true">→</span>
              </a>
              <p className="hero-hours"><span aria-hidden="true">◷</span> Каждый день, 09:00–18:00<br /><span className="hero-hours-sub">Время — московское</span></p>
            </div>
            <div className="hero-caption">
              <span className="caption-rule" aria-hidden="true" />
              <span>Пространство для ясных мыслей</span>
            </div>
          </div>

          <figure className="hero-photo-wrap">
            <img
              className="hero-photo"
              src="/images/room-hero.jpg"
              alt="Светлая переговорная с длинным столом у больших окон"
              fetchPriority="high"
            />
            <figcaption className="photo-note">
              <span className="photo-note-mark" aria-hidden="true">R / 01</span>
              <span>ТИШИНА. СВЕТ. ВАШ РИТМ.</span>
            </figcaption>
            <span className="photo-index" aria-hidden="true">01 — 03</span>
          </figure>
        </section>

        <div className="facts-strip" aria-label="Условия бронирования">
          <p><span className="fact-index">01</span> Почасовое бронирование</p>
          <span className="facts-divider" aria-hidden="true" />
          <p><span className="fact-index">02</span> На ближайшие 14 дней</p>
          <span className="facts-divider" aria-hidden="true" />
          <p><span className="fact-index">03</span> Подтверждение онлайн</p>
        </div>

        <section className="rooms-section section-wrap" id="rooms" aria-labelledby="rooms-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">КОМНАТЫ ROOMLY</p>
              <h2 id="rooms-title">У каждой — свой <em>темп.</em></h2>
            </div>
            <p className="section-intro">
              Выберите пространство по настроению встречи. Свободное время появится сразу после выбора.
            </p>
          </div>

          {roomsState === 'loading' && (
            <div className="room-grid" role="status" aria-label="Загрузка комнат" aria-busy="true">
              <span className="sr-only">Загружаем комнаты…</span>
              {Array.from({ length: 3 }, (_, index) => <div className="room-skeleton" key={index} />)}
            </div>
          )}

          {roomsState === 'error' && (
            <div className="state-panel state-panel-error" role="alert">
              <span className="state-symbol" aria-hidden="true">!</span>
              <div>
                <h3>Не получилось загрузить комнаты</h3>
                <p>{roomsError}</p>
              </div>
              <button className="button button-outline" type="button" onClick={() => setRoomsAttempt((attempt) => attempt + 1)}>
                Повторить
              </button>
            </div>
          )}

          {roomsState === 'ready' && rooms.length === 0 && (
            <div className="state-panel" role="status">
              <span className="state-symbol" aria-hidden="true">—</span>
              <div>
                <h3>Комнат пока нет</h3>
                <p>Каталог сейчас пуст. Загляните сюда позже.</p>
              </div>
            </div>
          )}

          {roomsState === 'ready' && rooms.length > 0 && (
            <div className="room-grid" aria-label="Выберите комнату">
              {rooms.map((room, index) => {
                const number = ROOM_NUMBERS[room.id] ?? String(index + 1).padStart(2, '0');
                const image = ROOM_IMAGES[room.id] ?? '/images/room-hero.jpg';
                const isSelected = room.id === selectedRoomId;
                return (
                  <button
                    className={`room-card${isSelected ? ' room-card-selected' : ''}`}
                    data-testid={`room-card-${room.id}`}
                    type="button"
                    key={room.id}
                    aria-pressed={isSelected}
                    aria-label={`${room.name}, до ${room.capacity} участников. ${isSelected ? 'Выбрана' : 'Выбрать комнату'}`}
                    onClick={() => selectRoom(room.id)}
                  >
                    <span className="room-image-frame">
                      <img src={image} alt="" loading="lazy" />
                      <span className="illustrative-label">Иллюстрация</span>
                      <span className="room-number">{number}<span> / ROOM</span></span>
                      <span className="room-floor" aria-hidden="true"><i /><i /><i /></span>
                      <span className="room-image-action" aria-hidden="true">{isSelected ? 'Выбрана' : 'Выбрать'} <b>↗</b></span>
                    </span>
                    <span className="room-card-body">
                      <span className="room-title-line">
                        <span className="room-name">{room.name}</span>
                        <span className="room-capacity"><span aria-hidden="true">○</span> до {room.capacity} {room.capacity === 1 ? 'человека' : 'человек'}</span>
                      </span>
                      <span className="room-description">{room.description}</span>
                      <span className="room-features">
                        {room.features.map((feature) => <span className="feature-chip" key={feature}>{feature}</span>)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="booking-section" id="booking" aria-labelledby="booking-title">
          <div className="booking-heading section-wrap">
            <div>
              <p className="eyebrow eyebrow-light"><span className="eyebrow-dot" /> ВАШ СЛЕДУЮЩИЙ ШАГ</p>
              <h2 id="booking-title">Встреча начинается<br />с <em>одного выбора.</em></h2>
            </div>
            <p className="booking-heading-note">Выберите дату и свободный час.<br />Остальное займёт минуту.</p>
          </div>

          <div className="booking-layout section-wrap">
            <div className="availability-panel">
              <div className="booking-step-heading">
                <span className="step-number">01</span>
                <div>
                  <h3>Когда вам удобно?</h3>
                  <p>Выберите дату и свободный час</p>
                </div>
              </div>

              <p className="date-hint">Листайте даты <span aria-hidden="true">→</span></p>

              <div className="date-picker" role="group" aria-label="Дата встречи">
                {dates.map((date, index) => {
                  const label = shortDate(date);
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      className={`date-option${isSelected ? ' date-option-selected' : ''}`}
                      data-testid={`date-option-${date}`}
                      type="button"
                      key={date}
                      aria-pressed={isSelected}
                      aria-label={`${index === 0 ? 'Сегодня, ' : ''}${weekday(date)}, ${label.day} ${label.month}`}
                      onClick={() => selectDate(date)}
                    >
                      <span className="date-weekday">{index === 0 ? 'сегодня' : weekday(date)}</span>
                      <span className="date-day">{label.day}</span>
                      <span className="date-month">{label.month}</span>
                    </button>
                  );
                })}
              </div>

              <div className="time-heading">
                <div>
                  <h4>Свободное время</h4>
                  <p>{selectedRoom ? selectedRoom.name : 'Сначала выберите комнату'} · {longDate(visibleDate)}</p>
                </div>
                <span className="timezone-label">МОСКВА · UTC+3</span>
              </div>

              <p className="sr-only" role="status" aria-live="polite">
                {availabilityState === 'loading'
                  ? 'Загружаем свободное время.'
                  : availabilityState === 'error'
                    ? availabilityError
                    : `Свободных часов: ${availableSlotCount}. Время указано по Москве.`}
              </p>

              {availabilityState === 'loading' && selectedRoom && (
                <div className="time-grid time-grid-loading" aria-label="Загрузка расписания" aria-busy="true">
                  {Array.from({ length: 9 }, (_, index) => <span className="time-skeleton" key={index} />)}
                </div>
              )}

              {availabilityState === 'error' && selectedRoom && (
                <div className="inline-state" role="alert">
                  <p>{availabilityError}</p>
                  <button className="text-button" type="button" onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)}>
                    Загрузить ещё раз <span aria-hidden="true">→</span>
                  </button>
                </div>
              )}

              {availabilityState === 'ready' && availability && (
                availability.slots.length > 0 ? (
                  <div className="time-grid" role="group" aria-label="Свободное время, один час">
                    {availability.slots.map((slot) => {
                          const isSelected = selectedStartTime === slot.startTime;
                          const isPast = isPastSlot(visibleDate, slot.startTime);
                          const canBook = slot.available && !isPast;
                          const statusLabel = isPast ? 'прошло' : 'занято';
                          return (
                            <button
                          className={`time-option${isSelected ? ' time-option-selected' : ''}${canBook ? '' : ' time-option-disabled'}`}
                          data-testid={`time-option-${slot.startTime}`}
                          type="button"
                          key={slot.startTime}
                          disabled={!canBook || submitting}
                          aria-pressed={isSelected}
                          aria-label={canBook
                            ? `${slot.startTime}–${slot.endTime}, свободно`
                            : `${slot.startTime}–${slot.endTime}, ${statusLabel}`}
                          onClick={() => selectTime(slot.startTime)}
                        >
                          <span>{slot.startTime}</span>
                          {!canBook && <small>{statusLabel}</small>}
                          {isSelected && <span className="selected-check" aria-hidden="true">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="empty-availability" role="status">На эту дату расписание недоступно.</p>
                )
              )}

              {availabilityState === 'ready' && availability && availability.slots.length > 0 && availableSlotCount === 0 ? (
                <p className="empty-availability" role="status">На этот день свободного времени нет. Попробуйте другую дату.</p>
              ) : null}

              <p className="availability-note"><span aria-hidden="true">●</span> Часовой слот · свободные часы отмечены зелёным</p>
            </div>

            <aside className="booking-card" aria-labelledby="booking-form-title">
              <div className="booking-step-heading booking-step-heading-dark">
                <span className="step-number">02</span>
                <div>
                  <h3 id="booking-form-title">Кто будет на встрече?</h3>
                  <p>Подтверждение появится здесь после бронирования</p>
                </div>
              </div>

              {confirmation ? (
                <div className="confirmation" role="status" aria-live="polite">
                  <span className="confirmation-icon" aria-hidden="true">✓</span>
                  <p className="confirmation-kicker">БРОНЬ ПОДТВЕРЖДЕНА</p>
                  <h4 ref={confirmationHeadingRef} tabIndex={-1}>Всё готово.</h4>
                  <p className="confirmation-detail">{rooms.find((room) => room.id === confirmation.roomId)?.name} · {longDate(confirmation.date)} · {confirmation.startTime}–{confirmation.endTime}</p>
                  <p className="confirmation-number">Номер брони <strong>{confirmation.id}</strong></p>
                  <button className="text-button text-button-dark" type="button" onClick={() => setConfirmation(null)}>
                    Забронировать ещё <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : (
                <form className="booking-form" onSubmit={handleBooking}>
                  <div className="booking-summary">
                    <span className="summary-label">ВАШ ВЫБОР</span>
                    <strong>{selectedRoom?.name ?? (roomsState === 'loading' ? 'Загружаем комнаты…' : 'Выберите комнату')}</strong>
                    <span>{selectedSlot
                      ? `${longDate(visibleDate)} · ${selectedSlot.startTime}–${selectedSlot.endTime}`
                      : 'Выберите свободный час в расписании'}</span>
                  </div>

                  <label className="form-field">
                    <span>Ваше имя <b className="required-mark" aria-hidden="true">*</b></span>
                    <input
                      type="text"
                      data-testid="booking-name"
                      name="name"
                      autoComplete="name"
                      maxLength={100}
                      placeholder="Как к вам обращаться"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      disabled={submitting}
                    />
                  </label>

                  <label className="form-field">
                    <span>Электронная почта <b className="required-mark" aria-hidden="true">*</b></span>
                    <input
                      type="email"
                      data-testid="booking-email"
                      name="email"
                      autoComplete="email"
                      maxLength={254}
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      disabled={submitting}
                    />
                  </label>

                  {bookingError && <p className="booking-error" role="alert">{bookingError}</p>}

                  <button className="button button-submit" data-testid="booking-submit" type="submit" disabled={!selectedRoom || !selectedSlot || submitting}>
                    {submitting ? 'Отправляем…' : 'Забронировать комнату'}
                    {!submitting && <span aria-hidden="true">→</span>}
                  </button>
                  <p className="form-footnote">Нажимая кнопку, вы отправляете запрос на бронирование выбранного часа.</p>
                </form>
              )}
            </aside>
          </div>
        </section>
      </main>

      <footer className="site-footer section-wrap">
        <a className="brand footer-brand" href="#top" aria-label="ROOMLY — наверх">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">ROOMLY<span className="brand-period">.</span></span>
        </a>
        <p>Хорошие встречи заслуживают хорошего места.</p>
        <a className="back-to-top" href="#top">Наверх <span aria-hidden="true">↑</span></a>
      </footer>
    </div>
  );
}

export default App;
