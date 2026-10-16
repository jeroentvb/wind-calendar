import { expect, test } from 'bun:test';
import { escapeText, eventUid, foldLine, formatUtc, renderCalendar } from '../src/ics.ts';
import { candidatesForSpot, selectEvents } from '../src/select.ts';
import { allDay, H, hours, spot, T0 } from './helpers.ts';

const octets = (s: string) => new TextEncoder().encode(s).length;

test('escapes text values', () => {
   expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
});

test('folds at 75 octets without splitting multi-byte characters', () => {
   const line = 'DESCRIPTION:' + '▶é'.repeat(60);
   const folded = foldLine(line);
   const parts = folded.split('\r\n');
   expect(parts.length).toBeGreaterThan(1);
   for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
   expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
   expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
   expect(foldLine('SHORT:x')).toBe('SHORT:x');
});

test('formats UTC timestamps', () => {
   expect(formatUtc(T0)).toBe('20261017T080000Z');
});

test('UID is stable and depends on spot and window start', () => {
   expect(eventUid('A', T0)).toBe(eventUid('A', T0));
   expect(eventUid('A', T0)).not.toBe(eventUid('A', T0 + H));
   expect(eventUid('A', T0)).not.toBe(eventUid('B', T0));
   expect(eventUid('A', T0)).toMatch(/^[0-9a-f]{32}@wind-calendar$/);
});

test('renders a complete calendar', () => {
   const s = spot('Scheveningen, beach', 1, { lat: 52.11, lon: 4.27 });
   const events = selectEvents(candidatesForSpot(s, hours([22, 26, 26, 26, 23, 23]), allDay));
   const ics = renderCalendar(events, { timezone: 'Europe/Amsterdam', now: T0, updatedAt: { [s.name]: T0 } });

   expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
   expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
   expect(ics).not.toMatch(/[^\r]\n/);
   for (const l of ics.split('\r\n')) expect(octets(l)).toBeLessThanOrEqual(75);

   const unfolded = ics.replace(/\r\n /g, '');
   expect(unfolded).toContain('DTSTART:20261017T090000Z');
   expect(unfolded).toContain('DTEND:20261017T120000Z');
   expect(unfolded).toContain('SUMMARY:🏄 Scheveningen\\, beach 26-34kn W');
   expect(unfolded).toContain('LOCATION:Scheveningen\\, beach');
   expect(unfolded).toContain('GEO:52.11;4.27');
   expect(unfolded).toContain(
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=200;X-TITLE="Scheveningen, beach":geo:52.11,4.27',
   );
   expect(unfolded).toContain(`UID:${eventUid(s.name, T0)}`);
   expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(1);
});

test('empty calendar is still valid', () => {
   const ics = renderCalendar([], { timezone: 'Europe/Amsterdam', now: T0 });
   expect(ics).toContain('BEGIN:VCALENDAR');
   expect(ics).not.toContain('VEVENT');
});
