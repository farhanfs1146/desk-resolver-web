import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The shell, which is deliberately nothing but an outlet.
 *
 * <p>No toolbar or navigation here yet, on purpose: the login screen is full-page and must not render
 * chrome around itself, and the chrome signed-in screens need is driven by permissions. Both belong
 * in a layout component wrapping the authenticated routes, which arrives with the first of those
 * screens rather than ahead of it.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
