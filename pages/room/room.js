const Online = require('../../utils/online.js');
const P = require('../../utils/pets.js');
const clock = require('../../utils/clock.js');
const config = require('../../config.js');

// How a sent poke's status reads. "送到了" = it reached their screen, live or after they woke up.
const STATUS = {
  sending: ['发送中', ''],
  sent: ['已发送', ''],
  live: ['送到了', 'green'],
  queued: ['还没看到', ''],
  delivered: ['送到了', 'green'],
};
const ADD_ERRORS = {
  format: '邀请码是 6 位字母和数字，再看一下？',
  own: '这是你自己的邀请码，发给家人用就好。',
  notfound: '这个邀请码找不到了，请家人再发一次。',
  taken: '这个邀请码已经被用过了，请家人再发一次。',
  network: '网络不太好，稍后再试一次。',
};

function bars(v) {
  return [0, 1, 2, 3, 4].map((i) => v > i * 20 + 5);
}
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

Page({
  data: {
    me: null,
    petSrc: '',
    petClass: 'bob',
    line: '',
    hearts: false,
    fullBars: [],
    happyBars: [],
    friends: [],
    friend: null,
    activeCode: '',
    actions: P.ACTIONS,
    connected: false,
    sheet: null,
    visit: null,
    addOpen: false,
    shareCode: '',
    shareCodeSpaced: '',
    codeInput: '',
    adding: false,
  },

  onLoad() {
    if (!Online.ready) {
      wx.redirectTo({ url: '/pages/pick/pick' });
      return;
    }
    wx.showShareMenu({ menus: ['shareAppMessage'] });
    this.frame = this.idleFrame();
    this.activeCode = (Online.friends[0] || {}).code || '';
    this.visitQueue = [];
    this.offs = [
      Online.on('friends', () => this.render()),
      Online.on('profile', () => this.render()),
      Online.on('log', () => this.refreshSheet(false)),
      Online.on('connection', (on) => this.setData({ connected: on })),
      Online.on('visit', (v) => this.onVisit(v)),
      Online.on('bond', (f) => {
        if (!this.activeCode) this.activeCode = f.code;
        wx.showToast({ title: `${f.partnerName}加入了`, icon: 'none' });
      }),
    ];
    this.render();
    if (!Online.shareCode) Online.ensureShareCode().then(() => this.render()).catch(() => {});
    Online.connect();
  },
  onShow() {
    this.startTimers();
    this.setFrame(this.idleFrame());
    this.render();
  },
  onHide() {
    this.stopTimers();
  },
  onUnload() {
    this.stopTimers();
    (this.offs || []).forEach((off) => off());
  },

  // ---------- drawing ----------
  render() {
    const me = Online.profile;
    if (!me) return;
    const friends = Online.friends.map((f) => this.decorate(f));
    if (!friends.some((f) => f.code === this.activeCode)) this.activeCode = friends.length ? friends[0].code : '';
    this.setData({
      me: { name: me.name, petName: me.petName, species: me.species },
      petSrc: P.sprite(me.species, this.frame || 'sit'),
      fullBars: bars(me.fullness),
      happyBars: bars(me.happiness),
      friends,
      friend: friends.find((f) => f.code === this.activeCode) || null,
      activeCode: this.activeCode,
      connected: Online.connected,
      shareCode: Online.shareCode,
      shareCodeSpaced: (Online.shareCode || '').split('').join(' '),
    });
    if (this.title !== me.petName) {
      this.title = me.petName;
      wx.setNavigationBarTitle({ title: `${me.petName}的家` });
    }
  },
  /** A family member as the card shows them: city time, and whether they're on, busy or asleep. */
  decorate(f) {
    const place = f.city ? clock.describe(f.city) : null;
    const night = !!(place && place.night);
    let pill = '不在线', pillClass = '';
    if (f.online && f.dnd) { pill = '在忙'; pillClass = 'yellow'; }
    else if (f.online) { pill = '在线'; pillClass = 'green'; }
    else if (night) { pill = '在睡觉'; pillClass = 'night'; }
    return Object.assign({}, f, {
      kind: P.pet(f.species).kind,
      avatar: P.sprite(f.species, !f.online && night ? 'sleep' : 'sit'),
      timeLine: place ? `${place.city} · ${place.time}` : '点这里设置 TA 在哪个城市',
      place,
      night,
      pill,
      pillClass,
    });
  },

  // ---------- your own pet ----------
  idleFrame() {
    const me = Online.profile;
    const h = new Date().getHours();
    if (h >= 23 || h < 6) return 'sleep';
    if (me && me.fullness < 30) return 'sad';
    return 'sit';
  },
  setFrame(frame) {
    this.frame = frame;
    if (Online.profile) this.setData({ petSrc: P.sprite(Online.profile.species, frame) });
  },
  react(frame, ms) {
    this.setFrame(frame);
    clearTimeout(this.reactTimer);
    this.reactTimer = setTimeout(() => this.setFrame(this.idleFrame()), ms);
  },
  say(text, ms = 2600) {
    this.setData({ line: text });
    clearTimeout(this.lineTimer);
    this.lineTimer = setTimeout(() => this.setData({ line: '' }), ms);
  },
  burstHearts() {
    this.setData({ hearts: false });
    setTimeout(() => this.setData({ hearts: true }), 16);
    clearTimeout(this.heartTimer);
    this.heartTimer = setTimeout(() => this.setData({ hearts: false }), 1400);
  },
  startTimers() {
    this.stopTimers();
    this.blinkTimer = setInterval(() => {
      if (this.frame !== 'sit') return;
      this.setFrame('blink');
      setTimeout(() => { if (this.frame === 'blink') this.setFrame('sit'); }, 180);
    }, 3700);
    this.clockTimer = setInterval(() => {
      this.render();
      if (this.data.sheet) this.refreshSheet(false);
    }, 30000);
  },
  stopTimers() {
    clearInterval(this.blinkTimer);
    clearInterval(this.clockTimer);
  },
  onPetTap() {
    const me = Online.profile;
    Online.bumpStats(0, 3);
    this.react('happy', 1600);
    this.say(pick(P.TAP_LINES[me.species] || P.TAP_LINES.dog));
    this.burstHearts();
    this.setData({ petClass: 'hop' });
    setTimeout(() => this.setData({ petClass: 'bob' }), 700);
  },
  onFeedSelf() {
    const full = Online.profile.fullness >= 95;
    if (!full) Online.bumpStats(20, 3);
    this.react('happy', 1400);
    this.say(full ? '吃不下啦' : '好吃！');
  },
  renamePet() {
    const me = Online.profile;
    wx.showModal({
      title: '给它改个名字',
      editable: true,
      placeholderText: me.petName,
      success: (r) => {
        const name = r.confirm && String(r.content || '').trim().slice(0, 8);
        if (name) Online.saveProfile({ petName: name });
      },
    });
  },

  // ---------- sending ----------
  onAction(e) {
    const action = e.currentTarget.dataset.action;
    const f = Online.friend(this.activeCode);
    if (!f) {
      this.openAdd();
      return;
    }
    const now = Date.now();
    if (now - (this.lastSend || 0) < 1200) return; // no machine-gun pokes
    this.lastSend = now;
    Online.sendAction(f.code, action);
    this.sheetFor = { code: f.code, action };
    this.refreshSheet(true);
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
  },
  refreshSheet(open) {
    if (!this.sheetFor || (!open && !this.data.sheet)) return;
    const { code, action } = this.sheetFor;
    const f = Online.friend(code);
    if (!f) return;
    const d = this.decorate(f);
    const def = P.ACTIONS.find((a) => a.action === action) || P.ACTIONS[0];
    let body;
    if (f.online && f.dnd) body = `${f.partnerName}在忙，忙完就能看到。`;
    else if (f.online) body = `${f.partnerName}在线，马上就能看到。`;
    else if (d.night) body = `${d.place.city}现在是${d.place.time}，${f.partnerName}应该在睡觉。醒来第一眼就会看到。`;
    else body = `${f.partnerName}现在不在线，上线就会看到。`;
    const recent = Online.log.filter((x) => x.code === code).slice(-3).reverse().map((x) => this.logRow(x, f));
    this.setData({
      sheet: {
        title: def.done, body, name: f.partnerName, night: d.night,
        place: d.place ? `${d.place.city} · ${d.place.time}` : '',
        petSrc: P.sprite(f.species, d.night && !f.online ? 'sleep' : 'happy'),
        recent,
      },
    });
  },
  logRow(x, f) {
    const me = Online.profile;
    const when = clock.stamp(x.at);
    if (x.dir === 'in') {
      return { id: x.id, text: P.fill(P.IN_LOG[x.action], { name: x.from || f.partnerName, pet: me.petName }), when, pill: '收到', pillClass: 'purple' };
    }
    const [pill, pillClass] = STATUS[x.status] || STATUS.sent;
    return { id: x.id, text: P.OUT_LOG[x.action] || '你打了个招呼', when, pill, pillClass };
  },
  closeSheet() {
    this.sheetFor = null;
    this.setData({ sheet: null });
  },
  onSubscribe() {
    const id = config.SUBSCRIBE_TEMPLATE_ID;
    if (id) {
      wx.requestSubscribeMessage({
        tmplIds: [id],
        success: (r) => { if (r[id] === 'accept') wx.showToast({ title: '好的，到时提醒你', icon: 'none' }); },
      });
    } else {
      wx.showModal({
        title: '微信提醒',
        content: '正式上线以后，家人回应你时会在微信里提醒你。现在打开小程序就能看到。',
        showCancel: false,
      });
    }
    this.closeSheet();
  },
  noop() {},

  // ---------- visits ----------
  onVisit(v) {
    // Coming back after a while replays a few at once: show one visit that says how many.
    const showing = this.showing;
    if (v.queued && showing && showing.queued && showing.code === v.code) {
      showing.missed = Math.max(showing.missed, v.missed);
      this.paintVisit(false);
      return;
    }
    const last = this.visitQueue[this.visitQueue.length - 1];
    if (v.queued && last && last.queued && last.code === v.code) {
      Object.assign(last, { missed: Math.max(last.missed, v.missed), action: v.action, at: v.at });
    } else {
      this.visitQueue.push(Object.assign({}, v));
    }
    if (!this.showing) this.nextVisit();
  },
  nextVisit() {
    const v = this.visitQueue.shift();
    this.showing = v || null;
    if (!v) {
      this.setData({ visit: null });
      return;
    }
    this.setData({ sheet: null });
    this.sheetFor = null;
    this.paintVisit(true);
    if (v.action === 'poke') {
      this.react('angry', 900);
      setTimeout(() => this.react('happy', 1600), 900);
    } else this.react('happy', 2400);
    let step = 0;
    clearInterval(this.walkTimer);
    this.walkTimer = setInterval(() => {
      step += 1;
      if (step > 7) {
        clearInterval(this.walkTimer);
        this.setData({ 'visit.src': P.sprite(v.species, 'happy'), 'visit.hearts': true });
        return;
      }
      this.setData({ 'visit.src': P.sprite(v.species, step % 2 ? 'walk1' : 'walk0') });
    }, 150);
  },
  paintVisit(fresh) {
    const v = this.showing;
    const f = Online.friend(v.code) || { partnerName: v.from, species: v.species };
    const d = this.decorate(f);
    const me = Online.profile;
    let sub;
    if (v.queued) sub = v.missed > 1 ? `你不在的时候，来过 ${v.missed} 次` : `你不在的时候来过 · ${clock.stamp(v.at)}`;
    else sub = d.place ? `${d.place.city} · ${d.place.time}` : '刚刚';
    this.setData({
      visit: {
        title: `${v.from}的${P.pet(v.species).kind}来串门了！`,
        sub,
        line: P.fill(P.VISIT_LINES[v.action] || P.VISIT_LINES.poke, { name: v.from, pet: me.petName }),
        src: fresh ? P.sprite(v.species, 'walk0') : this.data.visit.src,
        hostSrc: P.sprite(me.species, 'happy'),
        hearts: fresh ? false : this.data.visit.hearts,
      },
    });
  },
  hugBack() { this.reply('hug'); },
  pokeBack() { this.reply('poke'); },
  reply(action) {
    const code = this.showing && this.showing.code;
    this.closeVisit();
    if (!code) return;
    this.activeCode = code;
    this.render();
    Online.sendAction(code, action);
    wx.showToast({ title: action === 'hug' ? '抱回去啦' : '戳回去啦', icon: 'none' });
  },
  closeVisit() {
    clearInterval(this.walkTimer);
    this.showing = null;
    this.setData({ visit: null });
    setTimeout(() => { if (!this.showing) this.nextVisit(); }, 300);
  },

  // ---------- family ----------
  onChip(e) {
    this.activeCode = e.currentTarget.dataset.code;
    this.render();
  },
  onFriendTap() {
    const f = this.data.friend;
    if (!f) return;
    wx.showActionSheet({
      alertText: `${f.partnerName}在哪个城市？`,
      itemList: clock.CITIES.map((c) => c.name),
      success: (r) => Online.setCity(f.code, clock.CITIES[r.tapIndex].id),
    });
  },
  openAdd() {
    this.setData({ addOpen: true, codeInput: '' });
    if (!Online.shareCode) {
      Online.ensureShareCode().then(() => this.render()).catch(() => wx.showToast({ title: '网络不太好，稍后再试', icon: 'none' }));
    }
  },
  closeAdd() {
    this.setData({ addOpen: false });
  },
  onCodeInput(e) {
    this.setData({ codeInput: Online.cleanCode(e.detail.value) });
  },
  async addByCode() {
    if (this.data.adding) return;
    this.setData({ adding: true });
    try {
      const f = await Online.claim(this.data.codeInput);
      this.activeCode = f.code;
      this.setData({ addOpen: false });
      wx.showToast({ title: `加上${f.partnerName}了`, icon: 'success' });
      this.render();
    } catch (e) {
      wx.showModal({ title: '没加上', content: ADD_ERRORS[e.reason] || ADD_ERRORS.network, showCancel: false });
    }
    this.setData({ adding: false });
  },

  onShareAppMessage() {
    const me = Online.profile;
    const code = Online.shareCode ? `code=${Online.shareCode}&` : '';
    return {
      title: `${me.name}的${me.petName}想去你那儿串门`,
      path: `/pages/pick/pick?${code}from=${encodeURIComponent(me.name)}&tz=${new Date().getTimezoneOffset()}`,
      imageUrl: `/images/share/${me.species}.png`,
    };
  },
});
