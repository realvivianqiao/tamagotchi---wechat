module.exports = {
  // The same server the Mac and Windows apps use, so pets on phones and computers are friends.
  // Mini programs may only reach domains registered (and ICP-filed) in the WeChat admin console; until
  // then, keep "不校验合法域名" ticked in the developer tool (project.config.json already sets urlCheck: false).
  SERVER: 'https://tamagotchi-udtz.onrender.com',

  // 订阅消息 template for "TA 回应了你". Fill in once the mini program is registered and a template is
  // picked in the admin console. Empty: the button explains that reminders come with the real release.
  SUBSCRIBE_TEMPLATE_ID: '',
};
