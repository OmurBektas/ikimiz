// Private Google Apps Script worker. No public web endpoint, message plaintext,
// decryption keys, service-account keys, or email addresses belong in this file.
const NOTIFY_PROJECT = 'ikimiz-omurbektas-2026';
const STATE_KEY = 'notification-state-v1';
const HOUR_MS = 60 * 60 * 1000;
const REMINDER_MS = 7 * 60 * 1000;

// Pure policy function, also exercised by the local test suite.
function notificationPolicy(previous, messages, seen, members, now) {
  const state = JSON.parse(JSON.stringify(previous));
  state.pending = state.pending || {};
  for (const uid of members) {
    const pending = state.pending[uid];
    if (pending && (seen[uid] || 0) >= pending.lastAt) delete state.pending[uid];
  }
  for (const message of messages) {
    const gap = !state.lastAt || message.at - state.lastAt > HOUR_MS;
    state.cursor = {time:message.time,name:message.name};
    state.lastAt = Math.max(state.lastAt || 0,message.at);
    if (!members.includes(message.uid)) continue;
    delete state.pending[message.uid]; // An answer also ends the sender's unread episode.
    const recipient = members.find(uid => uid !== message.uid);
    if ((seen[recipient] || 0) >= message.at) continue;
    let pending = state.pending[recipient];
    if (!pending || gap) pending = {firstAt:message.at,lastAt:message.at,name:message.name,immediate:gap,notified:false};
    pending.lastAt = message.at;
    pending.name = message.name;
    state.pending[recipient] = pending;
  }
  const due = members.filter(uid => {
    const pending = state.pending[uid];
    return pending && !pending.notified && (seen[uid] || 0) < pending.lastAt
      && (pending.immediate || now-pending.firstAt >= REMINDER_MS);
  });
  return {state:state,due:due};
}

function firestoreRequest(path, body) {
  const options = {method:body ? 'post' : 'get',muteHttpExceptions:true,
    headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken()}};
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  const response = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + NOTIFY_PROJECT + '/databases/(default)/documents' + path,options);
  const code = response.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    let reason = '';
    try { reason = JSON.parse(response.getContentText()).error.message.slice(0,800); } catch (_) {}
    throw new Error('Firestore request failed (' + code + '). ' + reason);
  }
  return JSON.parse(response.getContentText());
}
function fieldValue(field) {
  if (!field) return null;
  if ('stringValue' in field) return field.stringValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('timestampValue' in field) return field.timestampValue;
  if ('mapValue' in field) {
    const result = {};
    const fields = field.mapValue.fields || {};
    Object.keys(fields).forEach(key => { result[key] = fieldValue(fields[key]); });
    return result;
  }
  return null;
}
function loadSettings() {
  const document = firestoreRequest('/private/notification-settings');
  if (!document) throw new Error('Notification settings have not been prepared.');
  const settings = fieldValue({mapValue:{fields:document.fields}});
  const members = Object.keys(settings.recipients || {});
  if (members.length !== 2 || members.some(uid => typeof settings.recipients[uid] !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.recipients[uid]))) throw new Error('Exactly two configured recipients are required.');
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== settings.senderEmail.toLowerCase()) throw new Error('Use the configured sender Google account.');
  if (settings.subject !== 'Güncelleme' || settings.body !== 'Yeni bir güncelleme var.' || settings.senderName !== 'Güncelleme') throw new Error('Notification content must match the approved neutral template.');
  return settings;
}
function readSeen() {
  const rows = firestoreRequest('/rooms/ikimiz:runQuery',{structuredQuery:{
    select:{fields:[{fieldPath:'seenAt'}]},from:[{collectionId:'status'}],limit:2
  }}) || [];
  const result = {};
  rows.forEach(row => { if (row.document) result[row.document.name.split('/').pop()] = Date.parse(row.document.fields.seenAt.timestampValue); });
  return result;
}
function readMessages(cursor, latestOnly) {
  const structuredQuery = {
    select:{fields:[{fieldPath:'uid'},{fieldPath:'createdAt'}]},
    from:[{collectionId:'messages'}],
    orderBy:[{field:{fieldPath:'createdAt'},direction:latestOnly ? 'DESCENDING' : 'ASCENDING'},
      {field:{fieldPath:'__name__'},direction:latestOnly ? 'DESCENDING' : 'ASCENDING'}],
    limit:latestOnly ? 1 : 50
  };
  if (cursor && !latestOnly) structuredQuery.startAt = {values:[{timestampValue:cursor.time},{referenceValue:cursor.name}],before:false};
  const rows = firestoreRequest('/rooms/ikimiz:runQuery',{structuredQuery:structuredQuery}) || [];
  return rows.filter(row => row.document).map(row => ({
    name:row.document.name, uid:row.document.fields.uid.stringValue,
    time:row.document.fields.createdAt.timestampValue,
    at:Date.parse(row.document.fields.createdAt.timestampValue)
  }));
}
function saveState(state) { PropertiesService.getScriptProperties().setProperty(STATE_KEY,JSON.stringify(state)); }

