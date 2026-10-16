import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Role, UserResponse } from '../../../core/api/models';
import { PageQuery, pageFromHeaders } from '../../../core/api/page';
import { Users } from '../../../core/api/users';
import { Auth } from '../../../core/auth/auth';
import { RolesDialog, RolesDialogData } from '../roles-dialog/roles-dialog';
import { UserDialog } from '../user-dialog/user-dialog';

/** Only what `UserPageRequests.SORTABLE` accepts. `roles` is not among them - it is a join. */
const SORTABLE = new Set(['fullName', 'email', 'employeeCode', 'active', 'id']);

@Component({
  selector: 'app-user-list',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserList {
  private readonly users = inject(Users);
  private readonly auth = inject(Auth);
  private readonly dialogs = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** `USER_MANAGE`, held by `ADMIN` alone. Reading the directory needs only `USER_READ`. */
  protected readonly canManage = computed(() => this.auth.has('USER_MANAGE'));

  protected readonly ownId = computed(() => this.auth.identity()?.userId);

  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(25);
  protected readonly sort = signal<Sort>({ active: 'fullName', direction: 'asc' });

  private readonly query = computed<PageQuery>(() => {
    const { active, direction } = this.sort();
    return {
      page: this.pageIndex(),
      size: this.pageSize(),
      sort: direction && SORTABLE.has(active) ? `${active},${direction}` : undefined,
    };
  });

  private readonly resource = this.users.list(this.query);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  protected readonly page = computed(() =>
    pageFromHeaders(this.resource.headers(), this.resource.value() ?? []),
  );

  protected readonly columns = computed(() => {
    const shown = ['fullName', 'email', 'employeeCode', 'roles', 'active'];
    return this.canManage() ? [...shown, 'actions'] : shown;
  });

  protected onSortChange(sort: Sort): void {
    this.sort.set(sort);
    this.pageIndex.set(0);
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  protected reload(): void {
    this.resource.reload();
  }

  protected addUser(): void {
    this.dialogs
      .open(UserDialog, { width: '34rem' })
      .afterClosed()
      .subscribe((created: UserResponse | undefined) => {
        if (created) {
          this.resource.reload();
          this.snackBar.open(`${created.fullName ?? 'The account'} was created.`, undefined, {
            duration: 4000,
          });
        }
      });
  }

  protected changeRoles(user: UserResponse): void {
    if (user.id === undefined) {
      return;
    }

    const data: RolesDialogData = {
      userId: user.id,
      fullName: user.fullName ?? '',
      current: user.roles ?? [],
      isSelf: user.id === this.ownId(),
    };

    this.dialogs
      .open(RolesDialog, { data, width: '34rem' })
      .afterClosed()
      .subscribe((updated: UserResponse | undefined) => {
        if (updated) {
          this.resource.reload();
          this.snackBar.open('Roles updated.', undefined, { duration: 4000 });
        }
      });
  }

  protected rolesOf(user: UserResponse): Role[] {
    return user.roles ?? [];
  }
}
