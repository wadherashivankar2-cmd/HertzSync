import crypto from "crypto";

/**
 * Identifier and Memo utilities.
 * Section 2.3, 5.2, 5.3 step 4, 7.1 (S18)
 */

export const MEMO_MAX_BYTES = 120;

// Crockford's Base32 encoding characters (used in ULID)
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;

/**
 * Generates a standard ULID (Universally Unique Lexicographically Sortable Identifier).
 * 26 characters string: 10 characters time component (ms) + 16 characters random component.
 */
export function generateUlid(timestampMs: number = Date.now()): string {
  // 48-bit timestamp
  let timeStr = "";
  let time = timestampMs;
  for (let i = 9; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    timeStr = ENCODING.charAt(mod) + timeStr;
    time = Math.floor(time / ENCODING_LEN);
  }

  // 80-bit randomness (16 chars)
  const randomBytes = crypto.randomBytes(10);
  let randStr = "";
  for (let i = 0; i < 16; i++) {
    // 80 bits / 5 bits per char = 16 characters
    // Map random bytes to chars
    const byteIndex = Math.floor((i * 5) / 8);
    const bitOffset = (i * 5) % 8;
    const word =
      ((randomBytes[byteIndex] << 8) | (randomBytes[byteIndex + 1] || 0)) >>
      (11 - bitOffset);
    randStr += ENCODING.charAt(word & 31);
  }

  return timeStr + randStr;
}

/**
 * Builds the settlement batch memo: `trickle:v1:<batchId>:<eventsHash>`
 * Validates length against MEMO_MAX_BYTES (120 bytes).
 */
export function buildBatchMemo(batchId: string, eventsHash: string): string {
  const memo = `trickle:v1:${batchId}:${eventsHash}`;
  const byteLength = Buffer.byteLength(memo, "utf8");

  if (byteLength > MEMO_MAX_BYTES) {
    throw new Error(
      `Memo length ${byteLength} exceeds maximum allowed bytes of ${MEMO_MAX_BYTES}: "${memo}"`
    );
  }

  return memo;
}

