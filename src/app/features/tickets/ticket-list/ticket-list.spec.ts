import { HttpParams, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Sort } from '@angular/material/sort';
import { provideRouter } from '@angular/router';

import { environment } from '../../../../environments/environment';
import {
  AuthenticationResponse,
  Permission,
  Priority,
  TicketStatus,
} from '../../../core/api/models';
import { Auth } from '../../../core/auth/auth';
import { authInterceptor } from '../../../core/auth/auth-interceptor';
import { TicketList } from './ticket-list';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const TICKETS_URL = `${environment.apiBaseUrl}/tickets`;

/**
 * The component's bindings are `protected`, which is template-only visibility rather than any
 * runtime protection. Naming them here keeps the component's public surface honest while still
 * letting a test drive the filters the way a user would.
 */
interface Bindings {
  status: WritableSignal<TicketStatus | null>;
  priority: WritableSignal<Priority | null>;
  scope: WritableSignal<'involved' | 'raised' | 'assigned'>;
  sort: WritableSignal<Sort>;
  pageIndex: WritableSignal<number>;
  columns: () => string[];
  page: () => { totalCount: number; pageNumber: number; hasNext: boolean };
  scopeLabel: () => string;
}

function bindingsOf(fixture: ComponentFixture<TicketList>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

function session(permissions: Permission[]): AuthenticationResponse {
  return {
    accessToken: 'access-one',
    tokenType: 'Bearer',
    expiresIn: 1800,
    refreshToken: 'refresh-one',
    refreshExpiresIn: 28800,
    userId: 42,
    fullName: 'Farhan Ali',
    roles: ['IT_SUPPORT'],
    permissions,
  };
}

describe('TicketList', () => {
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

  /**
   * Signs in with the given permissions and renders the list.
   *
   * <p>`TestBed.tick()` and not `whenStable()`: the resource dispatches its request from an effect,
   * and with a testing backend nothing answers it until a test says so - so waiting for stability
   * here would deadlock on the very request the test is about to assert.
   */
  function render(permissions: Permission[] = ['TICKET_READ_ALL']): ComponentFixture<TicketList> {
    const auth = TestBed.inject(Auth);
    auth.login({ email: 'farhan@example.com', password: 'secret' }).subscribe();
    backend.expectOne(LOGIN_URL).flush(session(permissions));

    const fixture = TestBed.createComponent(TicketList);
    TestBed.tick();
    return fixture;
  }

  /**
   * Answers the list request currently in flight and returns the parameters it carried.
   *
   * <p>Awaiting stability *after* the flush is both safe and necessary: safe because nothing is
   * pending any more, and necessary because `httpResource` publishes its value on a microtask, so a
   * synchronous `tick()` alone would leave the rows and headers unread.
   */
  async function respond(
    fixture: ComponentFixture<TicketList>,
    body: unknown[] = [],
    headers: Record<string, string> = {},
  ): Promise<HttpParams> {
    const request = backend.expectOne((candidate) => candidate.url === TICKETS_URL);
    const params = request.request.params;
    request.flush(body, { headers });
    await fixture.whenStable();
    return params;
  }

  it('asks for the first page, newest first, with no filters', async () => {
    const fixture = render();
    const params = await respond(fixture);

    expect(params.get('page')).toBe('0');
    expect(params.get('size')).toBe('25');
    expect(params.get('sort')).toBe('createdAt,desc');
    expect(params.has('status')).toBe(false);
    expect(params.has('priority')).toBe(false);
    expect(params.has('raisedBy')).toBe(false);
    expect(params.has('assignedTo')).toBe(false);
  });

  it('attaches the access token, so the list is not an anonymous call', async () => {
    const fixture = render();
    const request = backend.expectOne((candidate) => candidate.url === TICKETS_URL);

    expect(request.request.headers.get('Authorization')).toBe('Bearer access-one');

    request.flush([]);
    await fixture.whenStable();
  });

  it('reads the row count from X-Total-Count, not from the rows it holds', async () => {
    const fixture = render();
    await respond(fixture, [{ id: 1 }, { id: 2 }], {
      'X-Total-Count': '137',
      'X-Page-Number': '0',
      'X-Has-Next': 'true',
    });

    // Two rows on screen, 137 in the result set. A paginator bound to the array length would offer
    // one page and strand the other 135 tickets.
    expect(bindingsOf(fixture).page().totalCount).toBe(137);
    expect(bindingsOf(fixture).page().hasNext).toBe(true);
  });

  it('translates "assigned to me" into the user id, not a name', async () => {
    const fixture = render();
    await respond(fixture);

    bindingsOf(fixture).scope.set('assigned');
    TestBed.tick();
    const params = await respond(fixture);

    expect(params.get('assignedTo')).toBe('42');
    expect(params.has('raisedBy')).toBe(false);
  });

  it('returns to the first page when a filter changes', async () => {
    const fixture = render();
    await respond(fixture);

    bindingsOf(fixture).pageIndex.set(3);
    TestBed.tick();
    expect((await respond(fixture)).get('page')).toBe('3');

    // Page 4 of a narrower result set is usually empty, which reads as "my tickets vanished".
    bindingsOf(fixture).status.set('OPEN');
    bindingsOf(fixture).pageIndex.set(0);
    TestBed.tick();
    const params = await respond(fixture);

    expect(params.get('page')).toBe('0');
    expect(params.get('status')).toBe('OPEN');
  });

  it('sends no sort parameter once sorting is cleared', async () => {
    const fixture = render();
    await respond(fixture);

    // A third click on a Material sort header clears the direction. `sort=createdAt,` would be a
    // 400 from the API rather than a reset to its default order.
    bindingsOf(fixture).sort.set({ active: 'createdAt', direction: '' });
    TestBed.tick();

    expect((await respond(fixture)).has('sort')).toBe(false);
  });

  it('never sends a sort field the API would reject', async () => {
    const fixture = render();
    await respond(fixture);

    // `title` is not in TicketPageRequests.SORTABLE. The column carries no sort header for that
    // reason, but the guard matters because that whitelist lives in another repository.
    bindingsOf(fixture).sort.set({ active: 'title', direction: 'asc' });
    TestBed.tick();

    expect((await respond(fixture)).has('sort')).toBe(false);
  });

  describe('permissions', () => {
    it("shows who raised each ticket when the user sees everyone's", async () => {
      const fixture = render(['TICKET_READ_ALL']);
      await respond(fixture);

      expect(bindingsOf(fixture).columns()).toContain('raisedBy');
      expect(bindingsOf(fixture).scopeLabel()).toBe('All tickets');
    });

    it('hides that column, and claims less, for someone who only sees their own', async () => {
      const fixture = render(['TICKET_READ_OWN']);
      await respond(fixture);

      // It would be a column of their own name repeated down the page - and the server scopes the
      // result set regardless, so calling the unfiltered view "all tickets" would be untrue.
      expect(bindingsOf(fixture).columns()).not.toContain('raisedBy');
      expect(bindingsOf(fixture).scopeLabel()).toBe('Everything I can see');
    });
  });
});
