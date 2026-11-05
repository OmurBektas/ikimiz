import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut,setPersistence,browserLocalPersistence,browserSessionPersistence,getIdTokenResult} from 'firebase/auth';
import {getFirestore,doc,collection,getDocFromServer,getDocs,query,orderBy,limit,startAfter,onSnapshot,setDoc,updateDoc,deleteDoc,serverTimestamp,runTransaction} from 'firebase/firestore';
import {firebaseConfig} from './firebase-config.js';
import {generateSecret,importSecret,encrypt,decrypt,messageContext} from './crypto.mjs';
import {sessionExpiry,dailySessionExpired} from './session.mjs';
import {KEY_CACHE_MARKER,KEY_REVOCATION_MARKER,rememberKey,loadRememberedKey,forgetRememberedKey,invalidateKeyOperations} from './key-vault.mjs';

const $ = selector => document.querySelector(selector);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const persistenceReady = setPersistence(auth,browserLocalPersistence).catch(() => setPersistence(auth,browserSessionPersistence));
const db = getFirestore(app);
const roomRef = doc(db,'rooms','ikimiz');
const messageCollection = collection(roomRef,'messages');
const statusCollection = collection(roomRef,'status');
let user = null, key = null, epoch = 0, unsubMessages, unsubStatus;
let data = new Map(), decoded = new Map(), statuses = [], oldest = null;
let replying = null, editing = null, sending = false, generated = false;
let typingLast = 0, seenLast = 0, lastMarkedMessage = 0, hiddenTimer, renderSequence = 0;
let unread = 0, loadingOlder = false, exhausted = false;
let sessionExpiresAt = null, dailyExpiryTimer, expiringSession = false;
let keyExpiryTimer, restoringKey = false;
const gate = $('#gate');
const input = $('#message');
const list = $('#messages');
const initialWelcome = list.firstElementChild.cloneNode(true);
const baseTitle = document.title;
gate.showModal();
gate.addEventListener('cancel', event => event.preventDefault());

