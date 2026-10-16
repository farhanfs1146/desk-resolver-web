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

import { Applications } from '../../../core/api/applications';
import { ApplicationResponse } from '../../../core/api/models';
import { PageQuery, pageFromHeaders } from '../../../core/api/page';
import { Auth } from '../../../core/auth/auth';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog/confirm-dialog';
import { ApplicationDialog, ApplicationDialogData } from '../application-dialog/application-dialog';

/** Only what `ApplicationPageRequests.SORTABLE` accepts. */
const SORTABLE = new Set(['appName', 'moduleName', 'active', 'id']);

@Component({
  selector: 'app-application-list',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './application-list.html',
  styleUrl: './application-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationList {
  private readonly applications = inject(Applications);
  private readonly auth = inject(Auth);
  private readonly dialogs = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** `APPLICATION_MANAGE`, held by `ADMIN` alone. Reading the catalogue needs only the READ half. */
  protected readonly canManage = computed(() => this.auth.has('APPLICATION_MANAGE'));

  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(25);
  protected readonly sort = signal<Sort>({ active: 'appName', direction: 'asc' });

  private readonly query = computed<PageQuery>(() => {
    const { active, direction } = this.sort();
    return {
      page: this.pageIndex(),
      size: this.pageSize(),
      sort: direction && SORTABLE.has(active) ? `${active},${direction}` : undefined,
    };
  });

  // The full catalogue, not /active: this screen exists to see and change what is inactive too.
  private readonly resource = this.applications.list(this.query);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  protected readonly page = computed(() =>
    pageFromHeaders(this.resource.headers(), this.resource.value() ?? []),
  );

  protected readonly columns = computed(() => {
    const shown = ['appName', 'moduleName', 'active'];
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

  protected add(): void {
    this.open({ mode: 'create' });
  }

  protected edit(application: ApplicationResponse): void {
    if (application.id === undefined) {
      return;
    }
    this.open({ mode: 'edit', application });
  }

  private open(data: ApplicationDialogData): void {
    this.dialogs
      .open(ApplicationDialog, { data, width: '30rem' })
      .afterClosed()
      .subscribe((saved: ApplicationResponse | undefined) => {
        if (saved) {
          this.resource.reload();
          this.snackBar.open(
            data.mode === 'create' ? 'Application added.' : 'Application updated.',
            undefined,
            { duration: 4000 },
          );
        }
      });
  }

  /**
   * Deactivates, which is what `DELETE` does here - the row stays, so ticket history keeps naming it.
   *
   * <p>Confirmed first because the consequence is not local to this screen: no new ticket can be
   * raised against an inactive application, and `createTicket` refuses one outright. That is a
   * change to what everybody else can do, from a screen only an administrator sees.
   */
  protected deactivate(application: ApplicationResponse): void {
    const id = application.id;
    if (id === undefined) {
      return;
    }

    const data: ConfirmDialogData = {
      title: `Deactivate ${application.appName}?`,
      message:
        `No new tickets can be raised against ${application.appName} — ${application.moduleName} ` +
        'while it is inactive. Existing tickets keep it and are unaffected. You can reactivate it ' +
        'from this screen.',
      confirmLabel: 'Deactivate',
      destructive: true,
    };

    this.dialogs
      .open(ConfirmDialog, { data })
      .afterClosed()
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed) {
          this.applications.deactivate(id).subscribe({
            next: () => {
              this.resource.reload();
              this.snackBar.open(`${application.appName} is now inactive.`, undefined, {
                duration: 4000,
              });
            },
            error: () => {
              this.snackBar.open('That application could not be deactivated.', 'Dismiss', {
                duration: 8000,
              });
            },
          });
        }
      });
  }
}
