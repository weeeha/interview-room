// The browser counts every ms value it sends from the session's startedAt, the same origin the
// server uses for interviewer turns. This returns that origin on the browser's own clock.
/**
 * @param perfNow performance.now() in ms
 * @param wallNow Date.now() in ms
 * @param startedAt the session's ISO startedAt from the server
 * @returns the performance.now() value that corresponds to session time zero
 */
export function sessionStartOnPerfClock(perfNow: number, wallNow: number, startedAt: string): number {
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) return perfNow;
  return perfNow - Math.max(0, wallNow - startedMs);
}
