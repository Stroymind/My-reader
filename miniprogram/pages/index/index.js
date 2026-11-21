const app = getApp();

Page({
  data: { url: '' },
  onLoad() {
    const base = app.globalData.zoneWebUrl;
    const attach = () => {
      const uid = app.globalData.wxUid;
      const sep = base.includes('?') ? '&' : '?';
      this.setData({ url: uid ? `${base}${sep}wx_uid=${encodeURIComponent(uid)}` : base });
    };
    if (app.globalData.wxUid) attach();
    else setTimeout(attach, 320);
  },
  onShareAppMessage() {
    return {
      title: 'Zone · 阅读、想法与星海',
      path: '/pages/index/index'
    };
  }
});
