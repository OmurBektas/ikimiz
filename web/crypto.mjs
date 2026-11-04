const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function toBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
export function fromBase64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
export function generateSecret() { return toBase64(crypto.getRandomValues(new Uint8Array(32))); }
export async function importSecret(secret) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret.trim())) throw new Error('Anahtar 32 baytlık geçerli bir sohbet anahtarı olmalı.');
  return crypto.subtle.importKey('raw', fromBase64(secret.trim()), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},key,encoder.encode(JSON.stringify(value)));
  return {iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(data))};
}
export async function decrypt(key, envelope, context) {
  const data = await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.iv),additionalData:encoder.encode(context)},key,fromBase64(envelope.ciphertext));
  return JSON.parse(decoder.decode(data));
}
export const messageContext = (id, uid) => `ikimiz:v1:message:${id}:${uid}`;
