/**
 * Development configuration.
 *
 * Absolute, because `ng serve` runs on :4200 and the API on :9211 - two origins. This works without
 * a dev proxy because the backend already allows this exact origin: `APP_CORS_ORIGINS` defaults to
 * `http://localhost:4200` in its application.yaml, and `SecurityConfig` exposes the pagination and
 * `Content-Disposition` headers a browser client needs to read.
 *
 * Change the port here only together with `APP_CORS_ORIGINS` on the backend.
 */
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:9211/api',
};
