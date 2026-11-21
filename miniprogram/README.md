# Zone 微信小程序

在微信里点一下直接进入 Zone 阅读与星海，**零按钮静默完成微信登录**。

## 3 步上线体验版
1. 用 **微信开发者工具** 打开本目录（`outputs/Zone/miniprogram`），在 `project.config.json` 中填入你的小程序 `appid`。
2. 在微信云开发控制台开启「静态网站托管」，把 `outputs/Zone/www/` 目录上传，并将托管 HTTPS 地址填进 `app.js` 的 `zoneWebUrl`（同时在小程序后台「业务域名」加入该域名）。
3. 右键部署云函数 `cloudfunctions/zoneAuth`，点击「预览」即可在微信里扫码直接开读并转发好友。
