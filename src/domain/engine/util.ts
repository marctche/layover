export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Invariant violated: missing ${what}`);
  return value;
}
