# Boop 小宠物 — WeChat mini program (prototype)

A phone version of [Boop](https://getbooped.com) for family in China. It talks to the same server as the Mac and
Windows apps ([realvivianqiao/tamagotchi](https://github.com/realvivianqiao/tamagotchi)), so a parent's phone pet and
your Mac pet are friends like any two pets: pokes, pats, snacks and hugs go both ways, and visits sent while the
other side is asleep or closed wait on the server and play when they come back.

What's in it:

- **Pick a pet** (`pages/pick`): 虎虎 · 啾啾 · 葡萄 · 花花 · 皮皮, then "怎么称呼你" and the pet's name. Opened
  from a share card it says who invited you and adds them automatically.
- **The room** (`pages/room`): your pet (tap to pat it, 喂它 to feed it, tap its name to rename), the family
  member's card with their city's time and whether they're 在线 / 在睡觉 / 不在线 (tap to set the city), and
  four big buttons: 戳一戳 · 摸摸头 · 喂零食 · 抱一抱.
- **After sending**: a sheet saying when they'll see it ("纽约现在是凌晨 2:10…醒来第一眼就会看到") and the last
  few sends with 送到了 / 还没看到.
- **Visits**: their pet walks into your room with a line ("Vivian让我来抱抱你！"); 抱回去 / 戳回去 reply in one
  tap. Coming back after a while shows one visit: "你不在的时候，来过 3 次".
- **Family**: your 6-letter code, a 发给家人 share card, or type someone's code. Someone using Boop on a
  computer can make a share card for their computer's pet from the pick page ("我在电脑上用 Boop，想邀请家人").

## Try it

1. Install [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html).
2. 导入项目 → choose this repo's folder. For the AppID, click 测试号 (free) or paste your own.
   `project.config.json` already turns on 不校验合法域名, so it can reach the Render server during development.
3. On your Mac: Boop menu → **Invite a friend…** → copy the code.
4. In the simulator: pick a pet, pick a name, paste the code into "家人给了你邀请码". Your Mac pet gets a new
   friend; poke from the simulator and your Mac pet gets the visit.
5. On your own phone: 预览 → scan the QR code with WeChat. Turn on 开发调试 (··· menu) so the phone also skips
   the domain check.

## The server change

Today the server only relays a poke if the other person is connected right then, so a poke sent to a sleeping
laptop is lost. [`server-patch/offline-visits.patch`](server-patch/offline-visits.patch) (for `index.js` in the
desktop repo) holds actions for whoever is away and plays them when they reconnect (the newest 3, marked
`queued`, with `missed` = how many), and answers senders that include an `id` with `ack` messages:
`live` / `queued` / `delivered`. The Mac and Windows apps ignore the new fields, so nothing else changes.

```bash
cd ../tamagotchi && git apply ../tamagotchi---wechat/server-patch/offline-visits.patch
```

Until it's deployed, live pokes work and a sent poke just says 已发送.

## Before your parents can use it

Their phones can't open a development build, so this needs a registered mini program:

- Register at mp.weixin.qq.com (an individual needs a mainland Chinese ID; or a Chinese company), then
  **小程序备案** (about 2–4 weeks). Put the real AppID in `project.config.json`.
- Until the public release, add family as **体验成员** and share the 体验版.
- For release, the server must be on an **ICP-filed HTTPS/WSS domain** listed under 服务器域名, or on
  微信云托管. Then point `config.js` there.
- **Reminders** (订阅消息): pick a template in the console, put its id in `config.js`, and have the server
  send it with the AppSecret when a visit is held for someone who opted in. The button already asks for
  permission once the id is set.

## Development

```bash
npm install                              # only ws, for the Node tests
npm run assets                           # pet frames + share covers from ../tamagotchi/CastAtlas.swift

# a local server: the desktop repo with the patch applied, no Supabase env
(cd ../tamagotchi && PORT=3999 MOCHI_DATA_DIR=$(mktemp -d) node index.js &)
BOOP_SERVER=http://localhost:3999 npm test   # protocol vs a fake Mac, then the pages under a stand-in wx
```

Not in this prototype yet: outfits, the Visit Lab animations (visits use the pet's walk and happy
frames), dancing, pet names of desktop friends (the protocol doesn't carry them, so the card says
"Vivian的小狗"), and held visits surviving a server restart (they're kept in memory).
