import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

/**
 * Where `permissionGuard` sends somebody who is signed in but not entitled to a screen.
 *
 * <p>Deliberately not the login screen: re-authenticating cannot grant a permission, so sending them
 * there would read as "your session expired" and have them typing their password to no effect. The
 * fix is an administrator granting a role, which is what the text says.
 */
@Component({
  selector: 'app-forbidden',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <section class="forbidden">
      <span class="forbidden-mark" aria-hidden="true">
        <mat-icon class="icon-filled">lock</mat-icon>
      </span>
      <h1>You do not have access to this page</h1>
      <p>
        Your account is signed in, but it does not hold the permission this page needs. Ask an
        administrator to grant you the role that covers it.
      </p>
      <div class="forbidden-actions">
        <a matButton="filled" routerLink="/">Back to start</a>
        <a matButton routerLink="/account">See my access</a>
      </div>
    </section>
  `,
  styles: `
    .forbidden {
      max-width: 30rem;
      margin: 0 auto;
      padding: 5rem 1.5rem;
      text-align: center;
    }

    /* The same tinted square the page headers use, so this reads as a screen of the application
       rather than as a browser error page. */
    .forbidden-mark {
      display: inline-grid;
      place-items: center;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: var(--app-radius-md);
      background-color: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
      color: var(--mat-sys-error);
    }

    .forbidden-mark .mat-icon {
      font-size: 1.75rem;
      width: 1.75rem;
      height: 1.75rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      font-weight: 650;
      letter-spacing: -0.015em;
      margin: 1.25rem 0 0.625rem;
    }

    p {
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.6;
      margin: 0 0 1.75rem;
    }

    .forbidden-actions {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Forbidden {}
