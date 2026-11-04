import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,limit,orderBy,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
let env;
const email = 'alice@example.com', otherEmail = 'bob@example.com';
const token = email => ({email,email_verified:true,firebase:{sign_in_provider:'google.com'}});
const room = {version:1,uid:'alice',iv:'AAAAAAAAAAAAAAAA',ciphertext:'AAAAAAAAAAAAAAAAAAAAAA==',createdAt:serverTimestamp()};
const message = uid => ({uid,iv:'AAAAAAAAAAAAAAAA',ciphertext:'AAAAAAAAAAAAAAAAAAAAAA==',createdAt:serverTimestamp(),editedAt:serverTimestamp()});
before(async () => {
  if (!enabled) return;
  const [host,port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({projectId:'demo-ikimiz',firestore:{host,port:Number(port),rules:await readFile('firestore.rules','utf8')}});
});
beforeEach(async () => {
  if (!enabled) return;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db,'private/access'),{emails:[email,otherEmail]});
    await setDoc(doc(db,'rooms/ikimiz'),room);
    await setDoc(doc(db,'rooms/ikimiz/messages/a'),message('alice'));
  });
});
after(async () => {await env?.cleanup();});
const check = (name,fn) => test(name,{skip:!enabled},fn);
check('anonymous, unrelated, unverified and non-Google accounts cannot read messages',async () => {
  for (const context of [env.unauthenticatedContext(),env.authenticatedContext('eve',token('eve@example.com')),env.authenticatedContext('alice',{...token(email),email_verified:false}),env.authenticatedContext('alice',{...token(email),firebase:{sign_in_provider:'password'}})]) await assertFails(getDoc(doc(context.firestore(),'rooms/ikimiz/messages/a')));
});
check('only verified allowlisted members can get rooms and bounded message queries',async () => {
  const db = env.authenticatedContext('alice',token(email)).firestore();
  await assertSucceeds(getDoc(doc(db,'rooms/ikimiz')));
  const result = await assertSucceeds(getDocs(query(collection(db,'rooms/ikimiz/messages'),orderBy('createdAt','desc'),limit(50))));
  assert.equal(result.size,1);
  await assertFails(getDocs(collection(db,'rooms/ikimiz/messages')));
  await assertFails(getDocs(query(collection(db,'rooms/ikimiz/messages'),limit(51))));
  await assertFails(getDoc(doc(db,'private/access')));
  await assertFails(setDoc(doc(db,'private/access'),{emails:['eve@example.com']}));
  await assertFails(getDoc(doc(db,'rooms/another/messages/a')));
});
check('sender forgery, extra fields, missing fields, oversized ciphertext and forged timestamps fail',async () => {
  const db = env.authenticatedContext('alice',token(email)).firestore();
  const ref = doc(db,'rooms/ikimiz/messages/b');
  await assertSucceeds(setDoc(ref,message('alice')));
  await assertFails(setDoc(ref,message('bob')));
  await assertFails(setDoc(doc(db,'rooms/ikimiz/messages/c'),{...message('alice'),plaintext:'leak'}));
  const missing = message('alice'); delete missing.iv;
  await assertFails(setDoc(doc(db,'rooms/ikimiz/messages/c'),missing));
  await assertFails(setDoc(doc(db,'rooms/ikimiz/messages/c'),{...message('alice'),ciphertext:'A'.repeat(24001)}));
  await assertFails(setDoc(doc(db,'rooms/ikimiz/messages/c'),{...message('alice'),createdAt:new Date(0)}));
});
check('only owner may edit/delete; UID, creation time and schema are protected on update',async () => {
  const alice = env.authenticatedContext('alice',token(email)).firestore();
  const bob = env.authenticatedContext('bob',token(otherEmail)).firestore();
  await assertFails(updateDoc(doc(bob,'rooms/ikimiz/messages/a'),{editedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(bob,'rooms/ikimiz/messages/a')));
  const ref = doc(alice,'rooms/ikimiz/messages/a');
  await assertFails(updateDoc(ref,{uid:'bob',editedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{createdAt:serverTimestamp(),editedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{admin:true,editedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref,{iv:'BBBBBBBBBBBBBBBB',ciphertext:'BBBBBBBBBBBBBBBBBBBBBB==',editedAt:serverTimestamp()}));
  await assertSucceeds(deleteDoc(ref));
});
check('room verifier is immutable and statuses cannot spoof peers',async () => {
  const db = env.authenticatedContext('alice',token(email)).firestore();
  await assertFails(updateDoc(doc(db,'rooms/ikimiz'),{iv:'BBBBBBBBBBBBBBBB'}));
  await assertFails(deleteDoc(doc(db,'rooms/ikimiz')));
  const status = {uid:'alice',seenAt:serverTimestamp(),typingAt:serverTimestamp(),typing:true};
  await assertSucceeds(setDoc(doc(db,'rooms/ikimiz/status/alice'),status));
  await assertFails(setDoc(doc(db,'rooms/ikimiz/status/bob'),{...status,uid:'bob'}));
  await assertFails(updateDoc(doc(db,'rooms/ikimiz/status/alice'),{uid:'bob',seenAt:serverTimestamp(),typingAt:serverTimestamp()}));
});
check('subcollections require the parent room; first room can be created exactly once',async () => {
  await env.withSecurityRulesDisabled(async context => deleteDoc(doc(context.firestore(),'rooms/ikimiz')));
  const db = env.authenticatedContext('alice',token(email)).firestore();
  await assertFails(getDoc(doc(db,'rooms/ikimiz/messages/a')));
  await assertFails(setDoc(doc(db,'rooms/ikimiz/messages/b'),message('alice')));
  await assertSucceeds(setDoc(doc(db,'rooms/ikimiz'),room));
  await assertFails(setDoc(doc(db,'rooms/ikimiz'),room));
});
