import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApplicationResponse, AuthenticationResponse, Permission } from '../../../core/api/models';
import { Auth } from '../../../core/auth/auth';
import { authInterceptor } from '../../../core/auth/auth-interceptor';
import { ApplicationList } from './application-list';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const APPS_URL = `${environment.apiBaseUrl}/applications`;

const ACTIVE_APP: ApplicationResponse = {
  id: 11,
  appName: 'HRMS',
  moduleName: 'Attendance',
  active: true,
};

interface Bindings {
  canManage: () => boolean;
  columns: () => string[];
  deactivate: (application: ApplicationResponse) => void;
}

function bindingsOf(fixture: ComponentFixture<ApplicationList>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

describe('ApplicationList', () => {
  let backend: HttpTestingController;
  /** What the next confirmation dialog will answer. */
  let confirmAnswer: boolean;

  beforeEach(() => {
    sessionStorage.clear();
    confirmAnswer = true;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        // Stubbed so the test drives the answer rather than the overlay. What matters here is that
        // the destructive call happens if and only if the dialog said yes.
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(confirmAnswer) }) },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function render(permissions: Permission[]): ComponentFixture<ApplicationList> {
    const auth = TestBed.inject(Auth);
    auth.login({ email: 'admin@example.com', password: 'secret' }).subscribe();
    const session: AuthenticationResponse = {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      userId: 3,
      fullName: 'Farhan Ali',
      roles: ['ADMIN'],
      permissions,
    };
    backend.expectOne(LOGIN_URL).flush(session);

    const fixture = TestBed.createComponent(ApplicationList);
    TestBed.tick();
    return fixture;
  }

  async function withCatalogue(fixture: ComponentFixture<ApplicationList>) {
    // The full catalogue, not /active: this screen exists to see and change inactive rows too.
    const request = backend.expectOne((candidate) => candidate.url === APPS_URL);
    request.flush([ACTIVE_APP]);
    await fixture.whenStable();
  }

  it('reads the full catalogue rather than only the active rows', async () => {
    const fixture = render(['APPLICATION_READ', 'APPLICATION_MANAGE']);
    const request = backend.expectOne((candidate) => candidate.url === APPS_URL);

    expect(request.request.url).not.toContain('/active');

    request.flush([ACTIVE_APP]);
    await fixture.whenStable();
  });

  it('hides the actions column from someone who can only read', async () => {
    const fixture = render(['APPLICATION_READ']);
    await withCatalogue(fixture);

    // Every role holds APPLICATION_READ, because raising a ticket needs the catalogue, so this
    // screen is reachable by a requester. It must be a table and nothing more for them.
    expect(bindingsOf(fixture).canManage()).toBe(false);
    expect(bindingsOf(fixture).columns()).not.toContain('actions');
  });

  describe('deactivating', () => {
    it('calls DELETE once the confirmation is accepted', async () => {
      const fixture = render(['APPLICATION_READ', 'APPLICATION_MANAGE']);
      await withCatalogue(fixture);

      confirmAnswer = true;
      bindingsOf(fixture).deactivate(ACTIVE_APP);

      const request = backend.expectOne(`${APPS_URL}/11`);
      expect(request.request.method).toBe('DELETE');

      // DELETE deactivates rather than removing: the row stays so tickets already raised against it
      // keep naming it.
      request.flush(null, { status: 204, statusText: 'No Content' });

      // The refetch is dispatched from the resource's effect, so it does not exist yet at the
      // instant the DELETE resolves - hence the microtask and the tick before expecting it.
      await Promise.resolve();
      TestBed.tick();

      const refetch = backend.expectOne((candidate) => candidate.url === APPS_URL);
      refetch.flush([{ ...ACTIVE_APP, active: false }]);
      await fixture.whenStable();
    });

    it('does nothing at all when the confirmation is declined', async () => {
      const fixture = render(['APPLICATION_READ', 'APPLICATION_MANAGE']);
      await withCatalogue(fixture);

      confirmAnswer = false;
      bindingsOf(fixture).deactivate(ACTIVE_APP);

      // Not even a refetch: declining means nothing happened.
      backend.expectNone(() => true);
      await fixture.whenStable();
    });
  });
});
