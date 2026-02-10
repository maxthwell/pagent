import crypto from "node:crypto";

function keyFromString(s: string): Buffer {
  const buf = Buffer.from(s);
  if (buf.length >= 32) return buf.subarray(0, 32);
  const padded = Buffer.alloc(32);
  buf.copy(padded);
  return padded;
}

export function decryptString(ciphertextB64: string, keyStr: string): string {
  const key = keyFromString(keyStr);
  const buf = Buffer.from(ciphertextB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

