export const nowDate = () => new Date();
export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
export const addMinutes = (d: Date, m: number) => addSeconds(d, m * 60);
export const secondsBetween = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / 1000);
export const remainingSeconds = (deadline: Date, now: Date) => Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));

/** deadline = min(start + duration + extra, hardEndsAt?) */
export function computeDeadline(opts: { startedAt: Date; durationMinutes: number; extraMinutes: number; hardEndsAt?: Date | null }) {
  const base = addMinutes(opts.startedAt, opts.durationMinutes + opts.extraMinutes);
  if (opts.hardEndsAt && opts.hardEndsAt.getTime() < base.getTime()) return opts.hardEndsAt;
  return base;
}
