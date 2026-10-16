import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AuthenticationResponse, NotificationResponse } from './api/models';
import { Auth } from './auth/auth';
import { authInterceptor } from './auth/auth-interceptor';
import { NotificationCentre } from './notifications';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const NOTIFICATIONS_URL = `${environment.apiBaseUrl}/notifications`;
const UNREAD_COUNT_URL = `${environment.apiBaseUrl}/notifications/unread-count`;

function notification(overrides: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'TICKET_STATUS_CHANGED',
    ticketId: 42,
    ticketNumber: 'TKT-000042',
    ticketTitle: 'Attendance report is empty',
    actorId: 9,
    actorFullName: 'Sana Iqbal',
    createdAt: '2026-10-15T08:00:00Z',
    ...overrides,
  };
}

describe('NotificationCentre', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function signIn(): void {
    const auth = TestBed.inject(Auth);
    auth.login({ email: 'someone@example.com', password: 'secret' }).subscribe();
    const session: AuthenticationResponse = {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      userId: 7,
      fullName: 'Farhan Ali',
      roles: ['IT_SUPPORT'],
      permissions: ['TICKET_READ_ALL'],
    };
    backend.expectOne(LOGIN_URL).flush(session);
  }

  /**
   * Signs in, reads the service once to dispatch both requests, and answers them.
   *
   * <p>The microtask between the flush and the tick is load-bearing: `httpResource` writes its value
   * from the response promise, so flushing synchronously queues that write rather than performing
   * it. Without yielding first, every assertion would read the pre-response empty state.
   */
  async function withInbox(
    rows: NotificationResponse[],
    unread = rows.filter((row) => !row.readAt).length,
  ): Promise<NotificationCentre> {
    signIn();
    const centre = TestBed.inject(NotificationCentre);

    expect(centre.list()).toEqual([]);
    centre.count();
    TestBed.tick();

    backend.expectOne((candidate) => candidate.url === NOTIFICATIONS_URL).flush(rows);
    backend.expectOne(UNREAD_COUNT_URL).flush({ unread });
    await Promise.resolve();
    TestBed.tick();

    return centre;
  }

  describe('what it asks for', () => {
    it('reads one page of the inbox and the unread count separately', async () => {
      signIn();
      const centre = TestBed.inject(NotificationCentre);
      centre.list();
      centre.count();
      TestBed.tick();

      const list = backend.expectOne((candidate) => candidate.url === NOTIFICATIONS_URL);
      expect(list.request.params.get('size')).toBe('20');
      expect(list.request.params.get('page')).toBe('0');

      // Two endpoints answering different questions: how many exist, and how many are unread. The
      // second is the badge, and the server serves it from an index over unread rows alone.
      const count = backend.expectOne(UNREAD_COUNT_URL);
      expect(count.request.method).toBe('GET');

      list.flush([]);
      count.flush({ unread: 0 });
      await Promise.resolve();
      TestBed.tick();
    });

    it('asks for nothing at all without a session', () => {
      const centre = TestBed.inject(NotificationCentre);

      expect(centre.list()).toEqual([]);
      expect(centre.count()).toBe(0);
      TestBed.tick();

      // Not merely empty: the request must never be made. The bell lives in the shell, but this is a
      // root singleton and the login screen is the same application - a 401 here would have the
      // interceptor spend a refresh token answering it.
      backend.expectNone((candidate) => candidate.url.startsWith(NOTIFICATIONS_URL));
    });
  });

  describe('the badge', () => {
    it('comes from the count endpoint, not from counting the page', async () => {
      // Three on this page, forty unread in total. Counting the page would report "3" and read as a
      // total, which it is not.
      const centre = await withInbox(
        [
          notification({ id: 1 }),
          notification({ id: 2 }),
          notification({ id: 3, readAt: '2026-10-15T09:00:00Z' }),
        ],
        40,
      );

      expect(centre.count()).toBe(40);
      expect(centre.hasUnread()).toBe(true);
    });

    it('turns urgent only for an unread overdue ticket', async () => {
      const read = await withInbox([
        notification({ id: 1, type: 'TICKET_OVERDUE', readAt: '2026-10-15T09:00:00Z' }),
      ]);
      expect(read.urgent()).toBe(false);
    });

    it('is urgent while an overdue notification is unread', async () => {
      const centre = await withInbox([notification({ id: 1, type: 'TICKET_OVERDUE' })]);
      expect(centre.urgent()).toBe(true);
    });

    it('is not urgent for ordinary news', async () => {
      const centre = await withInbox([
        notification({ id: 1, type: 'TICKET_COMMENTED' }),
        notification({ id: 2, type: 'TICKET_ASSIGNED_TO_YOU' }),
      ]);
      expect(centre.urgent()).toBe(false);
    });
  });

  describe('how a line reads', () => {
    it('leads with the ticket number and follows with the title', async () => {
      const centre = await withInbox([
        notification({ type: 'TICKET_STATUS_CHANGED', newValue: 'IN_PROGRESS' }),
      ]);

      const line = centre.list()[0];
      expect(line.title).toBe('TKT-000042 is now in progress');
      expect(line.detail).toBe('Attendance report is empty');
      expect(line.ticketId).toBe(42);
      expect(line.unread).toBe(true);
    });

    it('calls a resolution good news and anything else merely news', async () => {
      const resolved = await withInbox([
        notification({ type: 'TICKET_STATUS_CHANGED', newValue: 'RESOLVED' }),
      ]);
      expect(resolved.list()[0].tone).toBe('success');
    });

    it('distinguishes the two sides of an assignment without comparing names', async () => {
      // The reason the API reports a recipient-specific type at all: names are not unique, so a
      // client comparing them would show two colleagues each other's assignment as their own.
      const centre = await withInbox([
        notification({ id: 1, type: 'TICKET_ASSIGNED_TO_YOU' }),
        notification({ id: 2, type: 'TICKET_NOW_ASSIGNED', newValue: 'Sana Iqbal' }),
      ]);

      expect(centre.list()[0].title).toBe('TKT-000042 is yours to work');
      expect(centre.list()[1].title).toBe('TKT-000042 was assigned to Sana Iqbal');
    });

    it('names the commenter', async () => {
      const centre = await withInbox([notification({ type: 'TICKET_COMMENTED' })]);
      expect(centre.list()[0].title).toBe('Sana Iqbal commented on TKT-000042');
    });

    it('says who raised a ticket that is waiting to be assigned', async () => {
      const centre = await withInbox([notification({ type: 'TICKET_AWAITING_ASSIGNMENT' })]);

      expect(centre.list()[0].title).toBe('TKT-000042 is waiting to be assigned');
      expect(centre.list()[0].detail).toContain('raised by Sana Iqbal');
      expect(centre.list()[0].tone).toBe('warning');
    });

    it('copes with an overdue notification having no actor', async () => {
      // Nobody causes a deadline to pass, so actorId and actorFullName are both null - and a line
      // that rendered "null commented" would be the visible symptom.
      const centre = await withInbox([
        notification({
          type: 'TICKET_OVERDUE',
          actorId: undefined,
          actorFullName: undefined,
        }),
      ]);

      expect(centre.list()[0].title).toBe('TKT-000042 is past its deadline');
      expect(centre.list()[0].tone).toBe('error');
    });

    it('still says something useful for a type it does not know', async () => {
      // The API gained a type and this build has not caught up. Rendered plainly rather than
      // dropped: a silently shorter list is less use than a vague line.
      const centre = await withInbox([notification({ type: 'TICKET_ESCALATED' as never })]);

      expect(centre.list()[0].title).toBe('TKT-000042 was updated');
      expect(centre.list()[0].tone).toBe('neutral');
    });

    it('marks a read notification as read rather than hiding it', async () => {
      // Read rows stay in the panel: they are legible history, and an inbox somebody has caught up
      // with should look caught up rather than empty.
      const centre = await withInbox([notification({ id: 1, readAt: '2026-10-15T09:00:00Z' })]);

      expect(centre.list()).toHaveLength(1);
      expect(centre.list()[0].unread).toBe(false);
    });
  });

  describe('marking read', () => {
    it('patches the notification and refetches both endpoints', async () => {
      const centre = await withInbox([notification({ id: 5 })]);

      centre.markRead(5);

      const patch = backend.expectOne(`${NOTIFICATIONS_URL}/5/read`);
      expect(patch.request.method).toBe('PATCH');
      patch.flush(null, { status: 204, statusText: 'No Content' });
      await Promise.resolve();
      TestBed.tick();

      // The badge is the server's number. Updating it optimistically here would make two sources of
      // truth for the one figure a user actually watches.
      backend.expectOne((candidate) => candidate.url === NOTIFICATIONS_URL).flush([]);
      backend.expectOne(UNREAD_COUNT_URL).flush({ unread: 0 });
      await Promise.resolve();
      TestBed.tick();

      expect(centre.count()).toBe(0);
    });

    it('refetches even when the patch fails, so the panel does not lie', async () => {
      const centre = await withInbox([notification({ id: 5 })]);

      centre.markRead(5);

      backend
        .expectOne(`${NOTIFICATIONS_URL}/5/read`)
        .flush({ detail: 'nope' }, { status: 500, statusText: 'Server Error' });
      await Promise.resolve();
      TestBed.tick();

      // Still unread, which is the honest outcome - and visible, because the refetch happened
      // anyway rather than leaving the row looking read.
      backend
        .expectOne((candidate) => candidate.url === NOTIFICATIONS_URL)
        .flush([notification({ id: 5 })]);
      backend.expectOne(UNREAD_COUNT_URL).flush({ unread: 1 });
      await Promise.resolve();
      TestBed.tick();

      expect(centre.list()[0].unread).toBe(true);
      expect(centre.count()).toBe(1);
    });

    it('marks everything read in one request', async () => {
      const centre = await withInbox([notification({ id: 1 }), notification({ id: 2 })]);

      centre.markAllRead();

      const post = backend.expectOne(`${NOTIFICATIONS_URL}/read-all`);
      expect(post.request.method).toBe('POST');
      post.flush({ markedRead: 2 });
      await Promise.resolve();
      TestBed.tick();

      backend.expectOne((candidate) => candidate.url === NOTIFICATIONS_URL).flush([]);
      backend.expectOne(UNREAD_COUNT_URL).flush({ unread: 0 });
      await Promise.resolve();
      TestBed.tick();

      expect(centre.hasUnread()).toBe(false);
    });
  });

  describe('failure', () => {
    it('reports that the inbox could not be read', async () => {
      signIn();
      const centre = TestBed.inject(NotificationCentre);
      centre.list();
      centre.count();
      TestBed.tick();

      backend
        .expectOne((candidate) => candidate.url === NOTIFICATIONS_URL)
        .flush(null, { status: 503, statusText: 'Service Unavailable' });
      backend.expectOne(UNREAD_COUNT_URL).flush({ unread: 0 });
      await Promise.resolve();
      TestBed.tick();

      // So the panel can say so. An empty list and a failed one look identical otherwise, and
      // "nothing needs your attention" is the wrong thing to tell somebody whose request failed.
      expect(centre.failed()).toBe(true);
      expect(centre.list()).toEqual([]);
    });
  });
});
