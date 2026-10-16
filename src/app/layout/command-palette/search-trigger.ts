import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * The search box in the header - which is a button, and takes no typing.
 *
 * <p>**Why it looks like a field.** It is the affordance for {@link CommandPalette}: clicking it
 * opens the palette, and the palette owns the input. A real field here plus a dialog there would be
 * two places to type a search, and they would have to be kept in step with each other for no gain.
 * The shortcut printed on the right is what resolves the ambiguity - and it is most of the reason
 * the control is drawn at all, because a keyboard shortcut that nothing points at is a feature only
 * the person who built it knows about.
 *
 * <p>**Why it is a component rather than markup in the shell.** Two reasons, and the second is the
 * honest one. It belongs to the palette rather than to the shell's layout, so it sits beside the
 * palette in this folder. And `shell.scss` is the largest component stylesheet here: with these
 * rules inside it, it reached 7.69 kB against a budget that **fails** the build at 8 kB. Three
 * hundred bytes of headroom in the frame of the whole application is not somewhere to leave it.
 *
 * <p><strong>Note for editing the two template literals below.</strong> Neither may contain a
 * backtick - not even inside a comment, where it is the natural way to name a class. One ends the
 * literal, and the compiler then reports it as half a dozen unrelated syntax errors in the decorator
 * rather than as an unterminated string.
 */
@Component({
  selector: 'app-search-trigger',
  imports: [MatIconModule],
  template: `
    <button
      class="trigger"
      type="button"
      (click)="activate.emit()"
      aria-label="Search tickets or jump to a screen - Ctrl K"
      aria-keyshortcuts="Control+K"
    >
      <mat-icon class="trigger-icon" aria-hidden="true">search</mat-icon>
      <span class="trigger-text">Search or jump to&hellip;</span>

      <!-- Three elements rather than the text "Ctrl+K", so the separator can be dimmed on its own -
           and so formatting this file can never turn into rendered spaces. Flex ignores the
           whitespace between its children; a text node would not.

           Hidden from assistive technology, because the button's own label and its
           aria-keyshortcuts attribute already say this. A screen reader announcing "Ctrl plus K"
           off the glyphs would be saying it twice, once badly. -->
      <kbd class="trigger-shortcut" aria-hidden="true">
        <span>Ctrl</span>
        <span class="trigger-shortcut-sep">+</span>
        <span>K</span>
      </kbd>
    </button>
  `,
  styles: `
    /* The host is the flex item inside the header, so the growth is declared here and the button
       simply fills it. Declaring it on the button instead would leave the host at its content width
       and the two would disagree about how wide this is. */
    :host {
      display: block;
      /* Grows to 20rem, and gives way before the title does. Both can shrink, but this one is sized
         from 20rem while the title is sized from its text, so the crowding lands here first - which
         is the right way round: the heading says where you are, and this box's text is only a hint.
         The margin is on the right, towards the icon buttons it sits beside. */
      flex: 0 1 20rem;
      min-width: 0;
      margin-right: 0.25rem;
    }

    /* A pill, matching the account button at the other end of the row - those are the only two
       rounded things in the header, so making them the same shape is what keeps the run of icons
       between them reading as a group rather than as leftovers. */
    .trigger {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      height: 2.375rem;
      padding: 0 0.3125rem 0 0.8125rem;
      border: 1px solid var(--app-border);
      border-radius: 999px;
      background-color: var(--mat-sys-surface-container-high);
      cursor: pointer;
      /* The header is translucent and blurred. Without a shadow of its own the pill reads as a hole
         punched in it rather than as a control sitting on it. */
      box-shadow: var(--app-shadow-sm);
      transition:
        border-color var(--app-dur-fast) var(--app-ease),
        background-color var(--app-dur-fast) var(--app-ease),
        box-shadow var(--app-dur-fast) var(--app-ease);
    }

    /* Everything inside lifts together, which is what makes it read as one control rather than as a
       row of three. No movement: this sits in a sticky header, and a control that shifts under the
       pointer there is more distracting than it is responsive. */
    .trigger:hover {
      border-color: color-mix(in srgb, var(--mat-sys-primary) 50%, var(--app-border));
      background-color: var(--mat-sys-surface);
      box-shadow: var(--app-shadow-md);
    }

    /* An outline rather than a tinted border, so the focus state stays visible in a forced-colours
       mode - where the border colour above is replaced by the system's own. */
    .trigger:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    .trigger-icon {
      flex: 0 0 auto;
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
      color: var(--mat-sys-on-surface-variant);
      transition: color var(--app-dur-fast) var(--app-ease);
    }

    .trigger-text {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
      transition: color var(--app-dur-fast) var(--app-ease);
    }

    .trigger:hover .trigger-icon {
      color: var(--mat-sys-primary);
    }

    .trigger:hover .trigger-text {
      color: var(--mat-sys-on-surface);
    }

    /* A pill inside a pill. Deliberately not the same shape as the key caps in the palette's footer:
       those name several keys individually, while this names one shortcut, read as a single thing. */
    .trigger-shortcut {
      display: inline-flex;
      align-items: center;
      gap: 0.0625rem;
      flex: 0 0 auto;
      height: 1.625rem;
      padding: 0 0.5rem;
      border-radius: 999px;
      background-color: color-mix(in srgb, var(--mat-sys-on-surface) 7%, transparent);
      font: var(--mat-sys-label-small);
      font-family: var(--mat-sys-plain-font-family);
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1;
      color: var(--mat-sys-on-surface-variant);
      transition:
        background-color var(--app-dur-fast) var(--app-ease),
        color var(--app-dur-fast) var(--app-ease);
    }

    .trigger:hover .trigger-shortcut {
      background-color: color-mix(in srgb, var(--mat-sys-primary) 15%, transparent);
      color: var(--mat-sys-primary);
    }

    /* Lighter than the keys it joins, so Ctrl and K are what the eye picks up and the plus is only
       punctuation between them. */
    .trigger-shortcut-sep {
      font-weight: 400;
      opacity: 0.6;
    }

    /* Below this the hint and the shortcut cannot share a row with the title and three controls, so
       the box becomes the icon it already contains. The accessible name is on the button rather than
       on the text, so hiding the text costs nothing - and the shortcut being advertised is not on a
       phone keyboard in any case. */
    @media (max-width: 767px) {
      :host {
        flex: 0 0 auto;
        width: 2.375rem;
        margin-right: 0;
      }

      .trigger {
        padding: 0;
        justify-content: center;
      }

      .trigger-text,
      .trigger-shortcut {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchTrigger {
  /** Clicked. Named for what the user did, not for what the shell happens to do about it. */
  readonly activate = output<void>();
}
