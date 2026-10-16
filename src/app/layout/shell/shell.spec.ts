import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import { AuthenticationResponse, Permission } from '../../core/api/models';
import { Auth } from '../../core/auth/auth';
import { authInterceptor } from '../../core/auth/auth-interceptor';
import { Shell } from './shell';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const NOTIFICATIONS_URL = `${environment.apiBaseUrl}/notifications`;
const UNREAD_COUNT_URL = `${environment.apiBaseUrl}/notifications/unread-count`;

interface NavLink {
  path: string;
  label: string;
  icon: string;
  exact: boolean;
}

interface Bindings {
  sections: () => { label: string; links: NavLink[] }[];
  initials: () => string;
  collapsed: () => boolean;
  toggleRail: () => void;
}

function bindingsOf(fixture: ComponentFixture<Shell>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

/** Every path the navigation offers, flattened, so a test can assert on reachability alone. */
function paths(fixture: ComponentFixture<Shell>): string[] {
  return bindingsOf(fixture)
    .sections()
    .flatMap((section) => section.links.map((link) => link.path));
}

describe('Shell', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function render(permissions: Permission[], fullName = 'Farhan Ali'): ComponentFixture<Shell> {
    const auth = TestBed.inject(Auth);
    auth.login({ email: 'someone@example.com', password: 'secret' }).subscribe();
    const session: AuthenticationResponse = {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      userId: 7,
      fullName,
      roles: ['IT_SUPPORT'],
      permissions,
    };
    backend.expectOne(LOGIN_URL).flush(session);

    const fixture = TestBed.createComponent(Shell);
    TestBed.tick();
    return fixture;
  }

  /**
   * The bell's two requests, answered with an empty inbox.
   *
   * <p>They are dispatched from `NotificationCentre`'s own resources rather than by the shell, so
   * they only exist once something has read them - hence the tick before they are expected. Both are
   * matched loosely because the list carries paging parameters and the count does not.
   *
   * <p>Every navigation test needs this: leaving the requests outstanding would make
   * `HttpTestingController.verify()` fail in `afterEach` for a reason unrelated to what was asserted.
   */
  function settleNotifications(fixture: ComponentFixture<Shell>): void {
    TestBed.tick();
    for (const request of backend.match(
      (candidate) => candidate.url === NOTIFICATIONS_URL || candidate.url === UNREAD_COUNT_URL,
    )) {
      request.flush(request.request.url === UNREAD_COUNT_URL ? { unread: 0 } : []);
    }
    TestBed.tick();
    void fixture;
  }

  it('renders the rail and the header for a signed-in user', () => {
    const fixture = render(['TICKET_READ_OWN', 'TICKET_CREATE']);
    settleNotifications(fixture);

    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.app-rail')).not.toBeNull();
    expect(host.querySelector('.app-header')).not.toBeNull();
    expect(host.querySelector('router-outlet')).not.toBeNull();
  });

  describe('navigation', () => {
    it('offers only what the user holds a permission for', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);

      // No TICKET_CREATE, so no "Raise a ticket"; no USER_READ, so no People. The dashboard rides
      // on the same ticket-read pair as the list, so it is present whenever the list is - its
      // figures are counts of exactly those tickets.
      expect(paths(fixture)).toEqual(['/dashboard', '/tickets']);
    });

    it('drops a whole section rather than showing an empty one', () => {
      const fixture = render(['TICKET_READ_OWN', 'TICKET_CREATE']);
      settleNotifications(fixture);

      expect(
        bindingsOf(fixture)
          .sections()
          .map((section) => section.label),
      ).toEqual(['Workspace']);
    });

    it('keeps Applications out of the rail for a requester who can still read it', () => {
      // APPLICATION_READ is held by everyone, because raising a ticket needs the catalogue. The
      // route stays open - reaching it by URL shows a read-only table - but the link is narrower,
      // or every requester would be shown an administration screen.
      const fixture = render(['TICKET_READ_OWN', 'TICKET_CREATE', 'APPLICATION_READ']);
      settleNotifications(fixture);

      expect(paths(fixture)).not.toContain('/admin/applications');
    });

    it('offers Applications to someone who can manage the catalogue', () => {
      const fixture = render(['TICKET_READ_ALL', 'APPLICATION_READ', 'APPLICATION_MANAGE']);
      settleNotifications(fixture);

      expect(paths(fixture)).toContain('/admin/applications');
    });

    it('marks only /tickets as an exact match', () => {
      const fixture = render(['TICKET_READ_ALL', 'TICKET_CREATE']);
      settleNotifications(fixture);

      // Without this, the list stays highlighted while /tickets/new or /tickets/5 is open and two
      // items look selected at once.
      const links = bindingsOf(fixture)
        .sections()
        .flatMap((section) => section.links);

      expect(links.find((link) => link.path === '/tickets')?.exact).toBe(true);
      expect(links.find((link) => link.path === '/tickets/new')?.exact).toBe(false);
    });
  });

  describe('avatar initials', () => {
    it('takes the first letter of the first two names', () => {
      const fixture = render(['TICKET_READ_OWN'], 'Farhan Ali Khan');
      settleNotifications(fixture);

      expect(bindingsOf(fixture).initials()).toBe('FA');
    });

    it('copes with a single name', () => {
      const fixture = render(['TICKET_READ_OWN'], 'Farhan');
      settleNotifications(fixture);

      expect(bindingsOf(fixture).initials()).toBe('F');
    });
  });

  describe('the collapse preference', () => {
    it('is remembered across a reload', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);

      expect(bindingsOf(fixture).collapsed()).toBe(false);
      bindingsOf(fixture).toggleRail();
      TestBed.tick();

      expect(bindingsOf(fixture).collapsed()).toBe(true);
      expect(localStorage.getItem('deskresolver.railCollapsed')).toBe('true');
    });
  });
});
