// A non-extractable browser CryptoKey, never the original shared-code string.
// A synchronous revocation marker prevents restoration after a quick exit even
// if navigation interrupts the asynchronous IndexedDB deletion.
export const KEY_CACHE_MARKER = 'ikimiz:/ikimiz/:key-session-v1';
export const KEY_REVOCATION_MARKER = KEY_CACHE_MARKER + ':revocation';
const DATABASE = 'ikimiz-device-key-v1';
const STORE = 'keys';
const RECORD = 'active';
const MAX_AGE = 24 * 60 * 60 * 1000;
let revision = 0;
export function invalidateKeyOperations() { revision++; }

function readMarker() {
  try { return JSON.parse(localStorage.getItem(KEY_CACHE_MARKER) || 'null'); }
  catch { return null; }
}
function openDatabase() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DATABASE,1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Key storage is blocked'));
  });
}
async function accessStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve,reject) => {
      const transaction = database.transaction(STORE,mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Key storage aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('Key storage failed'));
    });
  } finally { database.close(); }
}
export function forgetRememberedKey() {
  revision++;
  try {
    localStorage.setItem(KEY_REVOCATION_MARKER,crypto.randomUUID());
    localStorage.setItem(KEY_CACHE_MARKER,JSON.stringify({revoked:true,id:crypto.randomUUID()}));
  } catch { /* Restoration also fails closed. */ }
  return accessStore('readwrite',store => store.delete(RECORD)).then(() => true,() => false);
}
export async function rememberKey(key,uid,expiresAt,now = Date.now()) {
  if (!uid || key?.extractable !== false || key?.algorithm?.name !== 'AES-GCM'
      || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_AGE) return false;
  const currentRevision = ++revision;
  const id = crypto.randomUUID();
  try {
    const revocation = localStorage.getItem(KEY_REVOCATION_MARKER);
    // Do not store a key unless synchronous revocation storage is available.
    localStorage.setItem(KEY_CACHE_MARKER + ':probe','1');
    localStorage.removeItem(KEY_CACHE_MARKER + ':probe');
    const database = await openDatabase();
    try {
      if (currentRevision !== revision) return false;
      await new Promise((resolve,reject) => {
        const transaction = database.transaction(STORE,'readwrite');
        transaction.objectStore(STORE).put({id,uid,expiresAt,key,revocation},RECORD);
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
    if (currentRevision !== revision || localStorage.getItem(KEY_REVOCATION_MARKER) !== revocation) return false;
    localStorage.setItem(KEY_CACHE_MARKER,JSON.stringify({id,uid,expiresAt,revocation}));
    return true;
  } catch {
    if (currentRevision === revision) await forgetRememberedKey();
    return false;
  }
}
export async function loadRememberedKey(uid,maximumExpiry,now = Date.now()) {
  const currentRevision = revision;
  const marker = readMarker();
  if (!marker || marker.revoked || marker.uid !== uid || !Number.isFinite(marker.expiresAt)
      || marker.expiresAt <= now || marker.expiresAt > maximumExpiry || marker.expiresAt > now + MAX_AGE) return null;
  try {
    if (marker.revocation !== localStorage.getItem(KEY_REVOCATION_MARKER)) return null;
    const record = await accessStore('readonly',store => store.get(RECORD));
    if (currentRevision !== revision || readMarker()?.id !== marker.id || marker.revocation !== localStorage.getItem(KEY_REVOCATION_MARKER)) return null;
    if (!record || record.id !== marker.id || record.uid !== uid || record.expiresAt !== marker.expiresAt
        || record.revocation !== marker.revocation
        || record.key?.extractable !== false || record.key?.algorithm?.name !== 'AES-GCM') return null;
    return {key:record.key,expiresAt:record.expiresAt};
  } catch { return null; }
}
