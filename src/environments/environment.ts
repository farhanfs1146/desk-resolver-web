/**
 * Production configuration.
 *
 * `apiBaseUrl` is relative, which assumes the built SPA is served from the same origin as the API.
 * That is the intended deployment and it is worth more than convenience: same-origin removes the
 * CORS half of the objection to an HttpOnly refresh cookie, which docs/DECISIONS.md in the backend
 * repository records as the condition for revisiting token storage.
 *
 * If the SPA is ever served from a different origin, set this to the absolute API URL *and* add that
 * origin to `APP_CORS_ORIGINS` on the backend. Changing one without the other produces a CORS
 * failure that reads to a user like a network error.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
};
