import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { MarkAllReadResponse, NotificationResponse, UnreadCountResponse } from './models';
import { PageQuery, toParams } from './page';

/** What the inbox list accepts. `unreadOnly` is a filter; "unread first" is deliberately not a sort. */
export interface NotificationQuery extends PageQuery {
  unreadOnly?: boolean;
}

const NOTIFICATIONS = `${environment.apiBaseUrl}/notifications`;

/**
 * `GET|PATCH|POST /api/notifications` - the caller's own inbox.
 *
 * <p><strong>No endpoint here takes a user id, and that is the authorization model.</strong> The
 * recipient comes from the token on the server and appears in the `where` clause of every query, so
 * there is no request this client could make for somebody else's notifications. It is also why these
 * are the only endpoints in the API that assert no permission: the only thing a
 * `NOTIFICATION_READ` permission could grant is reading other people's inboxes.
 *
 * <p>The list is an `httpResource` for the same reason the ticket list is - header paging, loading
 * state and `reload()` for free. The count is a separate resource rather than read off the list's
 * `X-Total-Count`, because they are different numbers: the list reports how many notifications there
 * are, the badge wants how many are unread, and the server answers the second from a partial index
 * over unread rows alone.
 *
 * <p>The writes are plain observables: marking something read is a thing a person does once, not
 * state a screen watches.
 */
@Injectable({ providedIn: 'root' })
export class Notifications {
  private readonly http = inject(HttpClient);

  /**
   * A live inbox that refetches whenever the query changes.
   *
   * <p>A query of `undefined` makes no request, which is how the bell stays silent before there is a
   * session - otherwise it would fire a 401 on the login screen and the interceptor would spend a
   * refresh token answering it.
   */
  list(query: Signal<NotificationQuery | undefined>) {
    return httpResource<NotificationResponse[]>(() => {
      const value = query();
      return value === undefined
        ? undefined
        : { url: NOTIFICATIONS, params: toParams({ ...value }) };
    });
  }

  /** The badge. `enabled` is a signal for the same reason the list's query is optional. */
  unreadCount(enabled: Signal<boolean>) {
    return httpResource<UnreadCountResponse>(() =>
      enabled() ? `${NOTIFICATIONS}/unread-count` : undefined,
    );
  }

  /** Idempotent server side: a second call on the same notification succeeds and changes nothing. */
  markRead(notificationId: number): Observable<void> {
    return this.http.patch<void>(`${NOTIFICATIONS}/${notificationId}/read`, {});
  }

  markAllRead(): Observable<MarkAllReadResponse> {
    return this.http.post<MarkAllReadResponse>(`${NOTIFICATIONS}/read-all`, {});
  }
}
