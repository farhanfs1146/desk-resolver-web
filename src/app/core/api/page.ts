import { HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';

/**
 * Paging for an API that does not wrap collections.
 *
 * <p>Every list endpoint returns a **plain JSON array** and puts the page metadata in response
 * headers - `X-Total-Count`, `X-Total-Pages`, `X-Page-Number`, `X-Page-Size`, `X-Has-Next`. So a
 * caller cannot use `HttpClient.get<T[]>()` and read the count; it has to ask for the whole response
 * with `{ observe: 'response' }` and pull the headers off it. That is what {@link toPage} is for.
 *
 * <p>These headers are readable cross-origin only because `SecurityConfig.corsConfigurationSource()`
 * lists them in `exposedHeaders`. If they ever come back as `null` in the browser but are visible in
 * curl, that list is where to look - the browser is hiding them, not the server omitting them.
 */
export interface Page<T> {
  items: T[];
  totalCount: number;
  totalPages: number;
  /** Zero-based, as Spring Data counts. */
  pageNumber: number;
  pageSize: number;
  hasNext: boolean;
}

/** Reads one numeric header, falling back when it is absent or unparseable rather than yielding NaN. */
function num(headers: HttpHeaders, name: string, fallback: number): number {
  const raw = headers.get(name);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Builds a {@link Page} from the headers and the items, however they were obtained.
 *
 * <p>Headers are optional because `httpResource().headers()` is `undefined` until the first response
 * lands, and a table has to render during that gap. Defaults are chosen so a missing header degrades
 * into something still renderable - an empty page rather than one claiming `NaN` rows. A missing
 * header is a misconfiguration, and the place it surfaces is the UI, so it should look empty rather
 * than broken.
 */
export function pageFromHeaders<T>(headers: HttpHeaders | undefined, items: T[]): Page<T> {
  if (!headers) {
    return {
      items,
      totalCount: items.length,
      totalPages: items.length === 0 ? 0 : 1,
      pageNumber: 0,
      pageSize: items.length,
      hasNext: false,
    };
  }
  return {
    items,
    totalCount: num(headers, 'X-Total-Count', items.length),
    totalPages: num(headers, 'X-Total-Pages', items.length === 0 ? 0 : 1),
    pageNumber: num(headers, 'X-Page-Number', 0),
    pageSize: num(headers, 'X-Page-Size', items.length),
    hasNext: headers.get('X-Has-Next') === 'true',
  };
}

/** The same, for the observable path: `http.get(..., { observe: 'response' })`. */
export function toPage<T>(response: HttpResponse<T[]>): Page<T> {
  return pageFromHeaders(response.headers, response.body ?? []);
}

/** What every list endpoint accepts alongside its own filters. `sort` is Spring's `field,direction`. */
export interface PageQuery {
  page?: number;
  size?: number;
  sort?: string;
}

/**
 * Builds query parameters, dropping anything undefined, null or empty.
 *
 * <p>Dropping matters: `HttpParams` would otherwise send `status=` for a cleared filter, and the
 * backend binds that to an empty string rather than to "no filter", which is a 400 on an enum.
 */
export function toParams(
  query: Record<string, string | number | boolean | undefined | null>,
): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params = params.set(key, String(value));
  }
  return params;
}
