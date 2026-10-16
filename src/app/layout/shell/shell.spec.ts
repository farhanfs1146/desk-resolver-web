import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthenticationResponse, Permission } from '../../core/api/models';
import { Auth } from '../../core/auth/auth';
import { authInterceptor } from '../../core/auth/auth-interceptor';
import { CommandPaletteData, PaletteChoice } from '../command-palette/command-palette';
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
  canSearchTickets: () => boolean;
  openPalette: () => void;
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

  /**
   * Raising a ticket is offered in exactly one place: the ticket list's own header.
   *
   * <p>It used to be in three - here, on the dashboard, and there - which is three things to keep
   * worded the same and two of them on screens that are not about creating anything. The rail still
   * carries `/tickets/new` as a *destination*, which is a different claim: navigation says where you
   * may go, and a filled button says what to do next.
   */
  describe('the create action', () => {
    it('is not repeated in the header', () => {
      const fixture = render(['TICKET_READ_OWN', 'TICKET_CREATE']);
      settleNotifications(fixture);

      const header = (fixture.nativeElement as HTMLElement).querySelector('.app-header');

      expect(header).not.toBeNull();
      expect(header?.querySelector('[href="/tickets/new"]')).toBeNull();
    });

    it('is still reachable from the rail, which is navigation rather than a call to action', () => {
      const fixture = render(['TICKET_READ_OWN', 'TICKET_CREATE']);
      settleNotifications(fixture);

      expect(paths(fixture)).toContain('/tickets/new');
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

  /**
   * Ctrl+K and the command palette.
   *
   * <p>The palette's own behaviour - what it lists, what the arrow keys do - is tested beside it in
   * `command-palette.spec.ts`. What belongs here is the three things the shell is responsible for:
   * that the shortcut reaches it and the browser does not keep the keystroke, that the destinations
   * handed to it are the ones the rail already decided on, and that a choice coming back is acted
   * on.
   */
  describe('the command palette', () => {
    /** Stands in for the dialog, so a choice can be handed back without rendering one. */
    function interceptPalette(): {
      open: ReturnType<typeof vi.spyOn>;
      close: (choice: PaletteChoice | undefined) => void;
    } {
      const closed = new Subject<PaletteChoice | undefined>();
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
        afterClosed: () => closed.asObservable(),
      } as unknown as MatDialogRef<unknown>);

      return {
        open,
        close: (choice) => {
          closed.next(choice);
          closed.complete();
          TestBed.tick();
        },
      };
    }

    /** Dispatched on `document`, because that is where the shortcut listens. */
    function pressCtrlK(): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
      document.dispatchEvent(event);
      TestBed.tick();
      return event;
    }

    /** What the palette was handed, from the one call that opened it. */
    function dataFrom(open: ReturnType<typeof vi.spyOn>): CommandPaletteData {
      return (open.mock.calls[0][1] as { data: CommandPaletteData }).data;
    }

    it('is opened by the search box in the header', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();

      const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'app-search-trigger button',
      );

      // It looks like a field and is a button. Somebody who never learns the shortcut still has a
      // way in, which is the entire reason it is drawn at all.
      expect(box).not.toBeNull();
      box?.click();
      TestBed.tick();

      expect(palette.open).toHaveBeenCalledTimes(1);
    });

    it('opens on Ctrl+K, and keeps the keystroke from the browser', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();

      const event = pressCtrlK();

      expect(palette.open).toHaveBeenCalledTimes(1);
      // Firefox focuses its own search bar on Ctrl+K and Chrome puts the address bar into search
      // mode, so without this the palette opens behind a focused address bar.
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores the key without a modifier, and other modified keys', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }));
      TestBed.tick();

      expect(palette.open).not.toHaveBeenCalled();
    });

    it('does not stack a second palette on the first', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();

      pressCtrlK();
      pressCtrlK();
      pressCtrlK();

      expect(palette.open).toHaveBeenCalledTimes(1);

      // And it opens again once that one has gone.
      palette.close(undefined);
      pressCtrlK();
      expect(palette.open).toHaveBeenCalledTimes(2);
    });

    it('offers exactly the destinations the rail offers', () => {
      const fixture = render(['TICKET_READ_OWN', 'TICKET_CREATE']);
      settleNotifications(fixture);
      const palette = interceptPalette();

      pressCtrlK();

      // `Shell.sections` is the one place that decides this. A palette with its own list would be a
      // second answer to the same question.
      expect(dataFrom(palette.open).destinations.map((d) => d.path)).toEqual(paths(fixture));
      expect(dataFrom(palette.open).destinations.map((d) => d.group)).toEqual([
        'Workspace',
        'Workspace',
        'Workspace',
      ]);
    });

    it('tells the palette whether a ticket search is worth offering', () => {
      const allowed = render(['TICKET_READ_OWN']);
      settleNotifications(allowed);
      const first = interceptPalette();
      pressCtrlK();
      expect(dataFrom(first.open).canSearchTickets).toBe(true);
      first.open.mockRestore();

      const refused = render(['APPLICATION_READ']);
      settleNotifications(refused);
      const second = interceptPalette();
      pressCtrlK();
      expect(dataFrom(second.open).canSearchTickets).toBe(false);
      expect(bindingsOf(refused).canSearchTickets()).toBe(false);
    });

    it('goes where a chosen destination points', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      pressCtrlK();
      palette.close({ kind: 'navigate', path: '/dashboard' });

      expect(navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('turns a chosen search into ?q= on the ticket list', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      pressCtrlK();
      palette.close({ kind: 'search', term: 'payslip' });

      // No `replaceUrl`: a palette search is one deliberate act, so Back should return the reader to
      // wherever they searched from.
      expect(navigate).toHaveBeenCalledWith(['/tickets'], { queryParams: { q: 'payslip' } });
    });

    it('does nothing when the palette is dismissed', () => {
      const fixture = render(['TICKET_READ_OWN']);
      settleNotifications(fixture);
      const palette = interceptPalette();
      const byUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      pressCtrlK();
      palette.close(undefined);

      expect(byUrl).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
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
