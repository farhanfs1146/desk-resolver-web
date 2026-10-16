import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { ProblemDetail } from '../../../core/api/models';
import { Auth } from '../../../core/auth/auth';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly form = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);

  protected togglePasswordVisible(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        // Honour where the user was trying to go before the guard intercepted them, so a shared link
        // to a ticket still lands on that ticket after signing in.
        const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');
        void this.router.navigateByUrl(returnUrl ?? '/');
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(describeLoginFailure(error));
      },
    });
  }
}

/**
 * Turns a failure into something worth showing a person.
 *
 * <p>The API's own `detail` is preferred wherever it exists, because it is written to be read and is
 * deliberately uniform: every authentication failure - wrong password, unknown address, deactivated
 * account - answers with the same sentence, so the form cannot be used to discover which addresses
 * have accounts. Overwriting that with a guess made here would undo it.
 */
function describeLoginFailure(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Something went wrong. Please try again.';
  }

  // Status 0 is not a response: the request never completed. Either the API is not running or the
  // browser blocked it - in development, most often this origin missing from APP_CORS_ORIGINS.
  if (error.status === 0) {
    return 'Cannot reach the server. Check that the API is running.';
  }

  const problem = error.error as ProblemDetail | null;
  if (problem?.detail) {
    return problem.detail;
  }

  if (error.status === 429) {
    // The server sends Retry-After, but it is not a CORS-safelisted response header and is absent
    // from the backend's exposedHeaders list, so cross-origin it cannot be read. Hence no countdown.
    return 'Too many failed attempts. Please wait a while and try again.';
  }

  return 'Sign-in failed. Please try again.';
}
