import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreateTicketCommentRequest, TicketCommentResponse } from './models';
import { PageQuery, toParams } from './page';

/**
 * A ticket's discussion thread: `GET|POST /api/tickets/{ticketId}/comments`.
 *
 * <p>Visibility is decided by the *ticket*, not by this sub-resource: every comment endpoint runs
 * the backend's ticket visibility guard first. So `TICKET_COMMENT_READ` governs whether a caller may
 * use threads at all, and involvement still governs whose threads they reach - which is why a 403
 * here means "not allowed to read threads" while a 404 means "not your ticket".
 */
@Injectable({ providedIn: 'root' })
export class Comments {
  private readonly http = inject(HttpClient);

  private url(ticketId: number): string {
    return `${environment.apiBaseUrl}/tickets/${ticketId}/comments`;
  }

  list(ticketId: Signal<number | undefined>, query: Signal<PageQuery>) {
    return httpResource<TicketCommentResponse[]>(() => {
      const id = ticketId();
      return id === undefined ? undefined : { url: this.url(id), params: toParams({ ...query() }) };
    });
  }

  add(ticketId: number, request: CreateTicketCommentRequest): Observable<TicketCommentResponse> {
    return this.http.post<TicketCommentResponse>(this.url(ticketId), request);
  }
}
