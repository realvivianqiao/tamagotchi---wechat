// Drives the real page code (app.js, pages/pick, pages/room) under a stand-in `wx` / App / Page, against a
// Boop server, with a fake Mac on the other end. Catches runtime errors and checks what the screens
// would show. Also checks every {{binding}} in the WXML points at data the page sets.
//
//   BOOP_SERVER=http://localhost:3999 node scripts/smoke-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(path.join(root, 'package.json'));
const WebSocket = require('ws');
const SERVER = (process.env.BOOP_SERVER || 'http://localhost:3999').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failures++; };
async function until(fn, what, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(40); }
  throw new Error(`timed out: ${what}`);
}

// ---------- WXML bindings vs page data ----------
function bindingsOf(wxml) {
  const names = new Set();
  for (const m of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
    const expr = m[1].replace(/'[^']*'/g, '');
    for (const id of expr.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) names.add(id[1]);
  }
  for (const k of ['item', 'index', 'true', 'false', 'null']) names.delete(k);
  return names;
}
for (const page of ['pick', 'room']) {
  const wxml = fs.readFileSync(path.join(root, 'pages', page, `${page}.wxml`), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages', page, `${page}.js`), 'utf8');
  const dataBlock = js.slice(js.indexOf('data: {'), js.indexOf('\n  },', js.indexOf('data: {')));
  const keys = new Set([...dataBlock.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
  const missing = [...bindingsOf(wxml)].filter((n) => !keys.has(n));
  check(!missing.length, `${page}.wxml bindings all in data${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
  // Tags balance (WXML is close enough to XML once wx: attributes are renamed).
  const stack = [];
  let bad = '';
  for (const m of wxml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z-]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , self] = m;
    if (self || ['image', 'input'].includes(tag) && !close) continue;
    if (!close) stack.push(tag);
    else if (stack.pop() !== tag) { bad = tag; break; }
  }
  check(!bad && !stack.length, `${page}.wxml tags balance${bad ? ' (at </' + bad + '>)' : stack.length ? ' (open: ' + stack.join(',') + ')' : ''}`);
}

// ---------- stand-in runtime ----------
const storage = new Map();
const ui = { toasts: [], modals: [], redirects: [], title: '' };
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
    return { onOpen: (f) => on('open', f), onMessage: (f) => on('message', f), onClose: (f) => on('close', f), onError: (f) => on('error', f), send: ({ data }) => ws.send(data), close: () => ws.close() };
  },
  showToast: (o) => ui.toasts.push(o.title),
  showModal: (o) => { ui.modals.push(o); o.success && o.success({ confirm: true, content: '' }); },
  showActionSheet: (o) => o.success && o.success({ tapIndex: 0 }),
  redirectTo: (o) => ui.redirects.push(o.url),
  setNavigationBarTitle: (o) => { ui.title = o.title; },
  showShareMenu: () => {},
  vibrateShort: () => {},
  requestSubscribeMessage: () => {},
};
let appDef = null;
const pages = {};
globalThis.App = (def) => { appDef = def; };
globalThis.getApp = () => appDef;
globalThis.Page = (def) => { pages.current = def; };

function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] = o[p] || {};
  o[parts[parts.length - 1]] = value;
}
function instantiate(file) {
  delete require.cache[require.resolve(file)];
  require(file);
  const def = pages.current;
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
  page.setData = function (patch) { for (const [k, v] of Object.entries(patch)) setPath(this.data, k, v); };
  return page;
}
const tap = (page, handler, dataset = {}) => page[handler]({ currentTarget: { dataset }, detail: {} });

const Online = require(path.join(root, 'utils', 'online.js'));
Online.server = SERVER;
require(path.join(root, 'app.js'));
appDef.onLaunch();

// ---------- a fake Mac ----------
const post = async (p, body) => (await fetch(SERVER + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const MAC = { deviceId: 'mac-smoke-' + Date.now(), name: 'Vivian' };
const hub = await post('/api/invite', { name: MAC.name, deviceId: MAC.deviceId, personal: true });
const inbox = [];
let mac = new WebSocket(SERVER.replace(/^http/, 'ws'));
mac.on('message', (d) => inbox.push(JSON.parse(String(d))));
await new Promise((r) => mac.on('open', r));
const macSend = (m) => mac.send(JSON.stringify(m));
macSend({ type: 'hello', deviceId: MAC.deviceId, name: MAC.name });

// ---------- pick: Mom opens Vivian's card ----------
const pick = instantiate(path.join(root, 'pages', 'pick', 'pick.js'));
pick.onLoad({ code: hub.code, from: encodeURIComponent('Vivian'), tz: '240' });
check(pick.data.inviter === 'Vivian', 'pick page: "Vivian邀请你养一只小宠物"');
tap(pick, 'onPick', { species: 'bird' });
check(pick.data.selectedName === '啾啾', 'picking the cockatiel offers "就选啾啾"');
pick.toName();
check(pick.data.step === 'name' && pick.data.petName === '啾啾', 'name step pre-fills 啾啾');
tap(pick, 'onNameChip', { name: '妈妈' });
await pick.finish();
check(ui.redirects.at(-1) === '/pages/room/room', 'finishing goes to the room');
check(Online.friends.length === 1 && Online.friends[0].city === 'ny', 'Vivian added, city New York from the card');
const shareEvt = pick.onShareAppMessage({ from: 'menu' });
check(shareEvt.path === '/pages/pick/pick', 'pick page has a plain share fallback');

const bond = await until(() => inbox.find((m) => m.type === 'bond'), 'bond on the Mac');
macSend({ type: 'attach', code: bond.code, name: MAC.name, deviceId: MAC.deviceId, species: 'dog', partnerName: '妈妈' });

// ---------- room ----------
appDef.onShow();
const room = instantiate(path.join(root, 'pages', 'room', 'room.js'));
room.onLoad();
room.onShow();
check(ui.title === '啾啾的家', 'title "啾啾的家"');
await until(() => room.data.friend && room.data.friend.online, 'Vivian online in the room');
check(room.data.friend.pill === '在线' && /^纽约 · /.test(room.data.friend.timeLine), `friend card: ${room.data.friend.timeLine} · ${room.data.friend.pill}`);
check(room.data.friend.species === 'dog', 'friend card shows Vivian’s dog');

room.onPetTap();
await sleep(60);
check(room.data.line && room.data.hearts, `tapping 啾啾: "${room.data.line}" + hearts`);

tap(room, 'onAction', { action: 'poke' });
check(room.data.sheet && room.data.sheet.title === '戳到啦！', 'poke opens "戳到啦！"');
check(/在线，马上就能看到/.test(room.data.sheet.body), `sheet says: ${room.data.sheet.body}`);
await until(() => inbox.find((m) => m.type === 'sync' && m.action === 'poke'), 'poke on the Mac');
await until(() => room.data.sheet.recent[0] && room.data.sheet.recent[0].pill === '送到了', 'receipt in the sheet');
check(true, 'sheet row turns "送到了"');
room.onSubscribe();
check(ui.modals.some((m) => m.title === '微信提醒'), 'reminder button explains itself until a template is set');

// Mac sends a hug: visit overlay.
macSend({ type: 'sync', code: bond.code, action: 'hug', fullness: 70, happiness: 90, species: 'dog' });
await until(() => room.data.visit, 'visit overlay');
check(room.data.visit.title === 'Vivian的小狗来串门了！', `visit: ${room.data.visit.title}`);
check(room.data.visit.line === 'Vivian让我来抱抱你！', `bubble: ${room.data.visit.line}`);
await sleep(1400);
check(/dog_happy/.test(room.data.visit.src) && room.data.visit.hearts, 'visitor walks in, then sits happy with hearts');
room.hugBack();
await until(() => inbox.filter((m) => m.type === 'sync' && m.action === 'hug').length, 'hug back on the Mac');
check(ui.toasts.includes('抱回去啦'), 'hug back sent');
await sleep(400);
check(!room.data.visit, 'visit closes');

// Mac sleeps; Mom pokes; the sheet says she'll see it later.
mac.close();
await until(() => !room.data.friend.online, 'Vivian offline');
room.lastSend = 0;
tap(room, 'onAction', { action: 'feed' });
check(room.data.sheet.title === '零食送到啦！', 'feed: "零食送到啦！"');
await until(() => room.data.sheet.recent[0].pill === '还没看到', 'queued status');
check(true, `offline sheet: ${room.data.sheet.body} · 还没看到`);
room.closeSheet();

// Vivian pokes three times while Mom's phone is closed; one summarised visit when she opens it.
appDef.onHide();
mac = new WebSocket(SERVER.replace(/^http/, 'ws'));
mac.on('message', (d) => inbox.push(JSON.parse(String(d))));
await new Promise((r) => mac.on('open', r));
macSend({ type: 'hello', deviceId: MAC.deviceId, name: MAC.name });
macSend({ type: 'attach', code: bond.code, name: MAC.name, deviceId: MAC.deviceId, species: 'dog', partnerName: '妈妈' });
await until(() => inbox.find((m) => m.type === 'sync' && m.action === 'feed' && m.queued), 'Mac gets the snack on wake');
for (const a of ['poke', 'poke', 'pet']) macSend({ type: 'sync', code: bond.code, action: a, fullness: 70, happiness: 90, species: 'dog' });
await sleep(300);
appDef.onShow();
await until(() => room.data.visit, 'summary visit');
await sleep(300);
check(room.data.visit.sub === '你不在的时候，来过 3 次', `summary: ${room.data.visit.sub}`);
room.closeVisit();
await sleep(400);
check(!room.data.visit, 'only one visit for the batch');

// Add-family sheet.
room.openAdd();
check(room.data.addOpen && room.data.shareCodeSpaced.length === 11, `add sheet shows my code ${room.data.shareCodeSpaced}`);
room.setData({ codeInput: Online.shareCode });
await room.addByCode();
check(ui.modals.at(-1).content.includes('自己的邀请码'), 'adding my own code is explained');
const share = room.onShareAppMessage();
check(share.title === '妈妈的啾啾想去你那儿串门' && share.path.includes(`code=${Online.shareCode}`), `share card: ${share.title}`);

room.onUnload();
appDef.onHide();
mac.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall good');
process.exit(failures ? 1 : 0);
