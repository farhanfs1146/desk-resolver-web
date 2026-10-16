import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { ProblemDetail } from '../../../core/api/models';
import { Users } from '../../../core/api/users';

/** The API's own rule: between 12 and 200 characters. */
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

/** Catches the typo that would otherwise lock somebody out of their own account. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const next = group.get('newPassword')?.value;
  const again = group.get('confirmPassword')?.value;
  return next && again && next !== again ? { mismatch: true } : null;
}

@Component({
  selector: 'app-password-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    ReactiveFormsModule,
  ],
  templateUrl: './password-dialog.html',
  styles: `
    .password-form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 22rem;
      padding-top: 0.5rem;
    }

    .password-hint {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .password-error {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      min-height: 1.25rem;
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);

      mat-icon {
        flex: 0 0 auto;
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
      }
    }

    .password-progress {
      height: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordDialog {
  private readonly dialog = inject(MatDialogRef<PasswordDialog, boolean>);
  private readonly users = inject(Users);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly passwordMax = PASSWORD_MAX;

  protected readonly form = this.formBuilder.group(
    {
      currentPassword: ['', [Validators.required, Validators.maxLength(PASSWORD_MAX)]],
      newPassword: [
        '',
        [
          Validators.required,
          Validators.minLength(PASSWORD_MIN),
          Validators.maxLength(PASSWORD_MAX),
        ],
      ],
      // Not sent anywhere. It exists so a mistyped new password is caught here rather than on the
      // next sign-in, when the only person who could fix it is the one locked out.
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword } = this.form.getRawValue();

    this.saving.set(true);
    this.errorMessage.set(null);

    this.users.changeOwnPassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialog.close(true);
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

  // Bean-validation messages are the server's own words about a field, and they are accurate.
  const fieldMessage = problem?.errors?.['newPassword'] ?? problem?.errors?.['currentPassword'];
  if (fieldMessage) {
    return fieldMessage;
  }

  // A 401 here is **not** shown verbatim. The server answers a wrong current password with
  // "Invalid email or password." - a uniform sentence written for the login endpoint, where saying
  // more would turn it into an account-enumeration oracle. Here there is no email in the request
  // and no account to enumerate: the caller is already authenticated, the interceptor has already
  // renewed and replayed anything that failed on an expired token, so the only remaining cause is
  // the password in this form. Passing the login wording through would send somebody looking for an
  // email field that is not on screen.
  if (error.status === 401) {
    return 'That current password is not correct.';
  }

  return problem?.detail ?? 'Your password could not be changed.';
}
