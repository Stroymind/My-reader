"""Zone 真实应用连接器引擎（纯 BYOK 无状态：用户令牌仅由请求透传，绝不落盘）。

支持真实官方 API 验证与工具调用：
- 开发协作：GitHub / Linear
- 办公与任务：Notion / Todoist / Trello / Airtable
- 消息与邮件：Slack / 飞书 / 钉钉 / Telegram / Discord / Resend
- 通用 OAuth 网关：Composio / Zapier / 任意 Streamable HTTP MCP
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse

import httpx

CONNECTOR_TOOLS_META: dict[str, list[dict[str, str]]] = {
    "github": [
        {"name": "github_my_repos", "desc": "列出我的 GitHub 仓库（参数可留空或传关键词）"},
        {"name": "github_list_issues", "desc": "查看指定仓库 Issue（参数：owner/repo）"},
        {"name": "github_create_issue", "desc": "创建 GitHub Issue（参数：owner/repo|标题|正文）"},
    ],
    "notion": [
        {"name": "notion_search", "desc": "搜索我的 Notion 页面与数据库（参数：关键词）"},
        {"name": "notion_create_page", "desc": "在指定父页面下创建 Notion 页面（参数：parent_page_id|标题|内容）"},
    ],
    "linear": [
        {"name": "linear_my_issues", "desc": "查看分配给我的 Linear 任务（参数可留空）"},
        {"name": "linear_create_issue", "desc": "创建 Linear 任务（参数：team_id|标题|描述）"},
    ],
    "todoist": [
        {"name": "todoist_list_tasks", "desc": "查看我的 Todoist 待办任务（参数可留空）"},
        {"name": "todoist_add_task", "desc": "新建 Todoist 待办（参数：任务内容|截止时间可选如 tomorrow）"},
    ],
    "slack": [
        {"name": "slack_post_message", "desc": "发送消息到 Slack（Webhook 直接传内容；Bot Token 传 channel_id|内容）"},
    ],
    "feishu": [
        {"name": "feishu_send_message", "desc": "通过飞书机器人发送群消息（参数：消息正文）"},
    ],
    "dingtalk": [
        {"name": "dingtalk_send_message", "desc": "通过钉钉机器人发送群消息（参数：消息正文）"},
    ],
    "telegram": [
        {"name": "telegram_send_message", "desc": "通过 Telegram Bot 发消息（参数：消息正文，或 chat_id|消息正文）"},
    ],
    "discord": [
        {"name": "discord_send_message", "desc": "发送消息到 Discord 频道（参数：消息正文）"},
    ],
    "resend": [
        {"name": "resend_send_email", "desc": "通过 Resend 发送邮件（参数：收件人邮箱|主题|正文）"},
    ],
    "airtable": [
        {"name": "airtable_list_bases", "desc": "列出我的 Airtable 数据库（参数可留空）"},
    ],
    "trello": [
        {"name": "trello_list_boards", "desc": "列出我的 Trello 看板（参数可留空）"},
    ],
}


def _host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


async def verify_connector(connector_id: str, token: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    cid = str(connector_id or "").strip().lower()
    tok = str(token or "").strip()
    ex = extra if isinstance(extra, dict) else {}
    if not cid:
        return {"ok": False, "error": "缺少应用标识"}
    tools = CONNECTOR_TOOLS_META.get(cid, [])

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if cid == "github":
                if not tok:
                    return {"ok": False, "error": "请填入 GitHub Personal Access Token"}
                r = await client.get(
                    "https://api.github.com/user",
                    headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "User-Agent": "Zone-Agent/1.3"},
                )
                if r.status_code != 200:
                    return {"ok": False, "error": f"GitHub 鉴权失败（HTTP {r.status_code}），请检查 Token 是否有效"}
                u = r.json()
                return {"ok": True, "account": f"@{u.get('login') or u.get('name') or 'github'}", "tools": tools}

            if cid == "notion":
                if not tok:
                    return {"ok": False, "error": "请填入 Notion Internal Integration Token（secret_ 或 ntn_ 开头）"}
                r = await client.get(
                    "https://api.notion.com/v1/users/me",
                    headers={"Authorization": f"Bearer {tok}", "Notion-Version": "2022-06-28"},
                )
                if r.status_code != 200:
                    return {"ok": False, "error": f"Notion 鉴权失败（HTTP {r.status_code}），请确认 Token 正确"}
                u = r.json()
                return {"ok": True, "account": str(u.get("name") or u.get("bot", {}).get("workspace_name") or "Notion"), "tools": tools}

            if cid == "linear":
                if not tok:
                    return {"ok": False, "error": "请填入 Linear Personal API Key（lin_api_ 开头）"}
                r = await client.post(
                    "https://api.linear.app/graphql",
                    headers={"Authorization": tok, "Content-Type": "application/json"},
                    json={"query": "{ viewer { name email } }"},
                )
                d = r.json() if r.content else {}
                viewer = (d.get("data") or {}).get("viewer")
                if r.status_code != 200 or not viewer:
                    return {"ok": False, "error": f"Linear 鉴权失败（HTTP {r.status_code}）"}
                return {"ok": True, "account": str(viewer.get("name") or viewer.get("email") or "Linear"), "tools": tools}

            if cid == "todoist":
                if not tok:
                    return {"ok": False, "error": "请填入 Todoist API Token"}
                r = await client.get(
                    "https://api.todoist.com/rest/v2/projects",
                    headers={"Authorization": f"Bearer {tok}"},
                )
                if r.status_code != 200:
                    return {"ok": False, "error": f"Todoist 鉴权失败（HTTP {r.status_code}）"}
                projs = r.json() if isinstance(r.json(), list) else []
                return {"ok": True, "account": f"已连 {len(projs)} 个项目", "tools": tools}

            if cid == "slack":
                if not tok:
                    return {"ok": False, "error": "请填入 Slack Bot Token（xoxb-...）或 Incoming Webhook URL"}
                if tok.startswith("https://"):
                    if _host_of(tok) != "hooks.slack.com":
                        return {"ok": False, "error": "Webhook 必须以 https://hooks.slack.com/ 开头"}
                    return {"ok": True, "account": "Slack Webhook", "tools": tools}
                r = await client.post("https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {tok}"})
                d = r.json() if r.content else {}
                if not d.get("ok"):
                    return {"ok": False, "error": f"Slack 鉴权失败：{d.get('error') or r.status_code}"}
                return {"ok": True, "account": str(d.get("team") or d.get("user") or "Slack"), "tools": tools}

            if cid == "feishu":
                if not tok.startswith("https://") or _host_of(tok) not in ("open.feishu.cn", "open.larksuite.com"):
                    return {"ok": False, "error": "请填入飞书/Lark 机器人 Webhook（https://open.feishu.cn/open-apis/bot/v2/hook/...）"}
                return {"ok": True, "account": "飞书群机器人", "tools": tools}

            if cid == "dingtalk":
                if not tok.startswith("https://") or _host_of(tok) != "oapi.dingtalk.com":
                    return {"ok": False, "error": "请填入钉钉群机器人 Webhook（https://oapi.dingtalk.com/robot/send?access_token=...）"}
                return {"ok": True, "account": "钉钉群机器人", "tools": tools}

            if cid == "telegram":
                if not tok or ":" not in tok:
                    return {"ok": False, "error": "请填入 Telegram Bot Token（格式如 123456:ABC...）"}
                r = await client.get(f"https://api.telegram.org/bot{tok}/getMe")
                d = r.json() if r.content else {}
                if not d.get("ok"):
                    return {"ok": False, "error": f"Telegram 鉴权失败：{d.get('description') or r.status_code}"}
                uname = (d.get("result") or {}).get("username") or "Telegram Bot"
                return {"ok": True, "account": f"@{uname}", "tools": tools}

            if cid == "discord":
                host = _host_of(tok)
                if not tok.startswith("https://") or host not in ("discord.com", "discordapp.com") or "/api/webhooks/" not in tok:
                    return {"ok": False, "error": "请填入 Discord 频道 Webhook 地址"}
                r = await client.get(tok)
                if r.status_code != 200:
                    return {"ok": False, "error": f"Discord Webhook 无效（HTTP {r.status_code}）"}
                d = r.json() if r.content else {}
                return {"ok": True, "account": str(d.get("name") or "Discord 频道"), "tools": tools}

            if cid == "resend":
                if not tok:
                    return {"ok": False, "error": "请填入 Resend API Key（re_ 开头）"}
                r = await client.get("https://api.resend.com/domains", headers={"Authorization": f"Bearer {tok}"})
                if r.status_code not in (200, 403):
                    return {"ok": False, "error": f"Resend 鉴权失败（HTTP {r.status_code}）"}
                return {"ok": True, "account": "Resend 邮件", "tools": tools}

            if cid == "airtable":
                if not tok:
                    return {"ok": False, "error": "请填入 Airtable Personal Access Token（pat...）"}
                r = await client.get("https://api.airtable.com/v0/meta/whoami", headers={"Authorization": f"Bearer {tok}"})
                if r.status_code != 200:
                    return {"ok": False, "error": f"Airtable 鉴权失败（HTTP {r.status_code}）"}
                d = r.json() if r.content else {}
                return {"ok": True, "account": str(d.get("id") or "Airtable"), "tools": tools}

            if cid == "trello":
                api_key = str(ex.get("apiKey") or "").strip()
                if not tok or not api_key:
                    return {"ok": False, "error": "请同时填入 Trello API Key 与 Token"}
                r = await client.get("https://api.trello.com/1/members/me", params={"key": api_key, "token": tok})
                if r.status_code != 200:
                    return {"ok": False, "error": f"Trello 鉴权失败（HTTP {r.status_code}）"}
                d = r.json() if r.content else {}
                return {"ok": True, "account": f"@{d.get('username') or 'trello'}", "tools": tools}

            return {"ok": False, "error": f"不支持的内置连接器：{cid}"}
    except httpx.TimeoutException:
        return {"ok": False, "error": "连接服务商接口超时，请稍后再试"}
    except Exception as exc:
        return {"ok": False, "error": f"验证失败：{exc}"}


async def call_connector_tool(conn: dict[str, Any], tool_name: str, arg: str = "") -> str:
    cid = str(conn.get("id") or "").strip().lower()
    tok = str(conn.get("token") or "").strip()
    ex = conn.get("extra") if isinstance(conn.get("extra"), dict) else {}
    a = str(arg or "").strip()
    if not tok:
        return f"应用「{cid}」未授权令牌。"

    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            if tool_name == "github_my_repos":
                r = await client.get(
                    "https://api.github.com/user/repos",
                    params={"sort": "updated", "per_page": 10},
                    headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "User-Agent": "Zone-Agent/1.3"},
                )
                if r.status_code != 200:
                    return f"GitHub 读取仓库失败（HTTP {r.status_code}）"
                repos = r.json()
                if a:
                    low = a.lower()
                    repos = [x for x in repos if low in (x.get("full_name", "") + " " + (x.get("description") or "")).lower()] or repos[:5]
                lines = [f"- {x.get('full_name')} (★{x.get('stargazers_count', 0)}, {x.get('language') or '-'})\n  URL: {x.get('html_url')}\n  {(x.get('description') or '')[:100]}" for x in repos[:8]]
                return "\n".join(lines) or "暂无仓库。"

            if tool_name == "github_list_issues":
                repo = a.split("|")[0].strip()
                if "/" not in repo:
                    return "参数需为 owner/repo 格式。"
                r = await client.get(
                    f"https://api.github.com/repos/{repo}/issues",
                    params={"state": "open", "per_page": 8},
                    headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "User-Agent": "Zone-Agent/1.3"},
                )
                if r.status_code != 200:
                    return f"读取 Issues 失败（HTTP {r.status_code}）"
                items = [x for x in r.json() if "pull_request" not in x][:8]
                return "\n".join(f"- #{x.get('number')} {x.get('title')} ({x.get('html_url')})" for x in items) or "该仓库目前没有未关闭 Issue。"

            if tool_name == "github_create_issue":
                parts = [p.strip() for p in a.split("|")]
                if len(parts) < 2 or "/" not in parts[0]:
                    return "参数格式：owner/repo|标题|正文"
                r = await client.post(
                    f"https://api.github.com/repos/{parts[0]}/issues",
                    headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "User-Agent": "Zone-Agent/1.3"},
                    json={"title": parts[1], "body": parts[2] if len(parts) > 2 else ""},
                )
                if r.status_code not in (200, 201):
                    return f"创建 Issue 失败（HTTP {r.status_code}）"
                d = r.json()
                return f"已创建 Issue #{d.get('number')}：{d.get('title')}\nURL: {d.get('html_url')}"

            if tool_name == "notion_search":
                r = await client.post(
                    "https://api.notion.com/v1/search",
                    headers={"Authorization": f"Bearer {tok}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"},
                    json={"query": a, "page_size": 8},
                )
                if r.status_code != 200:
                    return f"Notion 搜索失败（HTTP {r.status_code}）"
                res = r.json().get("results") or []
                lines = []
                for it in res[:8]:
                    props = it.get("properties") or {}
                    title = ""
                    for pv in props.values():
                        if isinstance(pv, dict) and pv.get("type") == "title":
                            title = "".join(t.get("plain_text", "") for t in (pv.get("title") or []))
                            break
                    if not title and isinstance(it.get("title"), list):
                        title = "".join(t.get("plain_text", "") for t in it["title"])
                    lines.append(f"- [{it.get('object')}] {title or '(无标题)'} (id: {it.get('id')})\n  URL: {it.get('url') or ''}")
                return "\n".join(lines) or "Notion 未搜到匹配内容。"

            if tool_name == "notion_create_page":
                parts = [p.strip() for p in a.split("|")]
                if len(parts) < 2:
                    return "参数格式：parent_page_id|标题|内容"
                pid, title = parts[0], parts[1]
                body_txt = parts[2] if len(parts) > 2 else ""
                payload = {
                    "parent": {"page_id": pid},
                    "properties": {"title": {"title": [{"text": {"content": title[:160]}}]}},
                    "children": [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": body_txt[:1800]}}]}}] if body_txt else [],
                }
                r = await client.post(
                    "https://api.notion.com/v1/pages",
                    headers={"Authorization": f"Bearer {tok}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"},
                    json=payload,
                )
                if r.status_code not in (200, 201):
                    return f"创建 Notion 页面失败（HTTP {r.status_code}）：{r.text[:160]}"
                d = r.json()
                return f"已创建 Notion 页面「{title}」\nURL: {d.get('url')}"

            if tool_name == "linear_my_issues":
                r = await client.post(
                    "https://api.linear.app/graphql",
                    headers={"Authorization": tok, "Content-Type": "application/json"},
                    json={"query": "{ viewer { assignedIssues(first: 10) { nodes { identifier title state { name } url } } } }"},
                )
                nodes = (((r.json().get("data") or {}).get("viewer") or {}).get("assignedIssues") or {}).get("nodes") or []
                return "\n".join(f"- [{n.get('identifier')}] {n.get('title')} ({(n.get('state') or {}).get('name', '')}) {n.get('url')}" for n in nodes) or "暂无指派的 Linear 任务。"

            if tool_name == "linear_create_issue":
                parts = [p.strip() for p in a.split("|")]
                if len(parts) < 2:
                    return "参数格式：team_id|标题|描述"
                r = await client.post(
                    "https://api.linear.app/graphql",
                    headers={"Authorization": tok, "Content-Type": "application/json"},
                    json={"query": "mutation($t:String!,$ti:String!,$d:String){issueCreate(input:{teamId:$t,title:$ti,description:$d}){success issue{identifier title url}}}", "variables": {"t": parts[0], "ti": parts[1], "d": parts[2] if len(parts) > 2 else ""}},
                )
                iss = (((r.json().get("data") or {}).get("issueCreate") or {}).get("issue")) or {}
                if not iss:
                    return f"创建 Linear 任务失败：{r.text[:160]}"
                return f"已创建 Linear 任务 [{iss.get('identifier')}] {iss.get('title')}\nURL: {iss.get('url')}"

            if tool_name == "todoist_list_tasks":
                r = await client.get("https://api.todoist.com/rest/v2/tasks", headers={"Authorization": f"Bearer {tok}"})
                if r.status_code != 200:
                    return f"Todoist 读取任务失败（HTTP {r.status_code}）"
                items = r.json()[:12]
                return "\n".join(f"- {x.get('content')} (截止: {(x.get('due') or {}).get('string', '无')})" for x in items) or "Todoist 当前无待办。"

            if tool_name == "todoist_add_task":
                parts = [p.strip() for p in a.split("|")]
                body: dict[str, Any] = {"content": parts[0]}
                if len(parts) > 1 and parts[1]:
                    body["due_string"] = parts[1]
                r = await client.post("https://api.todoist.com/rest/v2/tasks", headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, json=body)
                if r.status_code not in (200, 201):
                    return f"创建 Todoist 待办失败（HTTP {r.status_code}）"
                d = r.json()
                return f"已添加 Todoist 待办：{d.get('content')}\nURL: {d.get('url')}"

            if tool_name == "slack_post_message":
                if tok.startswith("https://hooks.slack.com/"):
                    r = await client.post(tok, json={"text": a})
                    return "已发送消息到 Slack。" if r.is_success else f"Slack 发送失败（HTTP {r.status_code}）"
                parts = [p.strip() for p in a.split("|", 1)]
                ch = parts[0] if len(parts) == 2 else str(ex.get("channel") or "").strip()
                txt = parts[1] if len(parts) == 2 else a
                if not ch:
                    return "请提供 Slack Channel ID（格式：channel_id|消息内容）"
                r = await client.post("https://slack.com/api/chat.postMessage", headers={"Authorization": f"Bearer {tok}"}, json={"channel": ch, "text": txt})
                d = r.json() if r.content else {}
                return "已发送消息到 Slack。" if d.get("ok") else f"Slack 发送失败：{d.get('error')}"

            if tool_name == "feishu_send_message":
                if _host_of(tok) not in ("open.feishu.cn", "open.larksuite.com"):
                    return "飞书 Webhook 地址不合法。"
                r = await client.post(tok, json={"msg_type": "text", "content": {"text": a}})
                return "已发送到飞书群。" if r.is_success else f"飞书发送失败（HTTP {r.status_code}）"

            if tool_name == "dingtalk_send_message":
                if _host_of(tok) != "oapi.dingtalk.com":
                    return "钉钉 Webhook 地址不合法。"
                r = await client.post(tok, json={"msgtype": "text", "text": {"content": a}})
                return "已发送到钉钉群。" if r.is_success else f"钉钉发送失败（HTTP {r.status_code}）"

            if tool_name == "telegram_send_message":
                parts = [p.strip() for p in a.split("|", 1)]
                chat_id = parts[0] if len(parts) == 2 else str(ex.get("chatId") or "").strip()
                txt = parts[1] if len(parts) == 2 else a
                if not chat_id:
                    return "请在参数中提供 chat_id|消息内容，或在连接配置中填好默认 Chat ID。"
                r = await client.post(f"https://api.telegram.org/bot{tok}/sendMessage", json={"chat_id": chat_id, "text": txt})
                d = r.json() if r.content else {}
                return "已发送到 Telegram。" if d.get("ok") else f"Telegram 发送失败：{d.get('description')}"

            if tool_name == "discord_send_message":
                if _host_of(tok) not in ("discord.com", "discordapp.com"):
                    return "Discord Webhook 地址不合法。"
                r = await client.post(tok, json={"content": a[:1900]})
                return "已发送到 Discord。" if r.is_success else f"Discord 发送失败（HTTP {r.status_code}）"

            if tool_name == "resend_send_email":
                parts = [p.strip() for p in a.split("|")]
                if len(parts) < 3:
                    return "参数格式：收件人邮箱|邮件主题|正文"
                sender = str(ex.get("fromEmail") or "Zone <onboarding@resend.dev>").strip()
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
                    json={"from": sender, "to": [parts[0]], "subject": parts[1], "text": parts[2]},
                )
                return f"已通过 Resend 发送邮件给 {parts[0]}。" if r.is_success else f"Resend 发信失败（HTTP {r.status_code}）：{r.text[:140]}"

            if tool_name == "airtable_list_bases":
                r = await client.get("https://api.airtable.com/v0/meta/bases", headers={"Authorization": f"Bearer {tok}"})
                if r.status_code != 200:
                    return f"Airtable 读取失败（HTTP {r.status_code}）"
                bases = r.json().get("bases") or []
                return "\n".join(f"- {b.get('name')} (id: {b.get('id')})" for b in bases[:12]) or "暂无 Airtable 数据库。"

            if tool_name == "trello_list_boards":
                api_key = str(ex.get("apiKey") or "").strip()
                r = await client.get("https://api.trello.com/1/members/me/boards", params={"key": api_key, "token": tok, "fields": "name,url"})
                if r.status_code != 200:
                    return f"Trello 读取失败（HTTP {r.status_code}）"
                boards = r.json()[:12]
                return "\n".join(f"- {b.get('name')} ({b.get('url')})" for b in boards) or "暂无 Trello 看板。"

            return f"未实现的应用工具：{tool_name}"
    except Exception as exc:
        return f"调用应用「{cid}」异常：{exc}"
