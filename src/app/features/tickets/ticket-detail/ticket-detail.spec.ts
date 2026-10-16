import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { AuthenticationResponse, Permission, TicketResponse } from '../../../core/api/models';
import { Auth } from '../../../core/auth/auth';
import { authInterceptor } from '../../../core/auth/auth-interceptor';
import { TicketDetail } from './ticket-detail';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const TICKET_URL = `${environment.apiBaseUrl}/tickets/7`;

interface Bindings {
  ticketId: () => number | undefined;
  failure: () => { icon: string; text: string } | null;
  canChangeStatus: () => boolean;
  canAssign: () => boolean;
  overdue: () => boolean;
}

function bindingsOf(fixture: ComponentFixture<TicketDetail>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

function ticket(overrides: Partial<TicketResponse> = {}): TicketResponse {
  return {
    id: 7,
    ticketNumber: 'TKT-00000007',
    title: 'Attendance not syncing',
    description: 'Punches are missing for the night shift.',
    issueType: 'BUG',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    createdAt: '2026-10-10T09:00:00Z',
    updatedAt: '2026-10-12T09:00:00Z',
    raisedBy: 'Zain',
    raisedById: 4,
    applicationName: 'HRMS',
    applicationId: 1,
    moduleName: 'Attendance',
    ...overrides,
  };
}

describe('TicketDetail', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function render(
    id: string,
    permissions: Permission[] = ['TICKET_READ_ALL', 'TICKET_READ_OWN'],
  ): ComponentFixture<TicketDetail> {
    const auth = TestBed.inject(Auth);
    auth.login({ email: 'farhan@example.com', password: 'secret' }).subscribe();
    const session: AuthenticationResponse = {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      userId: 42,
      fullName: 'Farhan Ali',
      roles: ['IT_SUPPORT'],
      permissions,
    };
    backend.expectOne(LOGIN_URL).flush(session);

    const fixture = TestBed.createComponent(TicketDetail);
    fixture.componentRef.setInput('id', id);
    TestBed.tick();
    return fixture;
  }

  /**
   * Answers the ticket request, then everything that answer sets off.
   *
   * <p>A loaded ticket renders the comments, attachments and history panels, and each of those
   * fires its own request - so `whenStable()` on its own would deadlock waiting for replies this
   * test has not sent yet. Which panels ask depends on the permissions under test, so rather than
   * naming them, this drains whatever turns up until nothing is left.
   *
   * <p>The microtask await is the other half: `httpResource` publishes its value on a microtask, so
   * a synchronous `tick()` would render the template before the ticket is there to render.
   */
  async function respondWith(
    fixture: ComponentFixture<TicketDetail>,
    body: TicketResponse | null,
    status?: { status: number; statusText: string },
  ) {
    const request = backend.expectOne(TICKET_URL);
    if (status) {
      request.flush(body, status);
    } else {
      request.flush(body);
    }

    for (let pass = 0; pass < 5; pass += 1) {
      await Promise.resolve();
      TestBed.tick();
      const pending = backend.match(() => true);
      if (pending.length === 0) {
        break;
      }
      // Every panel's endpoint returns a JSON array; an empty one is a valid, uninteresting answer.
      pending.forEach((panelRequest) => panelRequest.flush([]));
    }
    await Promise.resolve();
  }

  it('loads the ticket named in the route', async () => {
    const fixture = render('7');
    await respondWith(fixture, ticket());

    expect(bindingsOf(fixture).ticketId()).toBe(7);
    expect(bindingsOf(fixture).failure()).toBeNull();
  });

  it('asks for nothing when the id in the URL is not a ticket id', async () => {
    // A pasted or truncated link. Requesting /api/tickets/NaN would be a 400 presented as though
    // something had gone wrong on the server.
    const fixture = render('not-a-number');

    expect(bindingsOf(fixture).ticketId()).toBeUndefined();
    backend.expectNone(() => true);
    await fixture.whenStable();
  });

  describe('failures', () => {
    it('says "not found, or not yours" on a 404 - the API uses it for both', async () => {
      const fixture = render('7');
      await respondWith(fixture, null, { status: 404, statusText: 'Not Found' });

      const failure = bindingsOf(fixture).failure();
      expect(failure?.text).toContain('does not exist');
      expect(failure?.text).toContain('not one you are involved in');
    });

    it('says something different on a 403, because it is about the account', async () => {
      const fixture = render('7');
      await respondWith(fixture, null, { status: 403, statusText: 'Forbidden' });

      // Collapsing 403 into the 404 wording would tell somebody to go and find the ticket, when the
      // ticket is fine and their permissions are not.
      const failure = bindingsOf(fixture).failure();
      expect(failure?.text).toContain('not allowed to read');
      expect(failure?.text).not.toContain('does not exist');
    });

    it('distinguishes an unreachable server from a refusal', async () => {
      const fixture = render('7');
      await respondWith(fixture, null, { status: 0, statusText: 'Unknown Error' });

      expect(bindingsOf(fixture).failure()?.text).toContain('Cannot reach the server');
    });
  });

  describe('actions', () => {
    it('offers both to support staff', async () => {
      const fixture = render('7', [
        'TICKET_READ_ALL',
        'TICKET_STATUS_CHANGE',
        'TICKET_ASSIGN',
        'USER_READ',
      ]);
      await respondWith(fixture, ticket());

      expect(bindingsOf(fixture).canChangeStatus()).toBe(true);
      expect(bindingsOf(fixture).canAssign()).toBe(true);
    });

    it('hides assignment without USER_READ, even with TICKET_ASSIGN', async () => {
      const fixture = render('7', ['TICKET_READ_OWN', 'TICKET_ASSIGN']);
      await respondWith(fixture, ticket());

      // The picker is a list of users. Allowed to assign but unable to read the directory means a
      // dialog with nothing in it, so the button should not be there at all.
      expect(bindingsOf(fixture).canAssign()).toBe(false);
    });

    it('offers neither to a requester', async () => {
      const fixture = render('7', ['TICKET_READ_OWN']);
      await respondWith(fixture, ticket());

      expect(bindingsOf(fixture).canChangeStatus()).toBe(false);
      expect(bindingsOf(fixture).canAssign()).toBe(false);
    });
  });

  describe('overdue', () => {
    it('flags a past expected-by on an unresolved ticket', async () => {
      const fixture = render('7');
      await respondWith(fixture, ticket({ expectedBy: '2020-01-01T00:00:00Z' }));

      expect(bindingsOf(fixture).overdue()).toBe(true);
    });

    it('does not flag one that was resolved', async () => {
      const fixture = render('7');
      await respondWith(
        fixture,
        ticket({
          expectedBy: '2020-01-01T00:00:00Z',
          resolvedAt: '2020-01-02T00:00:00Z',
          status: 'RESOLVED',
        }),
      );

      // Late, but closed. Shouting "overdue" at a finished ticket is noise in a triage queue.
      expect(bindingsOf(fixture).overdue()).toBe(false);
    });

    it('does not flag one with no expected-by at all', async () => {
      const fixture = render('7');
      await respondWith(fixture, ticket({ expectedBy: undefined }));

      expect(bindingsOf(fixture).overdue()).toBe(false);
    });
  });
});
