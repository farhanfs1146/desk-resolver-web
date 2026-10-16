import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  ChangePasswordRequest,
  CreateUserRequest,
  ReplaceUserRolesRequest,
  UserResponse,
} from './models';
import { PageQuery, toParams } from './page';

const USERS = `${environment.apiBaseUrl}/users`;

/**
 * `/api/users`. The permissions here are **not uniform**, and assuming they were would be wrong in
 * both directions:
 *
 * <ul>
 *   <li>{@link list} needs `USER_READ`, which no requester role holds - only support staff and
 *       administrators can enumerate accounts. This is why the assignee picker is gated on the
 *       permission rather than on whether the list happens to come back empty.</li>
 *   <li>{@link byId} needs only a session. The service then allows it for support staff *or* for a
 *       user's own record, so an `EMPLOYEE` can read themselves and nobody else.</li>
 *   <li>{@link replaceRoles} needs `USER_MANAGE`, held by `ADMIN` alone.</li>
 *   <li>{@link changeOwnPassword} needs only a session, deliberately: changing your own password is
 *       not an administrative act, and gating it would strand the bootstrap administrator.</li>
 * </ul>
 *
 * <p><strong>There is no endpoint to deactivate or edit an existing account.</strong> `active` is
 * set at creation and roles can be replaced afterwards; nothing else about a user can be changed
 * through this API. A screen must not offer a control for it.
 */
@Injectable({ providedIn: 'root' })
export class Users {
  private readonly http = inject(HttpClient);

  list(query: Signal<PageQuery>) {
    return httpResource<UserResponse[]>(() => ({
      url: USERS,
      params: toParams({ ...query() }),
    }));
  }

  byId(id: Signal<number | undefined>) {
    return httpResource<UserResponse>(() => {
      const value = id();
      return value === undefined ? undefined : `${USERS}/${value}`;
    });
  }

  /**
   * Creates an account with an initial password. `USER_MANAGE`.
   *
   * <p>The password is write-only - it is never returned by any endpoint, including this one - so
   * whoever creates the account has to pass it on out of band, and there is no "show it again".
   */
  create(request: CreateUserRequest): Observable<UserResponse> {
    return this.http.post<UserResponse>(USERS, request);
  }

  replaceRoles(id: number, request: ReplaceUserRolesRequest): Observable<UserResponse> {
    return this.http.put<UserResponse>(`${USERS}/${id}/roles`, request);
  }

  changeOwnPassword(request: ChangePasswordRequest): Observable<void> {
    return this.http.patch<void>(`${USERS}/me/password`, request);
  }
}
