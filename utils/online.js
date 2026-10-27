// Boop's online layer for the WeChat mini program: a port of windows/app/online.js onto wx.request and
// wx.connectSocket. Same server, same messages, so a phone pet and a Mac/Windows pet are friends like
// any two pets. Kept to what a phone needs: one share code, family members, sending and receiving visits.
const config = require('../config.js');
const { cityFromOffset } = require('./clock.js');

const ACTIONS_IN = ['poke', 'pet', 'feed', 'hug', 'play'];
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

const store = {
  get(k, d) {
    try {
      const v = wx.getStorageSync(k);
      return v === '' || v === undefined || v === null ? d : v;
    } catch (e) { return d; }
  },
  set(k, v) {
    try { wx.setStorageSync(k, v); } catch (e) { /* storage full: keep going in memory */ }
  },
};

function rid(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return s;
}
function cleanCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

const Online = {
  server: config.SERVER,
  deviceId: '',
  profile: null, // { name, species, petName, fullness, happiness, statsAt }
  shareCode: '',
  friends: [], // { code, partnerName, species, online, dnd, city }
  log: [], // { id, dir: 'out'|'in', code, action, at, status?, from? }
  connected: false,

  _task: null, _open: false, _queue: [], _keepAlive: null, _retryTimer: null, _retry: 0,
  _foreground: true, _listeners: {},

  // ---------- state ----------
  load() {
    this.deviceId = store.get('boop.deviceId', '');
    if (!this.deviceId) {
      this.deviceId = 'wx-' + rid(32);
      store.set('boop.deviceId', this.deviceId);
    }
    this.profile = store.get('boop.profile', null);
    this.shareCode = store.get('boop.shareCode', '');
    this.friends = store.get('boop.friends', []);
    this.log = store.get('boop.log', []);
    this.decayStats();
  },
  get ready() {
    return !!(this.profile && this.profile.name && this.profile.species);
  },
  saveProfile(p) {
    this.profile = Object.assign({ fullness: 80, happiness: 80, statsAt: Date.now() }, this.profile || {}, p);
    store.set('boop.profile', this.profile);
    this.emit('profile', this.profile);
  },
  saveFriends() {
    store.set('boop.friends', this.friends);
    this.emit('friends', this.friends);
  },
  saveLog() {
    this.log = this.log.slice(-60);
    store.set('boop.log', this.log);
    this.emit('log', this.log);
  },
  friend(code) {
    return this.friends.find((f) => f.code === code) || null;
  },

  /** Hunger and happiness drift down while the app is closed, like on the desktop. */
  decayStats(now = Date.now()) {
    if (!this.profile) return;
    const hours = Math.max(0, (now - (this.profile.statsAt || now)) / 3600000);
    if (hours < 0.05) return;
    this.profile.fullness = clamp(this.profile.fullness - hours * 3);
    this.profile.happiness = clamp(this.profile.happiness - hours * 2);
    this.profile.statsAt = now;
    store.set('boop.profile', this.profile);
  },
  bumpStats(fullness, happiness) {
    this.decayStats();
    this.profile.fullness = clamp(this.profile.fullness + (fullness || 0));
    this.profile.happiness = clamp(this.profile.happiness + (happiness || 0));
    this.profile.statsAt = Date.now();
    store.set('boop.profile', this.profile);
    this.emit('profile', this.profile);
  },

  // ---------- events ----------
  on(evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    return () => this.off(evt, fn);
  },
  off(evt, fn) {
    const l = this._listeners[evt];
    if (l) this._listeners[evt] = l.filter((f) => f !== fn);
  },
  emit(evt, data) {
    for (const fn of (this._listeners[evt] || []).slice()) {
      try { fn(data); } catch (e) { console.error('[boop]', evt, e); }
    }
  },

  // ---------- HTTP ----------
  request(method, path, data) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.server + path,
        method,
        data,
        header: { 'content-type': 'application/json' },
        timeout: 60000,
        success: (res) => {
          const body = res.data && typeof res.data === 'object' ? res.data : {};
          if (res.statusCode >= 400) {
            const err = new Error(body.error || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.body = body;
            reject(err);
          } else resolve(body);
        },
        fail: (e) => reject(new Error((e && e.errMsg) || 'network error')),
      });
    });
  },

  /** This phone's permanent invite code: what share cards carry. Also picks up bonds made while away. */
  async ensureShareCode() {
    const p = this.profile;
    const res = await this.request('POST', '/api/invite', {
      name: p.name, deviceId: this.deviceId, personal: true, species: p.species, padName: p.petName,
      fullness: p.fullness, happiness: p.happiness, code: this.shareCode || undefined,
    });
    if (res.code) {
      this.shareCode = res.code;
      store.set('boop.shareCode', res.code);
    }
    for (const b of res.pendingBonds || []) this.applyBond(b);
    return this.shareCode;
  },

  /**
   * Add a family member by their code (from a share card or typed in). `tz` is the sharer's
   * getTimezoneOffset() when it came from a card, so their city is filled in for you.
   * Rejects with err.reason: 'format' | 'own' | 'notfound' | 'taken' | 'network'.
   */
  async claim(rawCode, tz) {
    const code = cleanCode(rawCode);
    if (!CODE_RE.test(code)) throw Object.assign(new Error('bad code'), { reason: 'format' });
    if (code === this.shareCode) throw Object.assign(new Error('own code'), { reason: 'own' });
    const p = this.profile;
    let res;
    try {
      res = await this.request('POST', '/api/claim', {
        code, name: p.name, deviceId: this.deviceId, species: p.species, fullness: p.fullness, happiness: p.happiness,
      });
    } catch (e) {
      const t = (e.body && e.body.error) || e.message || '';
      e.reason = /own invite/.test(t) ? 'own' : /not found/.test(t) ? 'notfound' : /already bonded/.test(t) ? 'taken' : 'network';
      throw e;
    }
    const pair = res.code;
    let f = this.friend(pair);
    if (!f) {
      f = { code: pair, partnerName: res.hostName || '家人', species: 'dog', online: false, dnd: false, city: null };
      this.friends.push(f);
    } else if (res.hostName) f.partnerName = res.hostName;
    if (tz !== undefined && tz !== null && tz !== '' && !Number.isNaN(Number(tz))) f.city = cityFromOffset(Number(tz)) || f.city;
    this.saveFriends();
    this.attach(pair);
    return f;
  },

  setCity(code, cityId) {
    const f = this.friend(code);
    if (!f) return;
    f.city = cityId;
    this.saveFriends();
  },

  /** Someone claimed this phone's share code (live, or queued while the phone was closed). */
  applyBond(b) {
    if (!b || !b.code) return;
    let f = this.friend(b.code);
    if (!f) {
      f = { code: b.code, partnerName: b.partnerName || '家人', species: b.species || 'dog', online: false, dnd: false, city: null };
      this.friends.push(f);
      this.emit('bond', f);
    } else {
      if (b.partnerName) f.partnerName = b.partnerName;
      if (b.species) f.species = b.species;
    }
    this.saveFriends();
    this.attach(b.code);
  },

  /** After a server wipe: recreate the bond from what this phone remembers, then rejoin. */
  async heal(code) {
    const f = this.friend(code);
    if (!f) return;
    try {
      await this.request('POST', '/api/restore', {
        name: this.profile.name, deviceId: this.deviceId, code, partnerName: f.partnerName,
        fullness: this.profile.fullness, happiness: this.profile.happiness,
      });
    } catch (e) { /* try the room anyway */ }
    this.attach(code);
  },

  // ---------- WebSocket ----------
  connect() {
    if (!this.ready) return;
    this._foreground = true;
    clearTimeout(this._retryTimer);
    if (this._task) {
      if (this._open) this.helloAndAttachAll();
      return; // still connecting: onOpen says hello
    }
    let task;
    try {
      task = wx.connectSocket({ url: this.server.replace(/^http/, 'ws'), timeout: 20000 });
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this._task = task;
    this._open = false;
    task.onOpen(() => {
      if (this._task !== task) return;
      this._open = true;
      this._retry = 0;
      this.setConnected(true);
      this.helloAndAttachAll(); // attach first, so queued actions land in joined rooms
      const q = this._queue;
      this._queue = [];
      for (const m of q) this.send(m);
      this.startKeepAlive();
    });
    task.onMessage((ev) => {
      if (this._task === task) this.handle(String(ev.data));
    });
    const down = () => {
      if (this._task !== task) return;
      this._task = null;
      this._open = false;
      this.stopKeepAlive();
      this.setConnected(false);
      for (const f of this.friends) f.online = false;
      this.emit('friends', this.friends);
      if (this._foreground) this.scheduleReconnect();
    };
    task.onClose(down);
    task.onError(down);
  },
  /** App went to the background: WeChat will freeze us soon anyway, so close cleanly. */
  suspend() {
    this._foreground = false;
    clearTimeout(this._retryTimer);
    this.stopKeepAlive();
    const t = this._task;
    this._task = null;
    this._open = false;
    this.setConnected(false);
    if (t) {
      try { t.close({}); } catch (e) { /* already closed */ }
    }
  },
  scheduleReconnect() {
    clearTimeout(this._retryTimer);
    const wait = Math.min(30000, 1000 * Math.pow(2, this._retry++));
    this._retryTimer = setTimeout(() => this.connect(), wait);
  },
  startKeepAlive() {
    this.stopKeepAlive();
    // Same rhythm as the desktop apps: ping, say hello and re-attach every 20s.
    this._keepAlive = setInterval(() => {
      this.send({ type: 'ping' });
      this.helloAndAttachAll();
    }, 20000);
  },
  stopKeepAlive() {
    clearInterval(this._keepAlive);
    this._keepAlive = null;
  },
  setConnected(on) {
    if (this.connected === on) return;
    this.connected = on;
    this.emit('connection', on);
  },
  helloAndAttachAll() {
    this.send({ type: 'hello', deviceId: this.deviceId, name: this.profile.name });
    for (const f of this.friends) this.attachNow(f.code);
  },
  attach(code) {
    if (this._open) this.attachNow(code);
    else this.connect();
  },
  attachNow(code) {
    const p = this.profile;
    const f = this.friend(code);
    const msg = {
      type: 'attach', code, name: p.name, deviceId: this.deviceId, species: p.species, outfit: '', dnd: false,
      fullness: p.fullness, happiness: p.happiness,
    };
    if (f && f.partnerName) msg.partnerName = f.partnerName;
    this.send(msg);
  },
  send(msg) {
    if (this._task && this._open) {
      this._task.send({ data: JSON.stringify(msg) });
      return true;
    }
    // hello/attach/ping are re-sent on open anyway; keep only what the person actually did.
    if (msg.type === 'sync') {
      this._queue.push(msg);
      if (this._queue.length > 50) this._queue.splice(0, this._queue.length - 50);
    }
    if (!this._task) this.connect();
    return false;
  },

  /** Send a poke / pat / snack / hug to a family member. Returns the log entry (its status updates). */
  sendAction(code, action) {
    const id = 'a' + Date.now().toString(36) + rid(4);
    const entry = { id, dir: 'out', code, action, at: Date.now(), status: 'sending' };
    this.log.push(entry);
    this.saveLog();
    const p = this.profile;
    this.send({
      type: 'sync', code, action, id, fullness: p.fullness, happiness: p.happiness, species: p.species,
      outfit: '', dnd: false, updatedAt: Date.now(),
    });
    // A server without receipts never answers: after a moment just call it sent.
    setTimeout(() => {
      const e = this.log.find((x) => x.id === id);
      if (e && e.status === 'sending') {
        e.status = 'sent';
        this.saveLog();
      }
    }, 5000);
    return entry;
  },

  // ---------- incoming ----------
  handle(text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'room':
      case 'presence': this.applyRoom(m); break;
      case 'bond': this.applyBond(m); break;
      case 'rename': {
        const f = this.friend(m.code);
        if (f && m.name) {
          f.partnerName = String(m.name);
          this.saveFriends();
        }
        break;
      }
      case 'sync': this.applySync(m); break;
      case 'ack': this.applyAck(m); break;
      case 'error':
        if (/room not found/.test(m.text || '') && m.code) this.heal(m.code);
        this.emit('server-error', m);
        break;
      default: break;
    }
  },
  applyRoom(m) {
    const f = this.friend(m.code);
    if (!f) return;
    f.online = typeof m.partnerOnline === 'boolean' ? m.partnerOnline : !!m.partner;
    if (m.partner && m.partner !== this.profile.name) f.partnerName = m.partner;
    if (typeof m.partnerSpecies === 'string' && m.partnerSpecies) f.species = m.partnerSpecies;
    if (typeof m.partnerDnd === 'boolean') f.dnd = m.partnerDnd;
    this.saveFriends();
  },
  applySync(m) {
    if (m.from && m.from === this.profile.name) return; // our own echo
    const f = this.friend(m.code);
    if (!f) return;
    if (typeof m.species === 'string' && m.species) f.species = m.species;
    if (typeof m.dnd === 'boolean') f.dnd = m.dnd;
    this.saveFriends();
    const action = typeof m.action === 'string' ? m.action.trim().toLowerCase() : '';
    if (!ACTIONS_IN.includes(action)) return; // stats-only update
    const at = Number(m.at) || Date.now();
    const from = m.from || f.partnerName;
    this.log.push({ id: 'i' + at.toString(36) + rid(4), dir: 'in', code: f.code, action, at, from });
    this.saveLog();
    const effect = { poke: [0, 2], pet: [0, 6], feed: [15, 4], hug: [0, 10], play: [-3, 8] }[action];
    this.bumpStats(effect[0], effect[1]);
    this.emit('visit', {
      code: f.code, action, from, species: f.species, queued: !!m.queued, missed: Number(m.missed) || 1, at,
    });
  },
  applyAck(m) {
    const e = this.log.find((x) => x.id === m.id);
    if (!e || !['live', 'queued', 'delivered'].includes(m.status)) return;
    if (e.status === 'delivered' || (e.status === 'live' && m.status === 'queued')) return;
    e.status = m.status;
    this.saveLog();
  },
};

Online.cleanCode = cleanCode;
Online.isCode = (c) => CODE_RE.test(cleanCode(c));
module.exports = Online;
