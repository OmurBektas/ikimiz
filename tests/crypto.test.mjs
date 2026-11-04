import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateSecret,importSecret,encrypt,decrypt,messageContext} from '../web/crypto.mjs';
test('Turkish text and emoji round-trip; ciphertext hides the message', async () => {
  const key = await importSecret(generateSecret());
  const text = {text:'İyi ki varsın 🤍 <script>alert(1)</script>',reply:'Önceki mesaj'};
  const box = await encrypt(key,text,messageContext('a','alice'));
  assert.deepEqual(await decrypt(key,box,messageContext('a','alice')),text);
  assert.ok(!box.ciphertext.includes('varsın'));
});
test('wrong key, sender, document id and modified ciphertext fail authentication', async () => {
  const key = await importSecret(generateSecret());
  const box = await encrypt(key,{text:'private'},messageContext('a','alice'));
  await assert.rejects(decrypt(await importSecret(generateSecret()),box,messageContext('a','alice')));
  await assert.rejects(decrypt(key,box,messageContext('a','bob')));
  await assert.rejects(decrypt(key,box,messageContext('b','alice')));
  const modified = {...box,ciphertext:(box.ciphertext[0] === 'A' ? 'B' : 'A') + box.ciphertext.slice(1)};
  await assert.rejects(decrypt(key,modified,messageContext('a','alice')));
});
test('each encryption gets an independent nonce and malformed keys are rejected', async () => {
  const key = await importSecret(generateSecret());
  const a = await encrypt(key,{text:'same'},'ctx');
  const b = await encrypt(key,{text:'same'},'ctx');
  assert.notEqual(a.iv,b.iv);
  assert.notEqual(a.ciphertext,b.ciphertext);
  await assert.rejects(importSecret('weak-password'));
});
