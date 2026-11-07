import crypto from "crypto";
import nacl from "tweetnacl";
import { canonicalizeEventPayload, CanonicalEventPayload } from "./canonical";

/**
 * Computes SHA-256 hash of a string or buffer in hex encoding.
 */
export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Computes payload hash for a canonical event payload.
 */
export function computePayloadHash(payload: CanonicalEventPayload): string {
  const canonicalJson = canonicalizeEventPayload(payload);
  return sha256Hex(Buffer.from(canonicalJson, "utf8"));
}

/**
 * Verifies Ed25519 signature over a message using tweetnacl.
 * @param messageUtf8 The original message string (e.g. canonical JSON)
 * @param signatureBase64 Base64-encoded Ed25519 signature (64 bytes)
 * @param publicKeyBase64 Base64-encoded Ed25519 public key (32 bytes)
 * @returns boolean
 */
export function verifyEd25519Signature(
  messageUtf8: string,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    const publicKey = Buffer.from(publicKeyBase64, "base64");
    const message = Buffer.from(messageUtf8, "utf8");

    if (signature.length !== nacl.sign.signatureLength) {
      return false;
    }
    if (publicKey.length !== nacl.sign.publicKeyLength) {
      return false;
    }

    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
  } catch {
    return false;
  }
}