function errorMessage(error) {
  const code = error?.code || '';
  if (code.includes('permission-denied')) return 'Bu hesaba erişim izni verilmemiş veya erişim ayarı henüz tamamlanmamış.';
  if (code.includes('unauthorized-domain')) return 'Bu sitenin adresi Google girişi için henüz yetkilendirilmemiş.';
  if (code.includes('popup-blocked')) return 'Tarayıcı giriş penceresini engelledi. Açılır pencereye izin verip tekrar dene.';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return 'Giriş tamamlanmadı. İstersen tekrar deneyebilirsin.';
  if (code.includes('resource-exhausted')) return 'Ücretsiz kullanım kotasına ulaşıldı. Daha sonra tekrar dene.';
  if (code.includes('unavailable') || code.includes('network')) return 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.';
  return 'İşlem tamamlanamadı. Bağlantını kontrol edip tekrar dene.';
}
function notice(text) { $('#notice').textContent = text; }
function allowCompose() {
  const locked = !key || !user || !navigator.onLine || sending;
  input.disabled = locked;
  $('#send').disabled = locked;
  $('#emoji').disabled = locked;
}
function updateConnection() {
  $('#offline').hidden = navigator.onLine;
  const other = statuses.find(status => status.id !== user?.uid);
  const writing = !!key && navigator.onLine && other?.typing && Date.now() - (other.typingAt?.toMillis() || 0) < 8000;
  $('#connection').textContent = !key ? 'Sohbet kilitli' : !navigator.onLine ? 'Bağlantı bekleniyor' : 'İçerik şifreli · Sadece ikiniz';
  $('#typing-indicator').hidden = !writing;
  allowCompose();
}
function cancelReply() {
  replying = null; editing = null;
  $('#reply-bar').hidden = true;
  $('#send').setAttribute('aria-label','Mesajı gönder');
}
function clearSession() {
  epoch++; renderSequence++;
  clearTimeout(keyExpiryTimer);
  unsubMessages?.(); unsubStatus?.();
  unsubMessages = null; unsubStatus = null;
  key = null; data.clear(); decoded.clear(); statuses = []; oldest = null;
  lastMarkedMessage = 0; seenLast = 0; typingLast = 0; exhausted = false;
  input.value = ''; $('#secret').value = ''; generated = false;
  $('#saved').checked = false; $('#saved-label').hidden = true;
  cancelReply(); $('#search').value = ''; $('#search-count').textContent = '';
  list.replaceChildren(initialWelcome.cloneNode(true));
  unread = 0; document.title = baseTitle;
  updateConnection();
}
function lock() {
  clearSession();
  $('#gate-error').textContent = '';
  if (!gate.open) gate.showModal();
}
async function logout() { void forgetRememberedKey(); lock(); try { await signOut(auth); } catch (error) { $('#gate-error').textContent = errorMessage(error); } }
async function quickExit() {
  $('#privacy').close();
  const deletion = forgetRememberedKey(); // Revokes restoration synchronously, before navigation.
  try { lock(); await Promise.race([deletion,new Promise(resolve => setTimeout(resolve,400))]); }
  finally { window.location.replace('https://www.youtube.com/'); }
}
function activateKey(candidate,expiresAt) {
  unsubMessages?.(); unsubStatus?.();
  key = candidate; $('#secret').value = ''; gate.close();
  generated = false; subscribe(); updateConnection();
  clearTimeout(keyExpiryTimer);
  keyExpiryTimer = setTimeout(() => {
    void forgetRememberedKey(); lock();
    $('#gate-error').textContent = 'Anahtarın 24 saatlik hatırlama süresi doldu. Kodu yeniden gir.';
  },Math.max(1,expiresAt-Date.now()));
}
async function restoreRememberedKey(roomSnapshot = null) {
  if (key || restoringKey || !user || !navigator.onLine || dailySessionExpired(sessionExpiresAt)) return false;
  const activeEpoch = epoch, uid = user.uid;
  restoringKey = true;
  try {
    const saved = await loadRememberedKey(uid,sessionExpiresAt);
    if (!saved || epoch !== activeEpoch) return false;
    const room = roomSnapshot || await getDocFromServer(roomRef);
    if (epoch !== activeEpoch || !room.exists()) return false;
    const proof = await decrypt(saved.key,room.data(),'ikimiz:v1:key-check');
    if (proof.purpose !== 'ikimiz-key-verification-v1' || epoch !== activeEpoch) return false;
    if (saved.expiresAt <= Date.now()) { void forgetRememberedKey(); return false; }
    activateKey(saved.key,saved.expiresAt);
    notice('');
    return true;
  } catch (error) {
    if (error.name === 'OperationError') void forgetRememberedKey();
    return false;
  } finally { restoringKey = false; }
}
function enforceDailySignIn() {
  if (!user || sessionExpiresAt === null || !dailySessionExpired(sessionExpiresAt) || expiringSession) return;
  expiringSession = true;
  void forgetRememberedKey();
  lock();
  signOut(auth).then(() => { $('#gate-error').textContent = '24 saatlik giriş süren doldu. Google hesabınla yeniden giriş yap.'; })
    .catch(() => { $('#gate-error').textContent = 'Giriş süren doldu. Yeniden giriş için bağlantını kontrol et.'; })
    .finally(() => { expiringSession = false; });
}
for (const button of document.querySelectorAll('.quick-exit')) button.addEventListener('click',quickExit);
$('#logout').addEventListener('click',logout);
$('#gate-logout').addEventListener('click',logout);
$('#lock').addEventListener('click',() => { void forgetRememberedKey(); lock(); });
$('#login').addEventListener('click', async () => {
  $('#login').disabled = true; $('#gate-error').textContent = '';
  try { const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account'}); await signInWithPopup(auth,provider); }
  catch (error) { $('#gate-error').textContent = errorMessage(error); }
  finally { $('#login').disabled = false; }
});
onAuthStateChanged(auth, async next => {
  clearSession(); user = next;
  clearTimeout(dailyExpiryTimer);
  sessionExpiresAt = null;
  $('#chat-title').textContent = 'İkimiz';
  $('#login-section').hidden = !!next;
  $('#key-section').hidden = !next;
  $('#gate-logout').hidden = !next;
  $('#gate-description').textContent = next ? `${next.email} · Ortak anahtarınızla devam edin.` : 'Günün en güzel kısmı, seninle konuşmak.';
  if (!gate.open) gate.showModal();
  if (!next) void forgetRememberedKey();
  if (next) {
    const activeEpoch = epoch;
    try {
      await persistenceReady;
      const token = await getIdTokenResult(next);
      if (epoch !== activeEpoch) return;
      sessionExpiresAt = sessionExpiry(token.authTime);
      if (dailySessionExpired(sessionExpiresAt)) { enforceDailySignIn(); return; }
      dailyExpiryTimer = setTimeout(enforceDailySignIn,Math.max(1,sessionExpiresAt-Date.now()));
      const room = await getDocFromServer(roomRef);
      if (epoch !== activeEpoch) return;
      // Presentation only. Server Security Rules still enforce the two-account allowlist.
      $('#chat-title').textContent = next.uid === 'GAjfo88iwkQT8SyhYpJopinnaqp1' ? 'Citirim' : 'Mottom';
      $('#generate').hidden = room.exists();
      if (room.exists()) await restoreRememberedKey(room);
    } catch (error) { if (epoch === activeEpoch) { $('#gate-error').textContent = errorMessage(error); $('#key-section').hidden = true; } }
  }
});
persistenceReady.then(() => { $('#login').disabled = false; }).catch(() => { $('#gate-error').textContent = 'Tarayıcı oturum saklamaya izin vermiyor. Normal bir tarayıcı sekmesinde yeniden dene.'; });

$('#generate').addEventListener('click', () => {
  $('#secret').value = generateSecret(); generated = true;
  $('#saved-label').hidden = false; $('#saved').checked = false;
  $('#gate-error').textContent = 'Yeni anahtar hazır. Güvenli bir yere kaydet ve kız arkadaşınla özel bir yoldan paylaş.';
});
$('#copy-key').addEventListener('click', async () => {
  if (!$('#secret').value) return;
  try { await navigator.clipboard.writeText($('#secret').value.trim()); $('#gate-error').textContent = 'Anahtar kopyalandı. Yalnızca kız arkadaşınla güvenilir bir yoldan paylaş.'; }
  catch { $('#gate-error').textContent = 'Kopyalanamadı. Anahtarı indir seçeneğini kullanabilirsin.'; }
});
$('#download-key').addEventListener('click', () => {
  if (!$('#secret').value) return;
  const url = URL.createObjectURL(new Blob([`İkimiz sohbet anahtarı — gizli tutun\n${$('#secret').value.trim()}\n`],{type:'text/plain;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'ikimiz-gizli-anahtar.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
$('#key-section').addEventListener('submit', async event => {
  event.preventDefault();
  if (!user || !navigator.onLine) { $('#gate-error').textContent = 'Sohbeti açmak için internete bağlan.'; return; }
  if (generated && !$('#saved').checked) { $('#gate-error').textContent = 'Önce anahtarı güvenle kaydettiğini onayla.'; return; }
  const activeEpoch = epoch;
  $('#unlock').disabled = true; $('#gate-error').textContent = '';
  try {
    const candidate = await importSecret($('#secret').value);
    const check = await encrypt(candidate,{purpose:'ikimiz-key-verification-v1'},'ikimiz:v1:key-check');
    const owner = user.uid;
    const stored = await runTransaction(db, async transaction => {
      const current = await transaction.get(roomRef);
      if (current.exists()) return current.data();
      if (!generated || !$('#saved').checked) throw new Error('first-setup');
      transaction.set(roomRef,{version:1,uid:owner,...check,createdAt:serverTimestamp()});
      return check;
    });
    const proof = await decrypt(candidate,stored,'ikimiz:v1:key-check');
    if (proof.purpose !== 'ikimiz-key-verification-v1') throw new Error('wrong-key');
    if (epoch !== activeEpoch) return;
    $('#secret').value = '';
    const expiresAt = Math.min(Date.now()+24*60*60*1000,sessionExpiresAt);
    const remembered = await rememberKey(candidate,owner,expiresAt);
    if (epoch !== activeEpoch) return;
    activateKey(candidate,expiresAt);
    notice(remembered ? '' : 'Bu tarayıcı anahtarı hatırlamaya izin vermedi; yeniden açtığında kodu girmen gerekecek.');
  } catch (error) {
    if (epoch === activeEpoch) $('#gate-error').textContent = error.message === 'first-setup' ? 'İlk kurulum için anahtar oluşturup güvenle kaydetmelisin.' : error.name === 'OperationError' || error.message === 'wrong-key' ? 'Bu anahtar sohbeti açamadı. İkiniz de ilk oluşturulan aynı anahtarı kullanmalısınız.' : error.message.startsWith('Anahtar') ? error.message : errorMessage(error);
  } finally { $('#unlock').disabled = false; }
});

function subscribe() {
  const activeEpoch = epoch;
  unsubMessages = onSnapshot(query(messageCollection,orderBy('createdAt','desc'),limit(50)),{includeMetadataChanges:true},snapshot => {
    if (activeEpoch !== epoch || !key) return;
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed') { data.delete(change.doc.id); decoded.delete(change.doc.id); }
      else {
        data.set(change.doc.id,{id:change.doc.id,...change.doc.data(),pending:change.doc.metadata.hasPendingWrites});
        if (change.type === 'added' && change.doc.data().uid !== user.uid && document.hidden && !snapshot.metadata.fromCache) unread++;
      }
    }
    if (!oldest || !data.has(oldest.id)) oldest = snapshot.docs.at(-1) || null;
    // Keep the tab neutral even when new messages arrive.
    document.title = baseTitle;
    render(); markSeen();
  },error => { if (activeEpoch === epoch) { lock(); $('#gate-error').textContent = errorMessage(error); } });
  unsubStatus = onSnapshot(statusCollection,snapshot => {
    if (activeEpoch !== epoch || !key) return;
    statuses = snapshot.docs.map(item => ({id:item.id,...item.data()}));
    updateConnection(); render();
  },error => { if (activeEpoch === epoch) notice(errorMessage(error)); });
  markSeen();
}
async function markSeen() {
  if (!key || !user || document.hidden || !navigator.onLine || Date.now()-seenLast < 4000) return;
  const newest = [...data.values()].filter(item => item.uid !== user.uid).reduce((max,item) => Math.max(max,item.createdAt?.toMillis() || 0),0);
  if (newest <= lastMarkedMessage) return;
  seenLast = Date.now();
  const activeEpoch = epoch;
  try { await setDoc(doc(statusCollection,user.uid),{uid:user.uid,seenAt:serverTimestamp(),typingAt:serverTimestamp(),typing:false}); if (activeEpoch === epoch) lastMarkedMessage = newest; } catch { /* Listener will report lost access. */ }
}
async function markTyping() {
  if (!key || !user || !navigator.onLine || Date.now()-typingLast < 4000) return;
  typingLast = Date.now();
  try { await setDoc(doc(statusCollection,user.uid),{uid:user.uid,seenAt:serverTimestamp(),typingAt:serverTimestamp(),typing:!!input.value.trim()}); } catch { /* Nonessential status. */ }
}
const date = value => value?.toDate?.() || new Date();
function button(label, action) { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click',action); return node; }
async function render() {
  const sequence = ++renderSequence, activeEpoch = epoch, activeKey = key;
  if (!activeKey || !user) return;
  const nearBottom = list.scrollHeight-list.scrollTop-list.clientHeight < 130;
  const term = $('#search').value.trim().toLocaleLowerCase('tr');
  const items = [...data.values()].sort((a,b) => date(a.createdAt)-date(b.createdAt) || a.id.localeCompare(b.id));
  const fragment = document.createDocumentFragment();
  if (!exhausted && oldest) fragment.append(button(loadingOlder ? 'Yükleniyor…' : 'Önceki mesajlar',loadOlder));
  if (!items.length) fragment.append(initialWelcome.cloneNode(true));
  let lastDay = '', matches = 0;
  const otherSeen = statuses.filter(s => s.id !== user.uid).reduce((max,s) => Math.max(max,s.seenAt?.toMillis() || 0),0);
  for (const item of items) {
    let value;
    const signature = item.iv + item.ciphertext;
    try {
      const cached = decoded.get(item.id);
      value = cached?.signature === signature ? cached.value : await decrypt(activeKey,item,messageContext(item.id,item.uid));
      if (typeof value.text !== 'string' || value.text.length > 4000 || (value.reply != null && (typeof value.reply !== 'string' || value.reply.length > 200))) throw new Error('invalid-message');
      if (activeEpoch !== epoch || sequence !== renderSequence) return;
      decoded.set(item.id,{signature,value});
    } catch { value = {text:'Bu mesaj çözülemedi veya içeriği doğrulanamadı.',invalid:true}; }
    if (term && !value.text.toLocaleLowerCase('tr').includes(term)) continue;
    matches++;
    const stamp = date(item.createdAt);
    const day = stamp.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
    if (day !== lastDay) { const divider = document.createElement('div'); divider.className = 'day'; const span = document.createElement('span'); span.textContent = day; divider.append(span); fragment.append(divider); lastDay = day; }
    const article = document.createElement('article'); article.className = `bubble ${item.uid === user.uid ? 'outgoing' : 'incoming'}`;
    if (value.reply) { const quote = document.createElement('blockquote'); quote.textContent = value.reply; article.append(quote); }
    const p = document.createElement('p'); p.textContent = value.text; article.append(p);
    const time = document.createElement('time'); time.dateTime = stamp.toISOString();
    const seen = item.uid === user.uid && item.createdAt && otherSeen >= item.createdAt.toMillis();
    time.textContent = `${stamp.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}${item.editedAt?.toMillis() > item.createdAt?.toMillis() ? ' · düzenlendi' : ''}${item.pending ? ' · gönderiliyor' : item.uid === user.uid ? seen ? ' · okundu' : ' · gönderildi' : ''}`;
    article.append(time);
    if (!value.invalid && !item.pending) {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      actions.append(button('Yanıtla', () => { replying = value.text.slice(0,200); editing = null; $('#reply-text').textContent = `Yanıt: ${replying}`; $('#reply-bar').hidden = false; input.focus(); }));
      if (item.uid === user.uid) {
        actions.append(button('Düzenle', () => { editing = item.id; replying = value.reply || null; input.value = value.text; $('#reply-text').textContent = 'Mesaj düzenleniyor'; $('#reply-bar').hidden = false; input.focus(); }));
        actions.append(button('Sil', async () => { if (!confirm('Bu mesaj ikinizin sohbetinden silinsin mi?')) return; try { await deleteDoc(doc(messageCollection,item.id)); data.delete(item.id); decoded.delete(item.id); render(); } catch (error) { notice(errorMessage(error)); } }));
      }
      article.append(actions);
    }
    fragment.append(article);
  }
  if (activeEpoch !== epoch || sequence !== renderSequence || !key) return;
  $('#search-count').textContent = term ? `${matches} sonuç` : '';
  list.replaceChildren(fragment);
  if (nearBottom && !term) list.scrollTop = list.scrollHeight;
}
async function loadOlder() {
  if (!oldest || !key || loadingOlder || exhausted) return;
  const activeEpoch = epoch;
  loadingOlder = true;
  try {
    const before = list.scrollHeight;
    const snapshot = await getDocs(query(messageCollection,orderBy('createdAt','desc'),startAfter(oldest),limit(50)));
    if (epoch !== activeEpoch) return;
    snapshot.forEach(item => data.set(item.id,{id:item.id,...item.data()}));
    oldest = snapshot.docs.at(-1) || oldest; exhausted = snapshot.size < 50;
    await render(); list.scrollTop += list.scrollHeight-before;
    notice('Önceki mesajlar yüklendi. Eski sayfalardaki değişiklikler yeniden açtığında güncellenir.');
  } catch (error) { notice(errorMessage(error)); }
  finally { loadingOlder = false; }
}
$('#composer').addEventListener('submit',async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || !key || !user || sending || !navigator.onLine) return;
  const activeEpoch = epoch, activeUser = user, activeKey = key;
  const editId = editing;
  sending = true; allowCompose(); notice('Şifrelenip gönderiliyor…');
  try {
    const reference = editId ? doc(messageCollection,editId) : doc(messageCollection);
    const box = await encrypt(activeKey,{text,reply:replying},messageContext(reference.id,activeUser.uid));
    if (epoch !== activeEpoch) return;
    if (editId) await updateDoc(reference,{...box,editedAt:serverTimestamp()});
    else await setDoc(reference,{uid:activeUser.uid,...box,createdAt:serverTimestamp(),editedAt:serverTimestamp()});
    if (epoch !== activeEpoch) return;
    input.value = ''; input.style.height = 'auto'; cancelReply(); notice('');
    list.scrollTop = list.scrollHeight;
    typingLast = 0; markTyping();
  } catch (error) { if (epoch === activeEpoch) notice(errorMessage(error)); }
  finally { sending = false; allowCompose(); if (key && !document.hidden) input.focus(); }
});
input.addEventListener('input',() => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight,120)}px`; markTyping(); });
input.addEventListener('keydown',event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat) $('#composer').requestSubmit();
});
$('#emoji').addEventListener('click',() => { if (!input.disabled && input.value.length <= 3998) { input.value += '🤍'; input.dispatchEvent(new Event('input')); input.focus(); } });
$('#cancel-reply').addEventListener('click',() => { if (editing) input.value = ''; cancelReply(); });
$('#search-toggle').addEventListener('click',() => { $('#search-bar').hidden = !$('#search-bar').hidden; if (!$('#search-bar').hidden) $('#search').focus(); else { $('#search').value = ''; render(); } });
$('#search').addEventListener('input',render);
$('#mobile-theme').addEventListener('click',() => document.body.classList.toggle('dark'));
$('#info').addEventListener('click',() => $('#privacy').showModal());
$('#close-privacy').addEventListener('click',() => $('#privacy').close());
window.addEventListener('online',updateConnection);
window.addEventListener('offline',updateConnection);
window.addEventListener('pagehide',clearSession);
window.addEventListener('pageshow',event => { if (event.persisted) { lock(); enforceDailySignIn(); void restoreRememberedKey(); } });
window.addEventListener('storage',event => {
  if (event.key === KEY_REVOCATION_MARKER) { invalidateKeyOperations(); lock(); return; }
  if (event.key !== KEY_CACHE_MARKER) return;
  let revoked = !event.newValue;
  try { revoked = revoked || JSON.parse(event.newValue).revoked === true; } catch { revoked = true; }
  if (revoked) { invalidateKeyOperations(); lock(); }
});
document.addEventListener('visibilitychange',() => {
  clearTimeout(hiddenTimer);
  if (document.hidden) hiddenTimer = setTimeout(lock,120000);
  else { unread = 0; document.title = baseTitle; enforceDailySignIn(); if (!key) void restoreRememberedKey(); markSeen(); }
});
setInterval(() => { enforceDailySignIn(); updateConnection(); if (key && !document.hidden) markSeen(); },15000);
setInterval(() => { if (!$('#typing-indicator').hidden) updateConnection(); },1000);
updateConnection();
