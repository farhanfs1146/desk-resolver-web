import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

/** What the palette was closed with. `undefined` from the dialog means it was dismissed. */
export type PaletteChoice = { kind: 'navigate'; path: string } | { kind: 'search'; term: string };

/** One screen the user may open, as the shell's navigation already decided. */
export interface PaletteDestination {
  path: string;
  label: string;
  icon: string;
  /** The rail section it belongs to - "Workspace" or "Administration" - used as a heading. */
  group: string;
}

export interface CommandPaletteData {
  destinations: PaletteDestination[];
  /** Whether to offer searching tickets. The palette does not read permissions itself. */
  canSearchTickets: boolean;
}

/**
 * One line in the list.
 *
 * <p>Flat, although the list is drawn in groups. Keyboard navigation needs a single index to move
 * through - nesting the rows under their headings would mean walking two levels to answer "what is
 * the next row", and the arrow keys would have to know which level they were on. So the heading
 * travels on the first row of each group instead, and the template draws it when it is there.
 */
interface Row {
  id: string;
  label: string;
  icon: string;
  heading: string | null;
  choice: PaletteChoice;
}

/**
 * Ctrl+K: every screen the user may open, in one list, with the keyboard.
 *
 * <p>**Why this replaced a search field in the header.** The field was permanently present and did
 * one thing. This is summoned, lists what the rail lists, and costs nothing when it is not open -
 * which is most of the time. It also happens to be the thing a search field in a toolbar is usually
 * standing in for: not "filter this screen" but "take me somewhere".
 *
 * <p>The palette reads no permissions and calls no API. It is handed the destinations the shell has
 * already filtered, and it returns a choice rather than acting on one, so there is exactly one place
 * that decides what a user may reach - `Shell.sections` - and this is not a second one that could
 * disagree with it.
 */
@Component({
  selector: 'app-command-palette',
  imports: [MatDialogModule, MatIconModule],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPalette {
  private readonly dialog = inject(MatDialogRef<CommandPalette, PaletteChoice>);
  private readonly data = inject<CommandPaletteData>(MAT_DIALOG_DATA);

  protected readonly term = signal('');

  /**
   * The destinations that match, plus a ticket search when something has been typed.
   *
   * <p>The group name is matched as well as the label, so "admin" finds People and Applications -
   * somebody who remembers where a screen lives rather than what it is called gets there anyway.
   *
   * <p>The search row is **last**, which is the whole of its design. Enter therefore opens a screen
   * whenever one matches, because going somewhere is what this is for; the search is what is left
   * when nothing does, and then it is the only row and Enter picks it.
   */
  protected readonly rows = computed<Row[]>(() => {
    const term = this.term().trim();
    const needle = term.toLowerCase();

    const rows: Row[] = [];
    let previousGroup: string | null = null;

    for (const destination of this.data.destinations) {
      const matches =
        needle === '' ||
        destination.label.toLowerCase().includes(needle) ||
        destination.group.toLowerCase().includes(needle);

      if (!matches) {
        continue;
      }

      rows.push({
        id: `palette-row-${destination.path}`,
        label: destination.label,
        icon: destination.icon,
        heading: destination.group === previousGroup ? null : destination.group,
        choice: { kind: 'navigate', path: destination.path },
      });
      previousGroup = destination.group;
    }

    if (term !== '' && this.data.canSearchTickets) {
      rows.push({
        id: 'palette-row-search',
        label: `Search tickets for “${term}”`,
        icon: 'manage_search',
        heading: rows.length === 0 ? null : 'Search',
        choice: { kind: 'search', term },
      });
    }

    return rows;
  });

  /**
   * Which row Enter would take. Back to the top whenever the list changes.
   *
   * <p>A `linkedSignal` because that is exactly the relationship: the highlight is derived from the
   * list and then written over by the arrow keys. Without the reset, typing a letter that shortens
   * the list would leave the highlight pointing past the end of it, and Enter would do nothing at
   * all - a key that silently does nothing reads as the dialog having frozen.
   */
  protected readonly active = linkedSignal<Row[], number>({
    source: this.rows,
    computation: () => 0,
  });

  /** For `aria-activedescendant`: the input keeps focus, so the row is "active", never focused. */
  protected readonly activeId = computed(() => this.rows()[this.active()]?.id ?? null);

  protected onInput(value: string): void {
    this.term.set(value);
  }

  /**
   * The arrow keys, Enter, and Home/End.
   *
   * <p>Escape is deliberately absent: `MatDialog` closes on it already, and handling it here would
   * mean two things closing one dialog.
   */
  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.active.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.active.set(Math.max(0, this.rows().length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const row = this.rows()[this.active()];
        if (row) {
          this.choose(row);
        }
        break;
      }
      default:
        break;
    }
  }

  protected choose(row: Row): void {
    this.dialog.close(row.choice);
  }

  /**
   * Moves the highlight, wrapping at both ends.
   *
   * <p>Wrapping rather than stopping, because the list is short and the alternative is an arrow key
   * that stops responding at the bottom - which is indistinguishable from the dialog having lost
   * focus.
   */
  private move(step: number): void {
    const count = this.rows().length;
    if (count === 0) {
      return;
    }
    this.active.update((index) => (index + step + count) % count);
  }
}
