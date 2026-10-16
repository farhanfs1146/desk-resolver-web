import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';

import { Permission, ProblemDetail, Role, UserResponse } from '../../../core/api/models';
import { Roles } from '../../../core/api/roles';
import { Users } from '../../../core/api/users';

export interface RolesDialogData {
  userId: number;
  fullName: string;
  current: Role[];
  isSelf: boolean;
}

@Component({
  selector: 'app-roles-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  templateUrl: './roles-dialog.html',
  styles: `
    .roles-body {
      min-width: 24rem;
    }

    .roles-field {
      width: 100%;
    }

    .roles-note {
      margin: 0 0 0.75rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .roles-warning {
      display: flex;
      gap: 0.5rem;
      margin: 0.5rem 0;
      padding: 0.6rem 0.75rem;
      border-radius: var(--mat-sys-corner-small);
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-small);

      mat-icon {
        flex: 0 0 auto;
        font-size: 1.2rem;
        width: 1.2rem;
        height: 1.2rem;
      }
    }

    .roles-permissions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin: 0.25rem 0 0;
      padding: 0;
      list-style: none;

      li {
        padding: 0.05rem 0.45rem;
        border-radius: 1rem;
        background-color: var(--mat-sys-surface-container-high);
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-small);
      }
    }

    .roles-error {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      min-height: 1.25rem;
      margin: 0.5rem 0 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);

      mat-icon {
        flex: 0 0 auto;
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
      }
    }

    .roles-progress {
      height: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolesDialog {
  protected readonly data = inject<RolesDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<RolesDialog, UserResponse>);
  private readonly users = inject(Users);
  private readonly roleCatalogue = inject(Roles);

  private readonly roles = this.roleCatalogue.list(computed(() => true));

  protected readonly loadingRoles = this.roles.isLoading;
  protected readonly rolesFailed = this.roles.error;
  protected readonly roleOptions = computed(() => this.roles.value() ?? []);

  protected readonly chosen = signal<Role[]>([...this.data.current]);

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * What the chosen roles add up to.
   *
   * <p>Shown because permissions are a **union**: adding a role can only widen what somebody can
   * do, never narrow it, so "MANAGER plus IT_SUPPORT" is not obvious from the role names alone.
   * Deriving it from the catalogue - which carries each role's permissions - means this agrees with
   * the server rather than restating a rule from memory.
   */
  protected readonly resultingPermissions = computed<Permission[]>(() => {
    const selected = new Set(this.chosen());
    const union = new Set<Permission>();
    for (const role of this.roleOptions()) {
      if (role.code && selected.has(role.code)) {
        for (const permission of role.permissions ?? []) {
          union.add(permission);
        }
      }
    }
    return [...union].sort();
  });

  /**
   * Whether this change would take `USER_MANAGE` away from the person making it.
   *
   * <p>The server refuses with a 409 when it would leave no active account able to manage users,
   * and in practice that is an administrator removing their own last administrative role. Warning
   * beforehand is better than a refusal afterwards - and the warning stands even when the refusal
   * will not come, because dropping your own administrative role is worth a second look regardless.
   */
  protected readonly losingOwnAdmin = computed(() => {
    if (!this.data.isSelf) {
      return false;
    }
    const held = this.resultingPermissions();
    const hadIt = this.roleOptions()
      .filter((role) => role.code && this.data.current.includes(role.code))
      .some((role) => (role.permissions ?? []).includes('USER_MANAGE'));
    return hadIt && !held.includes('USER_MANAGE');
  });

  protected readonly unchanged = computed(() => {
    const before = [...this.data.current].sort().join(',');
    const after = [...this.chosen()].sort().join(',');
    return before === after;
  });

  protected submit(): void {
    if (this.chosen().length === 0 || this.saving()) {
      this.errorMessage.set('An account must hold at least one role.');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    // A full replacement, not an addition - which is why the dialog starts from the current set
    // rather than from empty, and why the note in the template says so.
    this.users.replaceRoles(this.data.userId, { roles: this.chosen() }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.dialog.close(updated);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(describe(error));
      },
    });
  }
}

function describe(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Something went wrong. Please try again.';
  }
  if (error.status === 0) {
    return 'Cannot reach the server.';
  }
  const problem = error.error as ProblemDetail | null;
  // A 409 here is the lockout guard, and its message explains what to do instead. The backend
  // deliberately lets it through in full - there is nothing to conceal - so it is shown verbatim.
  return problem?.detail ?? 'These roles could not be saved.';
}
