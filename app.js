const Online = require('./utils/online.js');

App({
  onLaunch() {
    Online.load();
  },
  // WeChat freezes a mini program a few seconds after it leaves the screen: close the socket cleanly
  // and come back on show. The server holds anything sent in between.
  onShow() {
    if (Online.ready) Online.connect();
  },
  onHide() {
    Online.suspend();
  },
});
