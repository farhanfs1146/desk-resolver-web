import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApplicationResponse, CreateApplicationRequest } from './models';
import { PageQuery, toParams } from './page';

const APPLICATIONS = `${environment.apiBaseUrl}/applications`;

/**
 * The application/module catalogue. Reading needs `APPLICATION_READ`, which every role that can
 * raise a ticket holds - it exists so that a requester can say what the ticket is about.
 *
 * <p><strong>A row is an application *and* a module</strong>, not an application with modules under
 * it: `applications` has `app_name` and `module_name` side by side, and neither is unique on its
 * own. So "HRMS / Attendance" and "HRMS / Payroll" are two rows, and the pair is what identifies one.
 */
@Injectable({ providedIn: 'root' })
export class Applications {
  private readonly http = inject(HttpClient);

  /**
   * Only the active ones, which is what a ticket may be raised against.
   *
   * <p>`createTicket` refuses an inactive application outright, so offering the full catalogue in a
   * picker would be offering choices that answer 400. The full list exists for administration.
   *
   * <p>An `undefined` query suppresses the request entirely, for a caller without
   * `APPLICATION_READ`. Firing it anyway to display the 403 would be worse than not asking: the
   * screen already says what is wrong, and the only other product is a logged authorisation failure
   * for something nobody attempted.
   */
  listActive(query: Signal<PageQuery | undefined>) {
    return httpResource<ApplicationResponse[]>(() => {
      const value = query();
      return value === undefined
        ? undefined
        : { url: `${APPLICATIONS}/active`, params: toParams({ ...value }) };
    });
  }

  list(query: Signal<PageQuery>) {
    return httpResource<ApplicationResponse[]>(() => ({
      url: APPLICATIONS,
      params: toParams({ ...query() }),
    }));
  }

  byId(id: Signal<number | undefined>) {
    return httpResource<ApplicationResponse>(() => {
      const value = id();
      return value === undefined ? undefined : `${APPLICATIONS}/${value}`;
    });
  }

  create(request: CreateApplicationRequest): Observable<ApplicationResponse> {
    return this.http.post<ApplicationResponse>(APPLICATIONS, request);
  }

  update(id: number, request: CreateApplicationRequest): Observable<ApplicationResponse> {
    return this.http.put<ApplicationResponse>(`${APPLICATIONS}/${id}`, request);
  }

  /** Deactivates rather than deletes, despite the verb - the API keeps the row for ticket history. */
  deactivate(id: number): Observable<void> {
    return this.http.delete<void>(`${APPLICATIONS}/${id}`);
  }
}
