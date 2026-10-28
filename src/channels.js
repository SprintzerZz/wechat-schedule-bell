export const notificationChannels = ['serverchan', 'pushdeer', 'wecom', 'wecom_robot'];

function validRobotWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'qyapi.weixin.qq.com'
      && url.pathname === '/cgi-bin/webhook/send' && /^[a-f0-9-]{36}$/i.test(url.searchParams.get('key') || '');
  } catch { return false; }
}

export function validWecomChannelId(value) {
  return /^\d{1,20}$/.test(String(value || '').trim());
}

export function channelReady(env, channel, wecomChannelId = '') {
  if (channel === 'serverchan') return Boolean(env.SERVERCHAN_SENDKEY?.startsWith('SCT'));
  if (channel === 'pushdeer') return Boolean(env.PUSHDEER_PUSHKEY?.trim());
  if (channel === 'wecom') return Boolean(env.SERVERCHAN_SENDKEY?.startsWith('SCT')) && validWecomChannelId(wecomChannelId);
  if (channel === 'wecom_robot') return validRobotWebhook(env.WECOM_ROBOT_WEBHOOK);
  return false;
}

export async function sendNotification(env, channel, title, body, fetcher = fetch, wecomChannelId = '') {
  if (!notificationChannels.includes(channel)) throw new Error('通知通道无效。');
  if (!channelReady(env, channel, wecomChannelId)) throw new Error(channel === 'pushdeer' ? 'PushDeer PushKey 未配置。'
    : channel === 'wecom_robot' ? '企业微信群机器人 WebHook 未配置。'
    : channel === 'wecom' && !validWecomChannelId(wecomChannelId) ? '请填写企业微信应用消息的通道编号。' : 'Server酱密钥未配置。');
  if (channel === 'wecom_robot') {
    let response;
    try {
      response = await fetcher(env.WECOM_ROBOT_WEBHOOK, {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ msgtype: 'text', text: { content: `${title}\n${body}` } })
      });
    } catch { throw new Error('企业微信群机器人连接失败。'); }
    if (!response.ok) throw new Error(`企业微信群机器人返回 HTTP ${response.status}。`);
    let result;
    try { result = await response.json(); } catch { throw new Error('企业微信群机器人响应无效。'); }
    if (Number(result.errcode) !== 0) throw new Error(`企业微信群机器人拒绝消息，代码 ${String(result.errcode).slice(0, 20)}。`);
    return;
  }
  const isPushDeer = channel === 'pushdeer';
  const url = isPushDeer ? 'https://api2.pushdeer.com/message/push'
    : `https://sctapi.ftqq.com/${encodeURIComponent(env.SERVERCHAN_SENDKEY)}.send`;
  const params = isPushDeer
    ? { pushkey: env.PUSHDEER_PUSHKEY.trim(), text: title, desp: body, type: 'markdown' }
    : { title, desp: body, ...(channel === 'wecom' ? { channel: String(wecomChannelId).trim() } : {}) };
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
  } catch { throw new Error('推送服务连接失败。'); }
  if (!response.ok) throw new Error(`推送服务返回 HTTP ${response.status}。`);
  let result;
  try { result = await response.json(); } catch { throw new Error('推送服务响应无效。'); }
  if (Number(result.code) !== 0) throw new Error(`推送服务拒绝消息，代码 ${String(result.code).slice(0, 20)}。`);
}
