App({
  globalData: {
    // 部署 Zone Web 静态文件后的 HTTPS 地址（如微信云开发静态托管或自有备案域名）
    zoneWebUrl: 'https://your-zone-domain.example.com/',
    wxUid: ''
  },
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ traceUser: true });
    }
    // 真正的零按钮静默微信登录：打开小程序瞬间自动完成身份识别
    wx.login({
      success: res => {
        if (!res.code) return;
        if (wx.cloud) {
          wx.cloud.callFunction({
            name: 'zoneAuth',
            data: { code: res.code },
            success: r => {
              this.globalData.wxUid = r?.result?.openid || '';
            }
          });
        }
      }
    });
  }
});
