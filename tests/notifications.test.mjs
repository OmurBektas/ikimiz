import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(await readFile('notifications/Code.gs','utf8'),context);
const policy = (...args) => JSON.parse(JSON.stringify(context.notificationPolicy(...args)));
const members = ['alice','bob'];
const message = (uid,at,id='a') => ({uid,at,name:'projects/demo/databases/(default)/documents/rooms/ikimiz/messages/'+id,time:new Date(at).toISOString()});
const baseline = () => ({lastAt:1000,pending:{}});
test('after more than an hour, only the recipient gets one alert; no 7-minute duplicate', () => {
  const time = 1000+3600001;
  const result = policy(baseline(),[message('alice',time)],{},members,time);
  assert.deepEqual(result.due,['bob']);
  result.state.pending.bob.notified = true;
  assert.deepEqual(policy(result.state,[],{},members,time+420000).due,[]);
});
test('ordinary conversation waits 7 minutes from first unread message, not last message', () => {
  const result = policy(baseline(),[message('alice',2000),message('alice',62000,'b')],{},members,421999);
  assert.deepEqual(result.due,[]);
  assert.deepEqual(policy(result.state,[],{},members,422000).due,['bob']);
});
test('a read receipt or answer cancels the unread reminder', () => {
  const result = policy(baseline(),[message('alice',2000)],{},members,2000);
  assert.deepEqual(policy(result.state,[],{bob:2000},members,422000).due,[]);
  const replied = policy(result.state,[message('bob',3000,'b')],{},members,3000);
  assert.equal(replied.state.pending.bob,undefined);
  assert.deepEqual(replied.due,[]);
});
test('already-read messages never send an email and neither sender receives their own alert', () => {
  const time = 3601001;
  const result = policy(baseline(),[message('alice',time)],{bob:time},members,time);
  assert.deepEqual(result.due,[]);
  assert.equal(result.state.pending.alice,undefined);
});
test('exactly one hour is not a new-activity alert; later unread episodes can notify again', () => {
  const result = policy(baseline(),[message('alice',3601000)],{},members,3601000);
  assert.deepEqual(result.due,[]);
  result.state.pending.bob.notified = true;
  const later = policy(result.state,[message('alice',7201001,'b')],{},members,7201001);
  assert.deepEqual(later.due,['bob']);
});
