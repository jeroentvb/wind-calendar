import { createHash } from 'node:crypto';
import { eventDescription, eventTitle } from './describe.ts';
import type { CalendarEvent } from './select.ts';

export function escapeText(s: string): string {
   return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting UTF-8 characters (RFC 5545 §3.1). */
export function foldLine(line: string): string {
   const encoder = new TextEncoder();
   const parts: string[] = [];
   let current = '';
   let size = 0;
   for (const ch of line) {
      const n = encoder.encode(ch).length;
      const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
      if (size + n > limit) {
         parts.push(current);
         current = '';
         size = 0;
      }
      current += ch;
      size += n;
   }
   parts.push(current);
   return parts.join('\r\n ');
}

export function formatUtc(epochSeconds: number): string {
   return new Date(epochSeconds * 1000)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
}

export function eventUid(spotName: string, windowStart: number): string {
   const iso = new Date(windowStart * 1000).toISOString();
   return `${createHash('sha256').update(`${spotName}|${iso}`).digest('hex').slice(0, 32)}@wind-calendar`;
}

const paramValue = (s: string) => `"${s.replace(/"/g, "'")}"`;

export interface RenderOptions {
   timezone: string;
   now: number;
   /** Last successful fetch per spot name (epoch seconds). */
   updatedAt?: Record<string, number>;
}

export function renderCalendar(events: readonly CalendarEvent[], opts: RenderOptions): string {
   const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//wind-calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Wind',
      `X-WR-TIMEZONE:${opts.timezone}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
   ];
   const stamp = formatUtc(opts.now);
   for (const e of events) {
      const { name, lat, lon } = e.spot;
      lines.push(
         'BEGIN:VEVENT',
         `UID:${eventUid(name, e.windowStart)}`,
         `DTSTAMP:${stamp}`,
         `DTSTART:${formatUtc(e.peakStart)}`,
         `DTEND:${formatUtc(e.peakEnd)}`,
         `SUMMARY:${escapeText(eventTitle(e))}`,
         `DESCRIPTION:${escapeText(eventDescription(e, opts.timezone, opts.updatedAt?.[name]))}`,
         `LOCATION:${escapeText(name)}`,
         `GEO:${lat};${lon}`,
         `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=200;X-TITLE=${paramValue(name)}:geo:${lat},${lon}`,
         'TRANSP:TRANSPARENT',
         ...(e.outlook ? ['STATUS:TENTATIVE'] : []),
         'END:VEVENT',
      );
   }
   lines.push('END:VCALENDAR');
   return lines.map(foldLine).join('\r\n') + '\r\n';
}
