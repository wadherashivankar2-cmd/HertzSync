import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { verifyEd25519Signature, computePayloadHash, sha256Hex } from "../../src/lib/crypto";
import { canonicalizeEventPayload } from "../../src/lib/canonical";

describe("Crypto and Ed25519 Verification", () => {
  const keypair = nacl.sign.keyPair();
  const publicKeyBase64 = Buffer.from(keypair.publicKey).toString("base64");

  const payload = {
    amountLamports: 100000,
    businessId: "biz_crypto_test",
    deviceId: "dev_crypto_test",
    epoch: 1,
    occurredAt: 1700000000000,
    seq: 10,
  };

  const canonicalJson = canonicalizeEventPayload(payload);
  const signatureBytes = nacl.sign.detached(
    new Uint8Array(Buffer.from(canonicalJson, "utf8")),
    keypair.secretKey
  );
  const signatureBase64 = Buffer.from(signatureBytes).toString("base64");

  it("verifies a valid Ed25519 signature", () => {
    const isValid = verifyEd25519Signature(canonicalJson, signatureBase64, publicKeyBase64);
    expect(isValid).toBe(true);
  });

  it("fails when payload is altered", () => {
    const alteredJson = canonicalizeEventPayload({ ...payload, amountLamports: 999999 });
    const isValid = verifyEd25519Signature(alteredJson, signatureBase64, publicKeyBase64);
    expect(isValid).toBe(false);
  });

  it("fails when public key is wrong", () => {
    const anotherKeypair = nacl.sign.keyPair();
    const wrongKeyBase64 = Buffer.from(anotherKeypair.publicKey).toString("base64");
    const isValid = verifyEd25519Signature(canonicalJson, signatureBase64, wrongKeyBase64);
    expect(isValid).toBe(false);
  });

  it("computes deterministic SHA-256 payload hash", () => {
    const hash1 = computePayloadHash(payload);
    const hash2 = sha256Hex(Buffer.from(canonicalJson, "utf8"));
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});

