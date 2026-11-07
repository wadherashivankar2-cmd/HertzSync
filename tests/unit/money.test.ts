import { describe, it, expect } from "vitest";
import {
  addLamports,
  sumLamports,
  formatLamportsToSol,
  solToLamports,
  assertValidLamports,
} from "../../src/lib/money";

describe("Money and Lamport Math", () => {
  it("sums lamports accurately without floats", () => {
    expect(addLamports(1000, 2000)).toBe(3000);
    expect(sumLamports([500, 1500, 3000])).toBe(5000);
  });

  it("rejects floats and non-integers", () => {
    expect(() => addLamports(10.5, 20)).toThrow(/Invalid lamports amount/);
    expect(() => assertValidLamports(3.14159)).toThrow(/Invalid lamports amount/);
    expect(() => sumLamports([100, 200.25])).toThrow(/Invalid lamports amount/);
  });

  it("rejects negative numbers", () => {
    expect(() => addLamports(-1, 100)).toThrow(/Invalid lamports amount/);
    expect(() => addLamports(100, -50)).toThrow(/Invalid lamports amount/);
    expect(() => sumLamports([-10, 20])).toThrow(/Invalid lamports amount/);
  });

  it("formats lamports to 9-decimal SOL string", () => {
    expect(formatLamportsToSol(1_000_000_000)).toBe("1.000000000");
    expect(formatLamportsToSol(50_000)).toBe("0.000050000");
    expect(formatLamportsToSol(123_456_789)).toBe("0.123456789");
  });

  it("parses SOL string to lamports without float inaccuracies", () => {
    expect(solToLamports("1.0")).toBe(1_000_000_000);
    expect(solToLamports("0.00005")).toBe(50_000);
    expect(solToLamports("0.123456789")).toBe(123_456_789);
  });
});

