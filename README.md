# 微信日程铃 · WeChat Schedule Bell

一个运行在 Cloudflare Workers 上的私人日程提醒工具。用浏览器录入单次或周期安排，由云端定时生成每日汇总和单次提醒，电脑关机后仍可发送。

> 非微信或企业微信官方产品。群机器人消息仅发送到 WebHook 所属的企业微信群。

## 功能

- 密码登录的日程页面，按月查看安排，录入、修改、跳过或删除任务。
- 每隔 N 天、每轮 M 组时间循环；每组可单独指定任务时间、提醒时间、标题与备注。
- 每日汇总和可选的单次提醒；投递记录用于去重与有限重试。
- 支持企业微信群机器人 WebHook、Server酱微信通知、Server酱企业微信应用消息、PushDeer。
- 亮色与暗色主题；主题选择只保存在当前浏览器。

## 准备

需要 Node.js、npm 和一个 Cloudflare 账号。通知通道至少配置一个。此项目使用 Cloudflare Workers、D1 和 Cron Trigger；第三方通知服务的额度以各自控制台为准。

```powershell
npm install
Copy-Item wrangler.example.jsonc wrangler.jsonc
Copy-Item .dev.vars.example .dev.vars
```

本地开发时，编辑 `.dev.vars`：填写独立的 `ADMIN_PASSWORD` 和至少 24 字符的随机 `SESSION_SECRET`，再填写所选通道的凭据。`.dev.vars` 与 `wrangler.jsonc` 都被 Git 忽略。

| 通道 | Cloudflare Secret |
| --- | --- |
| 企业微信群机器人 | `WECOM_ROBOT_WEBHOOK`：完整群机器人 WebHook URL |
| Server酱微信通知、企业微信应用消息 | `SERVERCHAN_SENDKEY`：SCT 开头的 SendKey |
| PushDeer | `PUSHDEER_PUSHKEY`：PushKey |

企业微信应用消息还需在 Server酱「消息通道」中绑定自建应用，并在本项目设置页填写该通道编号。群机器人则直接使用企业微信群的 WebHook。

## 本地运行

先创建 D1 数据库，并把 Wrangler 返回的 `database_id` 填入本机 `wrangler.jsonc`。然后运行：

```powershell
npx wrangler d1 create schedule_bot
npm run db:local
npm run dev
```

打开 Wrangler 输出的本地地址。定时任务在本地不会自动运行；手动发送测试通知会调用真实推送服务。

## 部署

登录 Wrangler 后，将数据库迁移到线上：

```powershell
npx wrangler login
npm run db:remote
```

逐个上传所需 Secret，不要把密钥写入源码、配置模板或 GitHub：

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put WECOM_ROBOT_WEBHOOK
# 如需使用其他通道，再上传 SERVERCHAN_SENDKEY 或 PUSHDEER_PUSHKEY
npm run deploy
```

首次登录后，在页面「设置」中选择已配置的通知通道，并用「测试选中通道」确认送达。默认每日汇总时间为北京时间 08:00；无安排时默认不发送。Cron 每分钟检查一次，实际到达时间可能略有延迟。

## 测试与安全

```powershell
npm test
```

管理页面需要登录；修改接口检查同源请求。WebHook、SendKey 和 PushKey 仅保存在 Cloudflare Secret 或被 Git 忽略的本地文件中。日程正文会发送给所选通知服务，录入敏感内容前请自行确认服务的隐私条款。已发送的安排修改后不会自动重发；通知通道切换也不会重发历史消息。

本项目采用 [MIT 许可证](LICENSE)。
