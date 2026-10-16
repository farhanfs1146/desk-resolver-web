import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { Auth } from './auth';

/**
 * Endpoints that must never have a bearer token attached and must never trigger a refresh.
 *
 * <p>`/auth/refresh` is the important one. A 401 from the refresh call itself means the stored token
 * is spent, revoked or past the absolute window - retrying it is both pointless and actively harmful,
 * because presenting an already-used token is what the server reads as theft and answers by revoking
 * the entire login. Without this list a single expired session turns into an infinite retry loop.
 */
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/refresh'];

function isCredentialEndpoint(url: string): boolean {
  return CREDENTIAL_ENDPOINTS.some((path) => url.includes(path));
}

function withBearer<T>(request: HttpRequest<T>, token: string): HttpRequest<T> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Attaches the access token, and on a 401 renews it once and replays the request.
 *
 * <p><strong>The replay is what makes the 30-minute access token invisible.</strong> The token expires
 * on a clock the user cannot see, so without this the 401 lands mid-task - characteristically on the
 * POST submitting a ticket description somebody spent ten minutes writing. Here the request is simply
 * sent again with a fresh token and the user never learns it happened.
 *
 * <p><strong>Concurrency is handled in {@link Auth.refreshOnce}, not here.</strong> Several requests
 * failing together is the normal case, and each of them lands in this `catchError` independently;
 * they all call `refreshOnce()` and all but the first join the call already running. Firing a refresh
 * per request instead would present the same single-use token repeatedly, which the server treats as
 * a copied credential and punishes by ending the session.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);

  if (isCredentialEndpoint(req.url)) {
    return next(req);
  }

  const sentWith = auth.accessToken();
  const authorised = sentWith ? withBearer(req, sentWith) : req;

  return next(authorised).pipe(
    catchError((error: unknown) => {
      const isUnauthorised = error instanceof HttpErrorResponse && error.status === 401;

      // A 401 with nothing to renew from is just a 401: the caller is not logged in. Let it through
      // so the guard or the component decides, rather than silently clearing state from in here.
      if (!isUnauthorised || !auth.refreshToken()) {
        return throwError(() => error);
      }

      // Somebody else already renewed while this request was in flight, so the token it carried is
      // simply stale - replay it with the current one and spend no refresh token at all. Without
      // this, a slow request that 401s after a completed refresh would rotate the chain a second
      // time for nothing, adding a session row per straggler.
      const current = auth.accessToken();
      if (current && current !== sentWith) {
        return next(withBearer(req, current));
      }

      return auth.refreshOnce().pipe(
        switchMap((fresh) => next(withBearer(req, fresh))),
        catchError((refreshError: unknown) => {
          // The session is genuinely over - spent, revoked, or past the absolute window. Drop local
          // state so guards stop treating the user as signed in, and surface the original failure,
          // which is the one that describes what the caller was trying to do.
          auth.clear();
          return throwError(() =>
            refreshError instanceof HttpErrorResponse ? refreshError : error,
          );
        }),
      );
    }),
  );
};
