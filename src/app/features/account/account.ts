import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { PasswordDialog } from './password-dialog/password-dialog';

/**
 * What this account is, what it may do, and the one thing it can change about itself.
 *
 * <p>The permission list is worth a screen rather than a debug panel: in a tool where capability
 * varies by role, "why can I not see the assign button" is a real support question and the honest
 * answer is this list. It is also where a wrong permission set gets noticed - every other screen is
 * gated on it, so a mistake here would otherwise surface as several unrelated-looking bugs.
 */
@Component({
  selector: 'app-account',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './account.html',
  styleUrl: './account.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Account {
  private readonly auth = inject(Auth);
  private readonly dialogs = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly identity = this.auth.identity;
  protected readonly permissions = this.auth.permissions;

  /**
   * First letter of each of the first two names.
   *
   * <p>Duplicated from the shell rather than shared, and deliberately: two call sites is not yet a
   * utility, and the alternative is a module that exists only to hold five lines. If a third screen
   * needs it, that is when it moves.
   */
  protected readonly initials = computed(() => {
    const name = this.identity()?.fullName?.trim();
    if (!name) {
      return '?';
    }
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  /**
   * Changes the password, then signs out - because the server already has.
   *
   * <p>`changeOwnPassword` revokes every session for the account, this one included, so the tokens
   * held here are dead the moment it succeeds. Clearing them and going to the login screen on
   * purpose is the difference between "that worked, sign in again" and the user's next click
   * failing for no visible reason.
   */
  protected changePassword(): void {
    this.dialogs
      .open(PasswordDialog)
      .afterClosed()
      .subscribe((changed: boolean | undefined) => {
        if (changed) {
          this.auth.clear();
          void this.router.navigateByUrl('/login');
          this.snackBar.open('Password changed. Sign in with the new one.', undefined, {
            duration: 6000,
          });
        }
      });
  }
}
