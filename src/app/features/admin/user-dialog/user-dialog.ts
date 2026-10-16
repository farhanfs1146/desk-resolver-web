import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';

import { CreateUserRequest, ProblemDetail, Role, UserResponse } from '../../../core/api/models';
import { Roles } from '../../../core/api/roles';
import { Users } from '../../../core/api/users';

/** The API's own limits, mirrored so the form says so before the server has to. */
const NAME_MAX = 150;
const EMAIL_MAX = 100;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

@Component({
  selector: 'app-user-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  templateUrl: './user-dialog.html',
  styles: `
    .user-form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding-top: 0.5rem;
    }

    .user-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.25rem 1rem;
    }

    .user-check {
      margin: 0.25rem 0 0.5rem;
    }

    .user-hint {
      margin: 0 0 0.25rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .user-error {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 1.25rem;
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);

      mat-icon {
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
      }
    }

    .user-progress {
      height: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserDialog {
  private readonly dialog = inject(MatDialogRef<UserDialog, UserResponse>);
  private readonly users = inject(Users);
  private readonly roleCatalogue = inject(Roles);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly nameMax = NAME_MAX;
  protected readonly emailMax = EMAIL_MAX;
  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly passwordMax = PASSWORD_MAX;

  // Reaching this dialog already required USER_MANAGE, which is what GET /api/roles needs too.
  private readonly roles = this.roleCatalogue.list(computed(() => true));

  protected readonly loadingRoles = this.roles.isLoading;
  protected readonly rolesFailed = this.roles.error;
  protected readonly roleOptions = computed(() => this.roles.value() ?? []);

  protected readonly form = this.formBuilder.group({
    fullName: ['', [Validators.required, Validators.maxLength(NAME_MAX)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(EMAIL_MAX)]],
    employeeCode: this.formBuilder.control<number | null>(null, Validators.required),
    password: [
      '',
      [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(PASSWORD_MAX)],
    ],
    // At least one, because the API requires it rather than defaulting to the least-privileged role:
    // an account created by omission is an account nobody decided on.
    roles: this.formBuilder.control<Role[]>([], Validators.required),
    active: [true],
  });

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const request: CreateUserRequest = {
      fullName: value.fullName.trim(),
      email: value.email.trim(),
      employeeCode: value.employeeCode as number,
      password: value.password,
      roles: value.roles,
      active: value.active,
      // departmentId and designationId are deliberately not asked for. They are nullable BIGINT
      // columns with no foreign key and no departments or designations table behind them - V11 says
      // so in as many words - so nothing validates them, nothing resolves them to a name, and
      // nothing in this application reads them. A number box nobody can look a value up for is a
      // data-entry trap, not a feature. If those tables ever arrive, they become pickers.
    };

    this.saving.set(true);
    this.errorMessage.set(null);

    this.users.create(request).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.dialog.close(created);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(this.applyServerErrors(error));
      },
    });
  }

  /** Field messages back onto their controls; see TicketCreate for the same reasoning. */
  private applyServerErrors(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Something went wrong. Please try again.';
    }
    if (error.status === 0) {
      return 'Cannot reach the server.';
    }

    const problem = error.error as ProblemDetail | null;
    let attached = false;

    for (const [field, message] of Object.entries(problem?.errors ?? {})) {
      const control = this.form.get(field);
      if (control) {
        control.setErrors({ ...(control.errors ?? {}), server: message });
        control.markAsTouched();
        attached = true;
      }
    }

    if (attached) {
      return 'Some details need fixing.';
    }
    // A duplicate email or employee code arrives as a 409 with the explanation in `detail`.
    return problem?.detail ?? 'This account could not be created.';
  }

  protected serverError(field: string): string | null {
    return (this.form.get(field)?.errors?.['server'] as string | undefined) ?? null;
  }
}
