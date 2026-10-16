import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import {
  CommandPalette,
  CommandPaletteData,
  PaletteChoice,
  PaletteDestination,
} from './command-palette';

/** The component's bindings are template-only visibility, not runtime protection. */
interface Bindings {
  term: WritableSignal<string>;
  active: WritableSignal<number>;
  rows: () => { label: string; heading: string | null; choice: PaletteChoice }[];
  onKeydown: (event: KeyboardEvent) => void;
}

const DESTINATIONS: PaletteDestination[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'space_dashboard', group: 'Workspace' },
  { path: '/tickets', label: 'Tickets', icon: 'confirmation_number', group: 'Workspace' },
  { path: '/tickets/new', label: 'Raise a ticket', icon: 'add_circle', group: 'Workspace' },
  { path: '/admin/users', label: 'People', icon: 'group', group: 'Administration' },
];

describe('CommandPalette', () => {
  let closed: PaletteChoice[];

  function render(data: Partial<CommandPaletteData> = {}): ComponentFixture<CommandPalette> {
    closed = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            destinations: DESTINATIONS,
            canSearchTickets: true,
            ...data,
          } satisfies CommandPaletteData,
        },
        {
          provide: MatDialogRef,
          useValue: { close: (choice: PaletteChoice) => closed.push(choice) },
        },
      ],
    });

    const fixture = TestBed.createComponent(CommandPalette);
    TestBed.tick();
    return fixture;
  }

  function bindingsOf(fixture: ComponentFixture<CommandPalette>): Bindings {
    return fixture.componentInstance as unknown as Bindings;
  }

  function labels(fixture: ComponentFixture<CommandPalette>): string[] {
    return bindingsOf(fixture)
      .rows()
      .map((row) => row.label);
  }

  function type(fixture: ComponentFixture<CommandPalette>, term: string): void {
    bindingsOf(fixture).term.set(term);
    TestBed.tick();
  }

  function press(fixture: ComponentFixture<CommandPalette>, key: string): void {
    bindingsOf(fixture).onKeydown(new KeyboardEvent('keydown', { key, cancelable: true }));
    TestBed.tick();
  }

  describe('what it lists', () => {
    it('shows every destination, grouped, before anything is typed', () => {
      const fixture = render();

      // This is the whole request: Ctrl+K and the navigation is in front of you.
      expect(labels(fixture)).toEqual(['Dashboard', 'Tickets', 'Raise a ticket', 'People']);

      // The heading travels on the first row of each group and is null on the rest, which is what
      // lets the list be flat for the arrow keys and grouped on screen.
      expect(
        bindingsOf(fixture)
          .rows()
          .map((row) => row.heading),
      ).toEqual(['Workspace', null, null, 'Administration']);
    });

    it('filters on the label, whatever case it was typed in', () => {
      const fixture = render();
      type(fixture, 'TICK');

      expect(labels(fixture)).toEqual(['Tickets', 'Raise a ticket', 'Search tickets for “TICK”']);
    });

    it('filters on the group as well, for somebody who remembers where a screen lives', () => {
      const fixture = render();
      type(fixture, 'admin');

      expect(labels(fixture)).toEqual(['People', 'Search tickets for “admin”']);
    });

    it('says so when nothing matches at all', () => {
      const fixture = render({ canSearchTickets: false });
      type(fixture, 'chandelier');

      expect(labels(fixture)).toEqual([]);
      expect((fixture.nativeElement as HTMLElement).querySelector('.palette-empty')).not.toBeNull();
    });
  });

  describe('the ticket search', () => {
    it('is not offered until something has been typed', () => {
      const fixture = render();

      expect(labels(fixture)).not.toContain('Search tickets for “”');
      expect(bindingsOf(fixture).rows()).toHaveLength(4);
    });

    it('is not offered at all to somebody who may not read tickets', () => {
      const fixture = render({ canSearchTickets: false });
      type(fixture, 'payslip');

      // The palette reads no permissions itself; the shell tells it. A search that could only
      // answer 403 is an invitation to a dead end.
      expect(labels(fixture)).toEqual([]);
    });

    it('comes last, so Enter opens a screen whenever one matches', () => {
      const fixture = render();
      type(fixture, 'tickets');

      // Going somewhere is what this is for. The search is what is left when nothing matches.
      press(fixture, 'Enter');

      expect(closed).toEqual([{ kind: 'navigate', path: '/tickets' }]);
    });

    it('is the only row when nothing else matches, and Enter then picks it', () => {
      const fixture = render();
      type(fixture, 'payslip');

      expect(labels(fixture)).toEqual(['Search tickets for “payslip”']);

      press(fixture, 'Enter');

      expect(closed).toEqual([{ kind: 'search', term: 'payslip' }]);
    });

    it('trims the term, so a trailing space is not part of what is searched for', () => {
      const fixture = render();
      type(fixture, '  payslip  ');
      press(fixture, 'Enter');

      expect(closed).toEqual([{ kind: 'search', term: 'payslip' }]);
    });
  });

  describe('the keyboard', () => {
    it('moves the highlight down and up', () => {
      const fixture = render();

      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown');
      expect(bindingsOf(fixture).active()).toBe(2);

      press(fixture, 'ArrowUp');
      expect(bindingsOf(fixture).active()).toBe(1);
    });

    it('wraps at both ends rather than stopping', () => {
      const fixture = render();

      // Stopping is indistinguishable from the dialog having lost focus, which is the bug this
      // avoids: an arrow key that does nothing reads as broken.
      press(fixture, 'ArrowUp');
      expect(bindingsOf(fixture).active()).toBe(3);

      press(fixture, 'ArrowDown');
      expect(bindingsOf(fixture).active()).toBe(0);
    });

    it('jumps to the ends with Home and End', () => {
      const fixture = render();

      press(fixture, 'End');
      expect(bindingsOf(fixture).active()).toBe(3);

      press(fixture, 'Home');
      expect(bindingsOf(fixture).active()).toBe(0);
    });

    it('opens whatever is highlighted, not whatever is first', () => {
      const fixture = render();

      press(fixture, 'ArrowDown');
      press(fixture, 'Enter');

      expect(closed).toEqual([{ kind: 'navigate', path: '/tickets' }]);
    });

    it('returns the highlight to the top when the list changes under it', () => {
      const fixture = render();

      press(fixture, 'End');
      expect(bindingsOf(fixture).active()).toBe(3);

      // Without the reset this would point past the end of a one-row list, and Enter would silently
      // do nothing - which reads as the dialog having frozen.
      type(fixture, 'dash');

      expect(bindingsOf(fixture).active()).toBe(0);
      press(fixture, 'Enter');
      expect(closed).toEqual([{ kind: 'navigate', path: '/dashboard' }]);
    });

    it('does nothing on Enter when there is nothing to open', () => {
      const fixture = render({ canSearchTickets: false });
      type(fixture, 'chandelier');

      press(fixture, 'Enter');

      expect(closed).toEqual([]);
    });

    it('leaves Escape alone, because the dialog already closes on it', () => {
      const fixture = render();

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      bindingsOf(fixture).onKeydown(event);

      // Handling it here too would mean two things closing one dialog.
      expect(event.defaultPrevented).toBe(false);
      expect(closed).toEqual([]);
    });
  });
});