function pollNotifications() {
  const mutex = LockService.getScriptLock();
  if (!mutex.tryLock(1000)) return;
  try {
    const settings = loadSettings();
    if (!settings.enabled) return;
    const members = Object.keys(settings.recipients);
    const saved = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
    if (!saved) throw new Error('Run installNotifications once before polling.');
    let state = JSON.parse(saved);
    const seen = readSeen();
    let caughtUp = false;
    for (let page=0;page<4;page++) {
      const messages = readMessages(state.cursor,false);
      state = notificationPolicy(state,messages,seen,members,Date.now()).state;
      saveState(state);
      if (messages.length < 50) { caughtUp = true; break; }
    }
    // Never notify from a partial backlog: an unread message might already have an answer.
    if (!caughtUp) return;
    const freshSeen = readSeen();
    const policy = notificationPolicy(state,[],freshSeen,members,Date.now());
    state = policy.state;
    const today = Utilities.formatDate(new Date(),'Europe/Istanbul','yyyy-MM-dd');
    if (state.day !== today) { state.day = today; state.sentToday = 0; }
    for (const uid of policy.due) {
      if ((state.sentToday || 0) >= 50 || MailApp.getRemainingDailyQuota() < 1) break;
      const pending = state.pending[uid];
      // Suppress a reminder when the last pending message was deleted.
      const relativePath = pending.name.split('/documents/')[1];
      if (!relativePath || !relativePath.startsWith('rooms/ikimiz/messages/')) throw new Error('Invalid pending message path.');
      const document = firestoreRequest('/' + relativePath + '?mask.fieldPaths=uid&mask.fieldPaths=createdAt');
      if (!document) { delete state.pending[uid]; continue; }
      // Reserve before sending. An uncertain send is not automatically retried,
      // avoiding duplicate emails after a timeout/crash. Delivery is best effort.
      pending.notified = true;
      state.sentToday = (state.sentToday || 0)+1;
      saveState(state);
      MailApp.sendEmail({to:settings.recipients[uid],subject:settings.subject,body:settings.body,name:settings.senderName});
    }
    saveState(state);
  } finally { mutex.releaseLock(); }
}

function installNotifications() {
  const mutex = LockService.getScriptLock();
  mutex.waitLock(10000);
  try {
    const settings = loadSettings();
    if (!settings.enabled) throw new Error('Notifications are not enabled in private settings.');
    const properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty(STATE_KEY)) {
      const latest = readMessages(null,true)[0];
      saveState({cursor:latest ? {time:latest.time,name:latest.name} : null,lastAt:latest ? latest.at : 0,pending:{}});
    }
    const existing = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'pollNotifications');
    if (!existing.length) ScriptApp.newTrigger('pollNotifications').timeBased().everyMinutes(1).create();
    console.log('Notifications installed. Existing messages do not generate retrospective emails. No test email was sent.');
  } finally { mutex.releaseLock(); }
}
function stopNotifications() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'pollNotifications')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  console.log('Notification polling stopped.');
}
