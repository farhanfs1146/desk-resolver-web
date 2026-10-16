import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';

import { environment } from '../../../../environments/environment';
import {
  ApplicationResponse,
  AuthenticationResponse,
  CreateTicketRequest,
  Permission,
} from '../../../core/api/models';
import { Auth } from '../../../core/auth/auth';
import { authInterceptor } from '../../../core/auth/auth-interceptor';
import { TicketCreate } from './ticket-create';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const ACTIVE_URL = `${environment.apiBaseUrl}/applications/active`;
const TICKETS_URL = `${environment.apiBaseUrl}/tickets`;

/** Two rows sharing an application name, which is exactly what the API allows. */
const CATALOGUE: ApplicationResponse[] = [
  { id: 11, appName: 'HRMS', moduleName: 'Attendance', active: true },
  { id: 12, appName: 'HRMS', moduleName: 'Payroll', active: true },
];

interface Bindings {
  form: FormGroup;
  canChooseApplication: () => boolean;
  chosenModule: () => string | null;
  expectedByInPast: () => boolean;
  errorMessage: () => string | null;
  submit: () => void;
  serverError: (field: string) => string | null;
  onExpectedByChange: (value: string) => void;
}

function bindingsOf(fixture: ComponentFixture<TicketCreate>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

describe('TicketCreate', () => {
  let backend: HttpTestingController;
  let navigated: string[];

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

    // Navigation is recorded rather than performed. The route table here is empty - these tests are
    // about what the form sends and where it points - and letting the real router run would both
    // raise NG04002 as an unhandled rejection, which Vitest warns can produce false positives, and
    // pull the detail screen and its three panels into every test that submits successfully.
    navigated = [];
    const router = TestBed.inject(Router);
    router.navigateByUrl = ((url: string) => {
      navigated.push(url);
      return Promise.resolve(true);
    }) as Router['navigateByUrl'];
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function render(
    permissions: Permission[] = ['TICKET_CREATE', 'APPLICATION_READ'],
  ): ComponentFixture<TicketCreate> {
    const auth = TestBed.inject(Auth);
    auth.login({ email: 'zain@example.com', password: 'secret' }).subscribe();
    const session: AuthenticationResponse = {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      userId: 4,
      fullName: 'Zain',
      roles: ['EMPLOYEE'],
      permissions,
    };
    backend.expectOne(LOGIN_URL).flush(session);

    const fixture = TestBed.createComponent(TicketCreate);
    TestBed.tick();
    return fixture;
  }

  async function withCatalogue(fixture: ComponentFixture<TicketCreate>) {
    backend.expectOne((request) => request.url === ACTIVE_URL).flush(CATALOGUE);
    await fixture.whenStable();
  }

  /** Fills everything the API requires, choosing the Payroll row. */
  function fillValid(fixture: ComponentFixture<TicketCreate>) {
    bindingsOf(fixture).form.patchValue({
      applicationId: 12,
      title: 'Payslip totals are wrong',
      description: 'Net pay is higher than gross for the night shift.',
      issueType: 'BUG',
      priority: 'HIGH',
    });
  }

  it('asks only for active applications', async () => {
    const fixture = render();
    const request = backend.expectOne((candidate) => candidate.url === ACTIVE_URL);

    // The full catalogue includes deactivated rows, and createTicket refuses those outright - so
    // offering them would be offering a guaranteed 400.
    expect(request.request.params.get('size')).toBe('100');

    request.flush(CATALOGUE);
    await fixture.whenStable();
  });

  it('asks for nothing, and says so, without APPLICATION_READ', async () => {
    const fixture = render(['TICKET_CREATE']);

    expect(bindingsOf(fixture).canChooseApplication()).toBe(false);
    backend.expectNone(() => true);
    await fixture.whenStable();
  });

  describe('the module name', () => {
    it('is taken from the chosen application, never typed', async () => {
      const fixture = render();
      await withCatalogue(fixture);
      fillValid(fixture);

      bindingsOf(fixture).submit();
      const request = backend.expectOne(TICKETS_URL);
      const body = request.request.body as CreateTicketRequest;

      // The API demands moduleName alongside applicationId and then rejects anything that is not
      // that application's own module, case-insensitively. It is a confirmation field, not a
      // choice - so there is no module input on this form, and this is why.
      expect(body.applicationId).toBe(12);
      expect(body.moduleName).toBe('Payroll');

      request.flush({ id: 99 });
      await fixture.whenStable();
    });

    it('follows the chosen row even when two share an application name', async () => {
      const fixture = render();
      await withCatalogue(fixture);
      fillValid(fixture);

      bindingsOf(fixture).form.patchValue({ applicationId: 11 });
      expect(bindingsOf(fixture).chosenModule()).toBe('Attendance');

      bindingsOf(fixture).submit();
      const request = backend.expectOne(TICKETS_URL);
      expect((request.request.body as CreateTicketRequest).moduleName).toBe('Attendance');

      request.flush({ id: 99 });
      await fixture.whenStable();
    });
  });

  describe('the deadline', () => {
    it('converts a zone-less local datetime into the instant it means', async () => {
      const fixture = render();
      await withCatalogue(fixture);
      fillValid(fixture);

      // What a `datetime-local` input yields: no offset at all.
      const local = '2026-10-20T17:00';
      bindingsOf(fixture).form.patchValue({ expectedBy: local });

      bindingsOf(fixture).submit();
      const request = backend.expectOne(TICKETS_URL);
      const sent = (request.request.body as CreateTicketRequest).expectedBy;

      // A bare "2026-10-20T17:00:00" is a 400 from this API, deliberately: it refuses to guess a
      // zone. The browser is the one party that knows which 17:00 the person meant, so the test
      // asserts the instant rather than a literal string - the expected text depends on the
      // machine's zone, but the moment does not.
      expect(sent).toMatch(/Z$/);
      expect(new Date(sent!).getTime()).toBe(new Date(local).getTime());

      request.flush({ id: 99 });
      await fixture.whenStable();
    });

    it('omits the field entirely when it is left blank', async () => {
      const fixture = render();
      await withCatalogue(fixture);
      fillValid(fixture);

      bindingsOf(fixture).submit();
      const request = backend.expectOne(TICKETS_URL);
      const body = request.request.body as CreateTicketRequest;

      // `expectedBy: ""` would be a 400 on an Instant, and a blank businessImpact would be stored
      // as an empty string. Absent means "not given".
      expect(body.expectedBy).toBeUndefined();
      expect(body.businessImpact).toBeUndefined();

      request.flush({ id: 99 });
      await fixture.whenStable();
    });

    it('warns about a past date without blocking it', async () => {
      const fixture = render();
      await withCatalogue(fixture);

      bindingsOf(fixture).form.patchValue({ expectedBy: '2020-01-01T09:00' });
      bindingsOf(fixture).onExpectedByChange('2020-01-01T09:00');

      // A hint, not an error: the API accepts it, and "this was needed yesterday" is a real thing
      // somebody raises a ticket to say.
      expect(bindingsOf(fixture).expectedByInPast()).toBe(true);
      expect(bindingsOf(fixture).form.controls['expectedBy'].valid).toBe(true);
    });
  });

  describe('when the server refuses', () => {
    it('puts field messages back on the fields that caused them', async () => {
      const fixture = render();
      await withCatalogue(fixture);
      fillValid(fixture);

      bindingsOf(fixture).submit();
      backend.expectOne(TICKETS_URL).flush(
        {
          title: 'Invalid request',
          status: 400,
          errors: { title: 'Title must be at most 100 characters' },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await fixture.whenStable();

      // One banner holding every message makes the reader hunt for the offending input.
      expect(bindingsOf(fixture).serverError('title')).toContain('at most 100 characters');
      expect(bindingsOf(fixture).errorMessage()).toBe('Some details need fixing.');
    });

    it('shows the explanation for an inactive application, which is not a field error', async () => {
      const fixture = render();
      await withCatalogue(fixture);
      fillValid(fixture);

      bindingsOf(fixture).submit();
      backend.expectOne(TICKETS_URL).flush(
        {
          title: 'Invalid reference',
          status: 400,
          detail: 'applicationId refers to an application that is no longer active: 12',
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await fixture.whenStable();

      expect(bindingsOf(fixture).errorMessage()).toContain('no longer active');
    });
  });

  it('goes to the new ticket once it exists', async () => {
    const fixture = render();
    await withCatalogue(fixture);
    fillValid(fixture);

    bindingsOf(fixture).submit();
    backend.expectOne(TICKETS_URL).flush({ id: 99, ticketNumber: 'TKT-00000099' });
    await fixture.whenStable();

    // Somebody who just raised a ticket wants to see it - and landing on it is also what proves to
    // them that it exists.
    expect(navigated).toEqual(['/tickets/99']);
  });

  it('falls back to the list if the response carries no id', async () => {
    const fixture = render();
    await withCatalogue(fixture);
    fillValid(fixture);

    bindingsOf(fixture).submit();
    backend.expectOne(TICKETS_URL).flush({ ticketNumber: 'TKT-00000099' });
    await fixture.whenStable();

    // Every field on these response records is nullable, so navigating to `/tickets/undefined`
    // is the failure this guards against.
    expect(navigated).toEqual(['/tickets']);
  });
});
