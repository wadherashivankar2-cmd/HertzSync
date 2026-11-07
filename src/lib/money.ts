/**
 * Money utilities for integer lamport calculations.
 * Never use floating point math for amounts.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function assertValidLamports(amount: unknown): asserts amount is number {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    throw new Error(`Invalid lamports amount: ${amount}. Must be a non-negative integer.`);
  }
}

export function assertPositiveLamports(amount: unknown): asserts amount is number {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid lamports amount: ${amount}. Must be a positive integer.`);
  }
}

export function addLamports(a: number, b: number): number {
  assertValidLamports(a);
  assertValidLamports(b);
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`Integer overflow adding lamports: ${a} + ${b}`);
  }
  return sum;
}

export function sumLamports(amounts: number[]): number {
  return amounts.reduce((total, cur) => addLamports(total, cur), 0);
}

/**
 * Format lamports to SOL string with exact decimals (always 9 decimal places).
 */
export function formatLamportsToSol(lamports: number): string {
  assertValidLamports(lamports);
  const solPart = Math.floor(lamports / 1_000_000_000);
  const fracPart = (lamports % 1_000_000_000).toString().padStart(9, "0");
  return `${solPart}.${fracPart}`;
}

/**
 * Parses a decimal SOL string into integer lamports without float inaccuracy.
 */
export function solToLamports(solString: string): number {
  if (!/^\d+(\.\d{1,9})?$/.test(solString)) {
    throw new Error(`Invalid SOL string format: ${solString}`);
  }
  const [whole, frac = ""] = solString.split(".");
  const paddedFrac = frac.padEnd(9, "0").slice(0, 9);
  const lamports = Number(whole) * 1_000_000_000 + Number(paddedFrac);
  if (!Number.isSafeInteger(lamports)) {
    throw new Error(`Lamports overflow from SOL value: ${solString}`);
  }
  return lamports;
}

