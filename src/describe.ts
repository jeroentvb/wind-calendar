import { toSector } from './sectors.ts';
import type { CalendarEvent, Candidate } from './select.ts';

export function eventTitle(c: Candidate): string {
   return `${c.outlook ? '🔮' : '🏄'} ${c.spot.name} ${Math.round(c.avgWind)}-${Math.round(c.avgGust)}kn ${c.sector}`;
}

function clock(epoch: number, timeZone: string): string {
   return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      epoch * 1000,
   );
}

function dateTime(epoch: number, timeZone: string): string {
   return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
   }).format(epoch * 1000);
}

const num = (v: number, width: number) => String(Math.round(v)).padStart(width);

/** Plain-text description; iOS Calendar does not render HTML. */
export function eventDescription(e: CalendarEvent, timeZone: string, updatedAt?: number): string {
   const lines: string[] = [];
   if (e.outlook) {
      lines.push('⚠️ Uncertain long-range forecast');
      lines.push(
         `Seen in ${e.outlook.models.join(', ')} (${e.outlook.models.length} of ${e.outlook.of} models). ` +
            'Check again closer to the day.',
      );
      lines.push('');
   }
   lines.push(`Peak ${clock(e.peakStart, timeZone)}–${clock(e.peakEnd, timeZone)}`);
   lines.push('');
   lines.push('   Time   Wind Gust Dir');
   const peakTimes = new Set(e.peak.map((h) => h.time));
   for (const h of e.window) {
      const mark = peakTimes.has(h.time) ? '▶' : '  ';
      lines.push(`${mark} ${clock(h.time, timeZone)}  ${num(h.wind, 3)}  ${num(h.gust, 3)}  ${toSector(h.dir)}`);
   }
   lines.push('▶ = peak, wind/gust in knots');

   if (e.alsoGood.length > 0) {
      lines.push('');
      lines.push('Also good:');
      for (const c of e.alsoGood) {
         lines.push(
            `• ${c.spot.name} ${clock(c.peakStart, timeZone)}–${clock(c.peakEnd, timeZone)} ` +
               `${Math.round(c.avgWind)}-${Math.round(c.avgGust)}kn ${c.sector}`,
         );
      }
   }

   lines.push('');
   lines.push(`Models: ${[...new Set(e.window.flatMap((h) => h.models))].join(', ')}`);
   if (updatedAt !== undefined) lines.push(`Forecast updated ${dateTime(updatedAt, timeZone)}`);
   lines.push('Weather data by Open-Meteo.com (CC BY 4.0)');
   return lines.join('\n');
}
