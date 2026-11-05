# 推文转文本 (tweet-to-text)

把 X / Twitter 的推文、长帖（note）、串文转成纯文本，并自动翻译成简体中文。

面向安卓：在 X App 里点「分享」→ 选择本应用即可。

## 功能

- Web Share Target：从 X App 一键分享链接进来
- 也可粘贴 `x.com` / `twitter.com` 链接
- 抓取全文（优先长帖 note_tweet），可选抓取整串 thread
- 免费翻译（MyMemory，失败时尝试 Google gtx）
- 可选自备 OpenAI 兼容 API Key（仅存本机 localStorage）
- 中英对照 / 仅中文 / 仅原文
- 一键复制、保存 `.txt`、系统分享
- 本地历史记录

## 使用（安卓 Chrome）

1. 用 Chrome 打开本站
2. 菜单 →「添加到主屏幕」/「安装应用」
3. 在 X App 打开一条推文 → 分享 → 选「推文转文本」

## 技术说明

| 环节 | 方案 | 限制 |
|------|------|------|
| 内容 | `api.fxtwitter.com`，失败回退 `api.vxtwitter.com` | 第三方非官方接口，偶发 Cloudflare 拦截；私密推文不可见；X Articles 视接口是否返回 `article` 字段 |
| 串文 | `api.fxtwitter.com/2/thread/{id}` | 并非所有串都能拼全 |
| 翻译 | MyMemory 免费接口（主）+ Google gtx（备） | 有字数/频率限制；质量一般 |
| AI 翻译 | 用户自填 OpenAI 兼容接口 | 密钥只存本机，不上传到本仓库 |

本仓库只含应用代码，不含任何用户数据或密钥。

## 本地预览

```bash
python3 -m http.server 8080 --directory .
# 打开 http://localhost:8080
```

## 部署

GitHub Pages（Actions 工作流已配置）。仓库 Settings → Pages → Source 选 GitHub Actions。
