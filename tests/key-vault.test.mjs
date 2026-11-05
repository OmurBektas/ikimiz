import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {rememberKey,loadRememberedKey,forgetRememberedKey,KEY_CACHE_MARKER,KEY_REVOCATION_MARKER,invalidateKeyOperations} from '../web/key-vault.mjs';
import {generateSecret,importSecret,encrypt,decrypt} from '../web/crypto.mjs';
globalThis.indexedDB = indexedDB;
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key,value) => storage.set(key,String(value)),
  removeItem: key => storage.delete(key)
};
beforeEach(async () => { await forgetRememberedKey(); });
test('a non-extractable key survives storage and still decrypts; wrong account is rejected',async () => {
  const key = await importSecret(generateSecret());
  const now = Date.now(), expiry = now+60000;
  const box = await encrypt(key,{text:'Özel 🤍'},'test-context');
  assert.equal(await rememberKey(key,'alice',expiry,now),true);
  const saved = await loadRememberedKey('alice',expiry,now);
  assert.equal(saved.key.extractable,false);
  await assert.rejects(crypto.subtle.exportKey('raw',saved.key));
  assert.deepEqual(await decrypt(saved.key,box,'test-context'),{text:'Özel 🤍'});
  assert.equal(await loadRememberedKey('bob',expiry,now),null);
});
test('expiration is fixed, does not slide on restore, and respects Google session expiry',async () => {
  const key = await importSecret(generateSecret());
  const now = Date.now(), expiry=now+1000;
  assert.equal(await rememberKey(key,'alice',expiry,now),true);
  assert.ok(await loadRememberedKey('alice',expiry,expiry-1));
  assert.equal(await loadRememberedKey('alice',expiry,expiry),null);
  assert.equal(await loadRememberedKey('alice',expiry-1,now),null);
  assert.equal(await rememberKey(key,'alice',now+86400001,now),false);
});
test('emergency exit revokes restoration immediately, before asynchronous deletion finishes',async () => {
  const now = Date.now(), key=await importSecret(generateSecret());
  await rememberKey(key,'alice',now+60000,now);
  const deletion = forgetRememberedKey();
  assert.equal(JSON.parse(localStorage.getItem(KEY_CACHE_MARKER)).revoked,true);
  assert.equal(await loadRememberedKey('alice',now+60000,now),null);
  await deletion;
  assert.equal(await loadRememberedKey('alice',now+60000,now),null);
});
test('emergency exit or cross-tab invalidation cancels an in-flight remember operation',async () => {
  const now = Date.now(), key=await importSecret(generateSecret());
  const pending=rememberKey(key,'alice',now+60000,now);
  await forgetRememberedKey();
  assert.equal(await pending,false);
  assert.equal(await loadRememberedKey('alice',now+60000,now),null);
  const other=rememberKey(key,'alice',now+60000,now);
  invalidateKeyOperations();
  assert.equal(await other,false);
});
test('tampered markers and blocked local storage fail closed',async () => {
  const now=Date.now(), key=await importSecret(generateSecret());
  await rememberKey(key,'alice',now+60000,now);
  const marker=JSON.parse(localStorage.getItem(KEY_CACHE_MARKER));
  localStorage.setItem(KEY_CACHE_MARKER,JSON.stringify({...marker,id:'tampered'}));
  assert.equal(await loadRememberedKey('alice',now+60000,now),null);
  const originalSet=localStorage.setItem;
  try { localStorage.setItem=() => {throw new Error('Blocked');}; assert.equal(await rememberKey(key,'alice',now+60000,now),false); }
  finally { localStorage.setItem=originalSet; }
});
test('a separate tab revokes saved keys even before its storage event is processed',async () => {
  const now=Date.now(), key=await importSecret(generateSecret());
  await rememberKey(key,'alice',now+60000,now);
  // Another JS context changes only its durable revocation token. The current
  // context has not received a storage event and its local revision is unchanged.
  localStorage.setItem(KEY_REVOCATION_MARKER,'another-tab-quick-exit');
  assert.equal(await loadRememberedKey('alice',now+60000,now),null);
});
