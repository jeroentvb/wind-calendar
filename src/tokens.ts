import { createHash, timingSafeEqual } from 'node:crypto';

// 256 bits in URL-safe base64 without padding is 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,}$/;

/** Primary token plus an optional second one for rotation. */
export function loadTokens(env: Record<string, string | undefined> = process.env): string[] {
   const tokens = ['WIND_CAL_TOKEN', 'WIND_CAL_TOKEN_2'].flatMap((name) => {
      const t = env[name]?.trim();
      if (!t) return [];
      if (!TOKEN_PATTERN.test(t)) {
         throw new Error(`${name} must be at least 43 URL-safe base64 characters (256 bits)`);
      }
      return [t];
   });
   if (tokens.length === 0) throw new Error('WIND_CAL_TOKEN is required');
   return tokens;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time comparison against every configured token (no short-circuit). */
export function tokenMatches(candidate: string, tokens: readonly string[]): boolean {
   const c = digest(candidate);
   let match = false;
   for (const t of tokens) match = timingSafeEqual(c, digest(t)) || match;
   return match;
}
