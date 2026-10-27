// Runs the mini program's online layer (utils/online.js) in Node against a Boop server, with a fake
// "Mac" on the other end speaking the desktop protocol. Checks: share code, claiming the Mac's code,
// live pokes, pokes held while the Mac sleeps, receipts, and visits waiting for the phone.
//
//   (in the desktop repo, with server-patch/offline-visits.patch applied, no Supabase env)
//   PORT=3999 MOCHI_DATA_DIR=$(mktemp -d) node index.js &
//   (here, after npm install)
//   BOOP_SERVER=http://localhost:3999 npm test
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const WebSocket = require('ws');
const SERVER = (process.env.BOOP_SERVER || 'http://localhost:3999').replace(/\/+$/, '');

// ---------- a minimal `wx` ----------
const storage = new Map();
globalThis.wx = {
  getStorageSync: (k) => (storage.has(k) ? JSON.parse(storage.get(k)) : ''),
  setStorageSync: (k, v) => storage.set(k, JSON.stringify(v)),
  request({ url, method, data, header, success, fail }) {
    fetch(url, { method, headers: header, body: method === 'GET' ? undefined : JSON.stringify(data) })
      .then(async (r) => success({ statusCode: r.status, data: await r.json().catch(() => ({})) }))
      .catch((e) => fail({ errMsg: String(e) }));
  },
  connectSocket({ url }) {
    const ws = new WebSocket(url);
    const on = (ev, fn) => ws.on(ev, (...a) => fn(ev === 'message' ? { data: String(a[0]) } : {}));
    return {
      onOpen: (fn) => on('open', fn), onMessage: (fn) => on('message', fn),
      onClose: (fn) => on('close', fn), onError: (fn) => on('error', fn),
      send: ({ data }) => ws.send(data), close: () => ws.close(),
    };
  },
};

const req = createRequire(import.meta.url);
const Online = req('../utils/online.js');
Online.server = SERVER;

// ---------- a fake Mac ----------
async function post(p, body) {
  const r = await fetch(SERVER + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function macSocket(onMsg) {
  const ws = new WebSocket(SERVER.replace(/^http/, 'ws'));
  ws.on('message', (d) => onMsg(JSON.parse(String(d))));
  return new Promise((res) => ws.on('open', () => res(ws)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}
let failures = 0;
function check(ok, label) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures++;
}

const MAC = { deviceId: 'mac-test-' + Date.now(), name: 'Vivian', species: 'frog' };
const macInbox = [];
let mac;
const macSend = (m) => mac.send(JSON.stringify(m));

// 1. The Mac has its usual permanent share code.
const macHub = await post('/api/invite', { name: MAC.name, deviceId: MAC.deviceId, personal: true });
check(/^[A-Z0-9]{6}$/.test(macHub.code || ''), `Mac share code ${macHub.code}`);
mac = await macSocket((m) => macInbox.push(m));
macSend({ type: 'hello', deviceId: MAC.deviceId, name: MAC.name });

// 2. Mom sets up on her phone and gets her own code.
Online.load();
Online.saveProfile({ name: '妈妈', species: 'bird', petName: '啾啾' });
const momCode = await Online.ensureShareCode();
check(/^[A-Z0-9]{6}$/.test(momCode) && momCode !== macHub.code, `phone share code ${momCode}`);

// 3. Mom opens Vivian's card (code + New York time zone, 240 = EDT).
const visits = [];
Online.on('visit', (v) => visits.push(v));
Online.connect();
const f = await Online.claim(macHub.code, 240);
check(f.partnerName === 'Vivian', 'claimed the Mac code; friend is "Vivian"');
check(f.city === 'ny', `city from the share card: ${f.city}`);
const bond = await until(() => macInbox.find((m) => m.type === 'bond'), 'bond on the Mac');
check(bond.partnerName === '妈妈' && bond.species === 'bird', 'Mac hears about 妈妈 and her cockatiel');
macSend({ type: 'attach', code: bond.code, name: MAC.name, deviceId: MAC.deviceId, species: MAC.species, partnerName: '妈妈' });
await until(() => Online.friend(bond.code)?.online, 'Vivian online on the phone');
check(Online.friend(bond.code).species === 'frog', 'phone learns Vivian’s pet is a frog');

// 4. Live poke: lands on the Mac, phone gets "live".
const live = Online.sendAction(bond.code, 'poke');
const got = await until(() => macInbox.find((m) => m.type === 'sync' && m.action === 'poke'), 'poke on the Mac');
check(got.from === '妈妈' && got.species === 'bird', 'Mac receives the poke from 妈妈’s bird');
await until(() => live.status === 'live', 'live receipt');
check(true, 'phone marks it 送到了 (live)');

// 5. Mac goes to sleep. A hug waits on the server, then plays when the Mac wakes.
mac.close();
await until(() => !Online.friend(bond.code).online, 'Vivian offline');
const held = Online.sendAction(bond.code, 'hug');
await until(() => held.status === 'queued', 'queued receipt');
check(true, 'hug held for the sleeping Mac (还没看到)');
macInbox.length = 0;
mac = await macSocket((m) => macInbox.push(m));
macSend({ type: 'hello', deviceId: MAC.deviceId, name: MAC.name });
macSend({ type: 'attach', code: bond.code, name: MAC.name, deviceId: MAC.deviceId, species: MAC.species, partnerName: '妈妈' });
const replay = await until(() => macInbox.find((m) => m.type === 'sync' && m.action === 'hug'), 'hug replayed on wake');
check(replay.queued === true && replay.from === '妈妈', 'Mac gets the hug when it wakes (queued)');
await until(() => held.status === 'delivered', 'delivered receipt');
check(true, 'phone flips it to 送到了 (delivered)');

// 6. Vivian pokes twice while the phone is closed; Mom sees them when she opens the mini program.
Online.suspend();
await sleep(200);
macSend({ type: 'sync', code: bond.code, action: 'poke', fullness: 70, happiness: 90, species: 'frog' });
macSend({ type: 'sync', code: bond.code, action: 'feed', fullness: 70, happiness: 90, species: 'frog' });
await sleep(200);
visits.length = 0;
const before = Online.profile.fullness;
Online.connect();
await until(() => visits.length >= 2, 'visits on the phone');
check(visits.every((v) => v.queued && v.missed === 2 && v.from === 'Vivian'), 'phone gets both visits, marked "while you were away" (missed: 2)');
check(Online.profile.fullness > before, 'the snack filled up 啾啾');

// 7. Live visit from the Mac while the phone is open.
visits.length = 0;
macSend({ type: 'sync', code: bond.code, action: 'hug', fullness: 70, happiness: 90, species: 'frog' });
await until(() => visits.length === 1, 'live visit');
check(!visits[0].queued && visits[0].action === 'hug', 'live hug from Vivian shows as a visit');

// 8. Wrong codes give a reason the UI can explain.
const reason = async (c) => Online.claim(c).then(() => 'ok', (e) => e.reason);
check((await reason('AB')) === 'format', 'short code → format');
check((await reason(momCode)) === 'own', 'own code → own');
check((await reason('ZZZZZZ')) === 'notfound', 'unknown code → notfound');

Online.suspend();
mac.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall good');
process.exit(failures ? 1 : 0);
