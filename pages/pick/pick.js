const Online = require('../../utils/online.js');
const { PETS, ORDER, pet, sprite } = require('../../utils/pets.js');

const NAME_CHOICES = ['妈妈', '爸爸', '奶奶', '爷爷', '外婆', '外公'];
const CLAIM_ERRORS = {
  format: '邀请码是 6 位字母和数字，再看一下？',
  notfound: '这个邀请码找不到了，请家人再发一次。',
  taken: '这个邀请码已经被用过了，请家人再发一次。',
  network: '网络不太好，进去以后可以再加一次家人。',
};

Page({
  data: {
    step: 'pet', // 'pet' → 'name'
    pets: ORDER.map((sp) => Object.assign({ species: sp, src: sprite(sp, 'sit') }, PETS[sp])),
    selected: '',
    selectedName: '',
    selectedKind: '',
    inviter: '',
    hasInvite: false,
    nameChoices: NAME_CHOICES,
    myName: '',
    petName: '',
    codeInput: '',
    busy: false,
    helper: false,
    deskCode: '',
    deskName: '',
    deskReady: false,
  },

  onLoad(query) {
    // Share cards open this page with ?code=…&from=…&tz=… ; QR codes put the code in `scene`.
    const raw = query.code || (query.scene ? decodeURIComponent(query.scene) : '');
    const code = Online.cleanCode(raw);
    this.invite = code ? { code, tz: query.tz, from: query.from ? decodeURIComponent(query.from) : '' } : null;
    if (Online.ready) {
      // Already have a pet: a new card just adds that family member.
      if (this.invite) this.finish();
      else wx.redirectTo({ url: '/pages/room/room' });
      return;
    }
    this.setData({ inviter: this.invite ? this.invite.from : '', hasInvite: !!this.invite });
  },

  onPick(e) {
    const sp = e.currentTarget.dataset.species;
    this.setData({ selected: sp, selectedName: pet(sp).name, selectedKind: pet(sp).kind });
  },
  toName() {
    if (!this.data.selected) return;
    this.setData({ step: 'name', petName: this.data.petName || pet(this.data.selected).name });
  },
  backToPet() {
    this.setData({ step: 'pet' });
  },
  onNameChip(e) {
    this.setData({ myName: e.currentTarget.dataset.name });
  },
  onNameInput(e) {
    this.setData({ myName: e.detail.value });
  },
  onPetNameInput(e) {
    this.setData({ petName: e.detail.value });
  },
  onCodeInput(e) {
    this.setData({ codeInput: Online.cleanCode(e.detail.value) });
  },

  async finish() {
    if (this.data.busy) return;
    if (!Online.ready) {
      const name = this.data.myName.trim();
      if (!name) {
        wx.showToast({ title: '先写一下怎么称呼你', icon: 'none' });
        return;
      }
      const sp = this.data.selected;
      Online.saveProfile({ name, species: sp, petName: this.data.petName.trim() || pet(sp).name });
    }
    this.setData({ busy: true });
    try {
      await Online.ensureShareCode();
    } catch (e) { /* offline: the room retries */ }
    const invite = this.invite || (this.data.codeInput ? { code: this.data.codeInput } : null);
    let problem = '';
    if (invite) {
      try {
        const f = await Online.claim(invite.code, invite.tz);
        wx.showToast({ title: `加上${f.partnerName}了`, icon: 'success' });
      } catch (e) {
        if (e.reason !== 'own') problem = CLAIM_ERRORS[e.reason] || CLAIM_ERRORS.network;
      }
    }
    Online.connect();
    this.setData({ busy: false });
    if (problem) {
      wx.showModal({ title: '没加上', content: problem, showCancel: false, success: () => wx.redirectTo({ url: '/pages/room/room' }) });
    } else {
      wx.redirectTo({ url: '/pages/room/room' });
    }
  },

  // ---------- "I use Boop on a computer": send family a card for that computer's pet ----------
  openHelper() {
    this.setData({ helper: true });
  },
  closeHelper() {
    this.setData({ helper: false });
  },
  noop() {},
  onDeskCode(e) {
    const deskCode = Online.cleanCode(e.detail.value);
    this.setData({ deskCode, deskReady: Online.isCode(deskCode) && !!this.data.deskName.trim() });
  },
  onDeskName(e) {
    const deskName = e.detail.value;
    this.setData({ deskName, deskReady: Online.isCode(this.data.deskCode) && !!deskName.trim() });
  },

  onShareAppMessage(res) {
    const tz = new Date().getTimezoneOffset();
    if (res && res.from === 'button' && res.target && res.target.dataset.kind === 'desktop') {
      const name = this.data.deskName.trim();
      return {
        title: `${name}邀请你领养一只小宠物`,
        path: `/pages/pick/pick?code=${this.data.deskCode}&from=${encodeURIComponent(name)}&tz=${tz}`,
        imageUrl: '/images/share/dog.png',
      };
    }
    return { title: 'Boop 小宠物：一只会去家人那儿串门的宠物', path: '/pages/pick/pick', imageUrl: '/images/share/dog.png' };
  },
});
