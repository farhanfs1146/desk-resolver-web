import { httpResource } from '@angular/common/http';
import { Injectable, Signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { RoleResponse } from './models';

const ROLES = `${environment.apiBaseUrl}/roles`;

/**
 * The role catalogue, with the permissions each role carries.
 *
 * <p><strong>It needs `USER_MANAGE`, not `USER_READ`</strong> - which is easy to get wrong, since it
 * looks like reference data. The backend's reasoning is that the list exists so whoever *assigns*
 * roles can see what they are choosing from, so it is gated with the assigning. Support staff who
 * can read the user directory still cannot read this.
 *
 * <p>Read-only: roles are seeded by migration and there is no endpoint to create or change one. The
 * seven that exist are the seven there are.
 */
@Injectable({ providedIn: 'root' })
export class Roles {
  /** An `undefined` query suppresses the request, for a caller without `USER_MANAGE`. */
  list(enabled: Signal<boolean>) {
    return httpResource<RoleResponse[]>(() => (enabled() ? ROLES : undefined));
  }
}
