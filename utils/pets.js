// The five pets, in Chinese. Species keys match the Mac/Windows apps and the server.
const PETS = {
  dog: { kind: '小狗', name: '虎虎', trait: '摇尾巴摇到停不下来' },
  bird: { kind: '鹦鹉', name: '啾啾', trait: '偷吃完还要唱首歌' },
  octopus: { kind: '小章鱼', name: '葡萄', trait: '小机灵鬼，什么都想管' },
  cat: { kind: '小猫', name: '花花', trait: '嘴上嫌弃，心里很粘人' },
  frog: { kind: '小青蛙', name: '皮皮', trait: '看见苍蝇能开心一整天' },
};
const ORDER = ['dog', 'bird', 'octopus', 'cat', 'frog'];

// What your own pet says when you tap it.
const TAP_LINES = {
  dog: ['今天也最喜欢你！', '再摸一下嘛', '尾巴停不下来了'],
  bird: ['这个是我的，那个也是我的', '啾啾！啾啾！', '想去找朋友玩'],
  octopus: ['我帮你看着呢', '你今天喝水了吗？', '我有八只手，都想抱你'],
  cat: ['哼，才不是想你', '……再摸一下也行', '我只是路过'],
  frog: ['呱？', '刚刚有只苍蝇！', '今天也开开心心'],
};

// The four things you can send. `action` is what the server and the desktop apps understand.
const ACTIONS = [
  { action: 'poke', label: '戳一戳', done: '戳到啦！', tint: '#FFE7A8' },
  { action: 'pet', label: '摸摸头', done: '摸到啦！', tint: '#FFDCE5' },
  { action: 'feed', label: '喂零食', done: '零食送到啦！', tint: '#DCEFC6' },
  { action: 'hug', label: '抱一抱', done: '抱到啦！', tint: '#E7DEFA' },
];

// Incoming visits ({name} = the friend, {pet} = your pet's name). `play` only comes from computers.
const VISIT_LINES = {
  poke: '戳戳！{name}在想你',
  pet: '{name}让我来摸摸{pet}',
  feed: '{name}给{pet}带了零食',
  hug: '{name}让我来抱抱你！',
  play: '{name}想跟{pet}玩',
};
const IN_LOG = {
  poke: '{name}戳了你',
  pet: '{name}摸了摸{pet}',
  feed: '{name}给{pet}送了零食',
  hug: '{name}抱了抱{pet}',
  play: '{name}来找{pet}玩',
};
const OUT_LOG = { poke: '你戳了一下', pet: '你摸了摸它的头', feed: '你送了零食', hug: '你抱了抱它' };

function pet(species) {
  return PETS[species] || PETS.dog;
}
function sprite(species, frame) {
  return `/images/pets/${PETS[species] ? species : 'dog'}_${frame || 'sit'}.png`;
}
function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ''));
}

module.exports = { PETS, ORDER, TAP_LINES, ACTIONS, VISIT_LINES, IN_LOG, OUT_LOG, pet, sprite, fill };
