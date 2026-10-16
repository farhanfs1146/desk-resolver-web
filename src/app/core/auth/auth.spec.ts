import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthenticationResponse } from '../api/models';
import { authInterceptor } from './auth-interceptor';
import { Auth } from './auth';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const REFRESH_URL = `${environment.apiBaseUrl}/auth/refresh`;
const LOGOUT_URL = `${environment.apiBaseUrl}/auth/logout`;
const TICKETS_URL = `${environment.apiBaseUrl}/tickets`;

function pair(suffix: string): AuthenticationResponse {
  return {
    accessToken: `access-${suffix}`,
    tokenType: 'Bearer',
    expiresIn: 1800,
    refreshToken: `refresh-${suffix}`,
    refreshExpiresIn: 28800,
    userId: 7,
    fullName: 'Farhan',
    roles: ['IT_SUPPORT'],
    permissions: ['TICKET_READ_ALL', 'TICKET_ASSIGN'],
  };
}

describe('Auth', () => {
  let auth: Auth;
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    sessionStorage.clear();
  });

  /** Signs in and settles the request, leaving a live session. */
  function signIn(suffix = 'one'): void {
    auth.login({ email: 'farhan@example.com', password: 'secret' }).subscribe();
    backend.expectOne(LOGIN_URL).flush(pair(suffix));
  }

  describe('login', () => {
    it('adopts the identity and keeps the access token out of storage', () => {
      signIn();

      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.accessToken()).toBe('access-one');
      expect(auth.identity()?.fullName).toBe('Farhan');
      expect(auth.has('TICKET_ASSIGN')).toBe(true);
      expect(auth.has('USER_MANAGE')).toBe(false);

      // The whole storage decision in one assertion: the refresh token survives a reload, the
      // access token does not exist anywhere but memory.
      expect(sessionStorage.getItem('deskresolver.refreshToken')).toBe('refresh-one');
      expect(JSON.stringify(sessionStorage)).not.toContain('access-one');
    });

    it('sends no Authorization header on the login request itself', () => {
      auth.login({ email: 'farhan@example.com', password: 'secret' }).subscribe();
      const request = backend.expectOne(LOGIN_URL);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush(pair('one'));
    });
  });

  describe('rotation', () => {
    it('replaces the stored refresh token rather than keeping both', () => {
      signIn('one');

      auth.refreshOnce().subscribe();
      const request = backend.expectOne(REFRESH_URL);
      expect(request.request.body).toEqual({ refreshToken: 'refresh-one' });
      request.flush(pair('two'));

      // Keeping the old one and ever retrying it is what the server reads as a copied credential.
      expect(auth.refreshToken()).toBe('refresh-two');
      expect(sessionStorage.getItem('deskresolver.refreshToken')).toBe('refresh-two');
      expect(auth.accessToken()).toBe('access-two');
    });
  });

  describe('single-flight refresh', () => {
    it('issues one request however many callers ask at once', () => {
      signIn();

      const seen: string[] = [];
      auth.refreshOnce().subscribe((token) => seen.push(token));
      auth.refreshOnce().subscribe((token) => seen.push(token));
      auth.refreshOnce().subscribe((token) => seen.push(token));

      // The assertion that matters. A second POST here would present an already-spent token, which
      // the server treats as theft and answers by revoking the entire login.
      backend.expectOne(REFRESH_URL).flush(pair('two'));

      expect(seen).toEqual(['access-two', 'access-two', 'access-two']);
    });

    it('starts a new exchange for a caller that arrives after the last one finished', () => {
      signIn();

      auth.refreshOnce().subscribe();
      backend.expectOne(REFRESH_URL).flush(pair('two'));

      let late: string | undefined;
      auth.refreshOnce().subscribe((token) => (late = token));

      // Deliberately a second request, not a replayed value: by now the stored token is the rotated
      // one, so spending it is a legitimate renewal. Caching the old result would hand back an
      // access token that is already a generation behind.
      const second = backend.expectOne(REFRESH_URL);
      expect(second.request.body).toEqual({ refreshToken: 'refresh-two' });
      second.flush(pair('three'));

      expect(late).toBe('access-three');
    });

    it('starts a fresh attempt after a failed one instead of replaying the failure', () => {
      signIn();

      auth.refreshOnce().subscribe({ error: () => undefined });
      backend
        .expectOne(REFRESH_URL)
        .flush(
          { title: 'Authentication failed', detail: 'Invalid or expired refresh token.' },
          { status: 401, statusText: 'Unauthorized' },
        );

      // A new session, then a new refresh - the stale rejection must not be cached forever.
      signIn('three');
      auth.refreshOnce().subscribe();
      backend.expectOne(REFRESH_URL).flush(pair('four'));
      expect(auth.accessToken()).toBe('access-four');
    });
  });

  describe('the interceptor', () => {
    it('attaches the access token to an ordinary request', () => {
      signIn();

      http.get(TICKETS_URL).subscribe();
      const request = backend.expectOne(TICKETS_URL);
      expect(request.request.headers.get('Authorization')).toBe('Bearer access-one');
      request.flush([]);
    });

    it('renews on a 401 and replays the original request with the new token', () => {
      signIn();

      let body: unknown;
      http.get(TICKETS_URL).subscribe((response) => (body = response));

      backend.expectOne(TICKETS_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      backend.expectOne(REFRESH_URL).flush(pair('two'));

      const replay = backend.expectOne(TICKETS_URL);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer access-two');
      replay.flush([{ id: 1 }]);

      // The caller never saw the 401 - which is the entire point of the access token being short.
      expect(body).toEqual([{ id: 1 }]);
    });

    it('refreshes once for several requests that fail together', () => {
      signIn();

      http.get(`${TICKETS_URL}?page=0`).subscribe();
      http.get(`${TICKETS_URL}?page=1`).subscribe();
      http.get(`${environment.apiBaseUrl}/applications`).subscribe();

      for (const request of backend.match(() => true)) {
        request.flush(null, { status: 401, statusText: 'Unauthorized' });
      }

      // Three failures, one renewal. Three renewals would have ended the session.
      backend.expectOne(REFRESH_URL).flush(pair('two'));

      const replays = backend.match(() => true);
      expect(replays.length).toBe(3);
      for (const replay of replays) {
        expect(replay.request.headers.get('Authorization')).toBe('Bearer access-two');
        replay.flush([]);
      }
    });

    it('replays a straggler that merely carried a stale token, without refreshing again', () => {
      signIn();

      // A slow request sent with access-one, still in flight...
      let body: unknown;
      http.get(TICKETS_URL).subscribe((response) => (body = response));
      const straggler = backend.expectOne(TICKETS_URL);

      // ...while something else renews the session underneath it.
      auth.refreshOnce().subscribe();
      backend.expectOne(REFRESH_URL).flush(pair('two'));

      // Now the straggler comes back 401. It is not evidence the session is over - only that this
      // request carried the previous token.
      straggler.flush(null, { status: 401, statusText: 'Unauthorized' });

      backend.expectNone(REFRESH_URL);
      const replay = backend.expectOne(TICKETS_URL);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer access-two');
      replay.flush([{ id: 2 }]);
      expect(body).toEqual([{ id: 2 }]);
    });

    it('does not try to renew a failed renewal', () => {
      signIn();

      let status: number | undefined;
      http.get(TICKETS_URL).subscribe({
        error: (error: { status?: number }) => (status = error.status),
      });

      backend.expectOne(TICKETS_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      backend.expectOne(REFRESH_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

      // Without the credential-endpoint exclusion this is where an infinite retry loop would start.
      backend.expectNone(REFRESH_URL);
      backend.expectNone(TICKETS_URL);
      expect(status).toBe(401);
      expect(auth.isAuthenticated()).toBe(false);
      expect(sessionStorage.getItem('deskresolver.refreshToken')).toBeNull();
    });

    it('passes a 401 straight through when there is no refresh token to spend', () => {
      http.get(TICKETS_URL).subscribe({ error: () => undefined });
      backend.expectOne(TICKETS_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      backend.expectNone(REFRESH_URL);
    });

    it('leaves a 403 alone', () => {
      signIn();

      let status: number | undefined;
      http.get(TICKETS_URL).subscribe({
        error: (error: { status?: number }) => (status = error.status),
      });
      backend.expectOne(TICKETS_URL).flush(null, { status: 403, statusText: 'Forbidden' });

      // A 403 is a permission the account does not hold. A new token would carry the same claims, so
      // renewing would be a wasted round trip that still ends in 403.
      backend.expectNone(REFRESH_URL);
      expect(status).toBe(403);
      expect(auth.isAuthenticated()).toBe(true);
    });
  });

  describe('restore', () => {
    it('rebuilds the session from a stored refresh token', () => {
      sessionStorage.setItem('deskresolver.refreshToken', 'refresh-stored');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([authInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      const restored = TestBed.inject(Auth);
      const freshBackend = TestBed.inject(HttpTestingController);

      let outcome: boolean | undefined;
      restored.restore().subscribe((value) => (outcome = value));
      freshBackend.expectOne(REFRESH_URL).flush(pair('two'));

      expect(outcome).toBe(true);
      expect(restored.isAuthenticated()).toBe(true);
      expect(restored.identity()?.fullName).toBe('Farhan');
      freshBackend.verify();
    });

    it('resolves false and makes no request when nothing is stored', () => {
      let outcome: boolean | undefined;
      auth.restore().subscribe((value) => (outcome = value));

      expect(outcome).toBe(false);
      backend.expectNone(REFRESH_URL);
    });
  });

  describe('logout', () => {
    it('clears local state even when the server call fails', () => {
      signIn();

      auth.logout().subscribe();
      backend.expectOne(LOGOUT_URL).flush(null, { status: 500, statusText: 'Server Error' });

      // Somebody who pressed "log out" is logged out of this browser whatever the network did.
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.identity()).toBeNull();
      expect(sessionStorage.getItem('deskresolver.refreshToken')).toBeNull();
    });

    it('makes no request when there is no session', () => {
      auth.logout().subscribe();
      backend.expectNone(LOGOUT_URL);
    });
  });
});
