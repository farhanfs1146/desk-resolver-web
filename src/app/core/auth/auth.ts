import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  AuthenticationResponse,
  LoginRequest,
  Permission,
  RefreshTokenRequest,
  Role,
} from '../api/models';

/**
 * Where the refresh token is kept.
 *
 * <p>`sessionStorage`, not `localStorage`: scoped to the tab and gone when it closes, so a token that
 * should die with the tab does not outlive the machine being walked away from. The backend's
 * docs/DECISIONS.md records this decision and why an HttpOnly cookie was rejected despite being
 * stronger on paper - it would have made the credential ambient, which is the one property that whole
 * security model is built on not having.
 */
const REFRESH_TOKEN_KEY = 'deskresolver.refreshToken';

/** Who the current session belongs to and what it may do. Rebuilt from login *or* refresh alike. */
export interface Identity {
  userId: number;
  fullName: string;
  roles: Role[];
  permissions: Permission[];
}

/**
 * The session: the tokens, who holds them, and the operations that change that.
 *
 * <p><strong>The access token is never persisted.</strong> It is a signal and nothing else - no
 * storage, no cookie. It does not survive a reload, which is fine, because the refresh token exists
 * to rebuild it. Anything that could read storage could read this variable too, so persisting it
 * would buy nothing and cost the guarantee that closing the tab ends the session.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);

  private readonly accessTokenSignal = signal<string | null>(null);
  private readonly identitySignal = signal<Identity | null>(null);
  private readonly refreshTokenSignal = signal<string | null>(readStoredRefreshToken());

  /** Read by the interceptor on every outgoing request. */
  readonly accessToken = this.accessTokenSignal.asReadonly();
  readonly identity = this.identitySignal.asReadonly();
  readonly refreshToken = this.refreshTokenSignal.asReadonly();

  /** True while a refresh is running, for anything that wants to show it or hold back. */
  readonly refreshing = signal(false);

  /**
   * True once an access token is held.
   *
   * <p>Deliberately not "a refresh token exists": holding one only means a session *might* be
   * recoverable, and the only way to find out is to spend it. {@link restore} does that once at
   * startup, which is what lets guards treat this as the truth afterwards.
   */
  readonly isAuthenticated = computed(() => this.accessTokenSignal() !== null);

  readonly permissions = computed<readonly Permission[]>(
    () => this.identitySignal()?.permissions ?? [],
  );

  /**
   * One refresh in flight at a time, shared by every caller that asks while it runs.
   *
   * <p>This is not an optimisation. The server treats a *second presentation of the same refresh
   * token* as evidence it was copied and revokes the entire login - so several requests meeting a 401
   * together and each firing its own refresh would sign the user out for nothing. Queueing them
   * behind one call is the difference between a working client and one that logs people out whenever
   * they open a page with more than one widget on it.
   */
  private inFlightRefresh: Observable<string> | null = null;

  has(permission: Permission): boolean {
    return this.permissions().includes(permission);
  }

  hasAny(...permissions: Permission[]): boolean {
    return permissions.some((permission) => this.has(permission));
  }

  login(credentials: LoginRequest): Observable<Identity> {
    return this.http
      .post<AuthenticationResponse>(`${environment.apiBaseUrl}/auth/login`, credentials)
      .pipe(
        tap((response) => this.adopt(response)),
        map(() => this.identitySignal()!),
      );
  }

  /**
   * Rebuilds a session from a stored refresh token, once, at application start.
   *
   * <p>Without this a reload looks like a logout: the access token lived in memory and the page just
   * replaced it. Failure is not an error here - an expired, spent or revoked token means "no
   * session", which is the ordinary state of a browser that has not logged in - so this resolves
   * either way and leaves the guards to send the user to the login screen.
   */
  restore(): Observable<boolean> {
    if (!this.refreshTokenSignal()) {
      return of(false);
    }
    return this.refreshOnce().pipe(
      map(() => true),
      catchError(() => {
        this.clear();
        return of(false);
      }),
    );
  }

  /**
   * Exchanges the stored refresh token for a fresh pair, collapsing concurrent callers onto one call.
   *
   * <p>The sharing lasts for the duration of the call and no longer: whichever way it ends, the
   * shared reference is dropped. So this deduplicates callers that overlap, and a caller arriving
   * *after* it finished starts a new exchange - correctly, because by then the token it would spend
   * is the rotated one, which is a legitimate renewal rather than a reuse. Dropping the reference is
   * what stops a failure being replayed to every later caller forever.
   *
   * <p>The straggler case is handled a layer up instead: {@link authInterceptor} compares the token
   * a failed request was sent with against the current one, and a request that merely carried a
   * stale token is replayed rather than refreshed. That is cheaper than caching here, because it
   * spends no refresh token at all.
   */
  refreshOnce(): Observable<string> {
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    const token = this.refreshTokenSignal();
    if (!token) {
      return throwError(
        () => new Error('No refresh token is stored; there is no session to renew.'),
      );
    }

    this.refreshing.set(true);
    const body: RefreshTokenRequest = { refreshToken: token };

    this.inFlightRefresh = this.http
      .post<AuthenticationResponse>(`${environment.apiBaseUrl}/auth/refresh`, body)
      .pipe(
        tap((response) => this.adopt(response)),
        map((response) => response.accessToken ?? ''),
        finalize(() => {
          this.refreshing.set(false);
          this.inFlightRefresh = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.inFlightRefresh;
  }

  /**
   * Ends the session server-side, then locally.
   *
   * <p>The server revokes the whole *family* - this session and every one rotated out of the same
   * original login - so the refresh token cannot mint another access token afterwards. Local state is
   * cleared whatever the request does, because somebody who pressed "log out" is logged out of this
   * browser regardless of whether the network agreed.
   */
  logout(): Observable<void> {
    if (this.accessTokenSignal() === null) {
      this.clear();
      return of(void 0);
    }
    return this.http.post<void>(`${environment.apiBaseUrl}/auth/logout`, {}).pipe(
      map(() => void 0),
      catchError(() => of(void 0)),
      finalize(() => this.clear()),
    );
  }

  /** Drops every trace of the session from this tab. Safe to call when there is none. */
  clear(): void {
    this.accessTokenSignal.set(null);
    this.identitySignal.set(null);
    this.refreshTokenSignal.set(null);
    writeStoredRefreshToken(null);
  }

  /**
   * Takes on the state described by a login or refresh response - one code path for both, because
   * the API returns the same shape for both precisely so that it can be.
   */
  private adopt(response: AuthenticationResponse): void {
    this.accessTokenSignal.set(response.accessToken ?? null);
    this.identitySignal.set({
      userId: response.userId ?? 0,
      fullName: response.fullName ?? '',
      roles: response.roles ?? [],
      permissions: response.permissions ?? [],
    });

    // Rotation: the token just presented is dead server-side now. Replacing rather than keeping both
    // is the whole contract - retrying the old one is exactly what reuse detection punishes.
    const rotated = response.refreshToken ?? null;
    this.refreshTokenSignal.set(rotated);
    writeStoredRefreshToken(rotated);
  }
}

// -------------------------------------------------------------------------------------------------
// Storage
// -------------------------------------------------------------------------------------------------

/**
 * Storage access is wrapped because it *throws* rather than returning null in a private window, with
 * site data blocked, and in some embedded webviews. A browser that refuses to store the refresh token
 * should degrade to "you log in again after a reload", not to a blank page.
 */
function readStoredRefreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredRefreshToken(token: string | null): void {
  try {
    if (token === null) {
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    } else {
      sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    }
  } catch {
    // Non-fatal: the session simply will not survive a reload.
  }
}
