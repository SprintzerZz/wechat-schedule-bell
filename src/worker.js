import { isDue, renderDigest, renderReminder, shanghaiParts, validDay } from './core.js';
import { calendarFor, createSeries, createSingle, eventsFor, getSeries, overrideOccurrence, settingsFor,
  skipOccurrence, stopSeries, updateSeriesTemplate, updateSingle } from './schedule.js';
import { nextReminderFor } from './next-reminder.js';
import { channelReady, notificationChannels, sendNotification, validWecomChannelId } from './channels.js';

const cookieName = 'schedule_session';
const encoder = new TextEncoder();

function reply(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers
  } });
}

async function jsonBody(request) {
  const text = await request.text();
  if (text.length > 30000) throw new Error('请求内容过长。');
  try { return JSON.parse(text); } catch { throw new Error('请求格式无效。'); }
}

function requireOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('请求来源无效。');
}

async function sessionKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 24) throw new Error('服务端尚未配置会话密钥。');
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signedSession(env) {
  const expires = String(Math.floor(Date.now() / 1000) + 7 * 86400);
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(expires));
  const hex = [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${expires}.${hex}`;
}

async function authenticated(request, env) {
  const value = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(value || '');
  if (!match || Number(match[1]) < Date.now() / 1000) return false;
  const signature = Uint8Array.from(match[2].match(/../g), hex => parseInt(hex, 16));
  return crypto.subtle.verify('HMAC', await sessionKey(env), signature, encoder.encode(match[1]));
}

function sessionCookie(request, value, age) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${cookieName}=${value}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${age}`;
}

async function countSentToday(db, day) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE day = ? AND status IN ('sent', 'sending')").bind(day).first();
  return row.count;
}

async function deliver(env, channel, wecomChannelId, day, key, kind, message, now, cap) {
  const db = env.DB;
  const existing = await db.prepare('SELECT status FROM deliveries WHERE key = ?').bind(key).first();
  if (existing?.status === 'sent') return;
  if (!existing && await countSentToday(db, day) >= cap) return;
  const stamp = now.toISOString();
  await db.prepare("INSERT OR IGNORE INTO deliveries (key, day, kind, status, attempts, updated_at) VALUES (?, ?, ?, 'pending', 0, ?)")
    .bind(key, day, kind, stamp).run();
  const lease = await db.prepare(`UPDATE deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
    WHERE key = ? AND attempts < 3 AND (status IN ('pending', 'failed') OR
    (status = 'sending' AND updated_at < ?))`)
    .bind(stamp, key, new Date(now.getTime() - 10 * 60000).toISOString()).run();
  if (!lease.meta.changes) return;
  try {
    await sendNotification(env, channel, message.title, message.body, fetch, wecomChannelId);
    await db.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL WHERE key = ?")
      .bind(stamp, stamp, key).run();
  } catch (error) {
    await db.prepare("UPDATE deliveries SET status = 'failed', updated_at = ?, last_error = ? WHERE key = ?")
      .bind(stamp, String(error.message).slice(0, 200), key).run();
    throw error;
  }
}

async function sendDue(env, now) {
  const { day, time } = shanghaiParts(now);
  const settings = await settingsFor(env.DB);
  if (!settings) return;
  const events = await eventsFor(env.DB, day);
  const limit = Math.max(1, Math.min(100, Number(settings.daily_limit) || 5));
  const errors = [];
  if (isDue(time, settings.send_at) && (events.length || settings.send_empty)) {
    const message = renderDigest(day, events);
    try { await deliver(env, settings.notification_channel, settings.wecom_channel_id, day, `digest:${day}`, 'digest', message, now, limit); }
    catch (error) { errors.push(error); }
  }
  if (settings.reminders_enabled) {
    for (const item of events.filter(e => e.remind_time && isDue(time, e.remind_time))) {
      const digestStatus = await env.DB.prepare('SELECT status FROM deliveries WHERE key = ?').bind(`digest:${day}`).first();
      const reserveForDigest = !digestStatus || digestStatus.status !== 'sent' ? 1 : 0;
      const cap = Math.max(0, limit - reserveForDigest);
      const key = `reminder:${item.kind}:${item.source_id}:${day}`;
      const message = renderReminder(day, item);
      try { await deliver(env, settings.notification_channel, settings.wecom_channel_id, day, key, 'reminder', message, now, cap); }
      catch (error) { errors.push(error); }
    }
  }
  if (errors.length) throw errors[0];
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!env.DB) return reply({ error: '数据库尚未配置。' }, 503);
  if (method !== 'GET') requireOrigin(request);

  if (path === '/api/login' && method === 'POST') {
    const input = await jsonBody(request);
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const now = Math.floor(Date.now() / 1000);
    const attempt = await env.DB.prepare('SELECT window_started_at, attempts FROM login_attempts WHERE ip = ?').bind(ip).first();
    if (attempt && attempt.window_started_at > now - 900 && attempt.attempts >= 10) return reply({ error: '尝试次数过多，请 15 分钟后再试。' }, 429);
    if (!env.ADMIN_PASSWORD || String(input.password || '') !== env.ADMIN_PASSWORD) {
      await env.DB.prepare(`INSERT INTO login_attempts (ip, window_started_at, attempts) VALUES (?, ?, 1)
        ON CONFLICT(ip) DO UPDATE SET window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
        attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END`)
        .bind(ip, now, now - 900, now - 900).run();
      return reply({ error: '密码错误。' }, 401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
    return reply({ ok: true }, 200, { 'set-cookie': sessionCookie(request, await signedSession(env), 604800) });
  }
  if (path === '/api/logout' && method === 'POST') return reply({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  if (!await authenticated(request, env)) return reply({ error: '请先登录。' }, 401);
  if (path === '/api/session' && method === 'GET') return reply({ ok: true });
  if (path === '/api/config' && method === 'GET') {
    const settings = await settingsFor(env.DB);
    return reply({ channel_ready: channelReady(env, settings.notification_channel, settings.wecom_channel_id),
      channels: { serverchan: channelReady(env, 'serverchan'), pushdeer: channelReady(env, 'pushdeer'),
        wecom: channelReady(env, 'wecom', settings.wecom_channel_id),
        wecom_robot: channelReady(env, 'wecom_robot') } });
  }

  if (path === '/api/settings' && method === 'GET') return reply(await settingsFor(env.DB));
  if (path === '/api/next-reminder' && method === 'GET') {
    const settings = await settingsFor(env.DB);
    return reply({ enabled: Boolean(settings?.reminders_enabled),
      next: settings?.reminders_enabled ? await nextReminderFor(env.DB) : null });
  }
  if (path === '/api/settings' && method === 'PUT') {
    const value = await jsonBody(request);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.send_at || ''))) throw new Error('发送时间无效。');
    const limit = Number(value.daily_limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('每日上限应为 1–100。');
    const channel = String(value.notification_channel || '');
    const wecomChannelId = String(value.wecom_channel_id || '').trim();
    if (!notificationChannels.includes(channel)) throw new Error('请选择有效的通知通道。');
    if (wecomChannelId && !validWecomChannelId(wecomChannelId)) throw new Error('企业微信通道编号应为数字。');
    if (!channelReady(env, channel, wecomChannelId)) throw new Error(channel === 'pushdeer' ? '请先配置 PushDeer PushKey。'
      : channel === 'wecom_robot' ? '请先配置企业微信群机器人 WebHook。'
      : channel === 'wecom' && !wecomChannelId ? '请先填写企业微信通道编号。' : '请先配置 Server酱 SendKey。');
    await env.DB.prepare('UPDATE settings SET send_at = ?, send_empty = ?, reminders_enabled = ?, daily_limit = ?, notification_channel = ?, wecom_channel_id = ? WHERE id = 1')
      .bind(value.send_at, value.send_empty ? 1 : 0, value.reminders_enabled ? 1 : 0, limit, channel, wecomChannelId).run();
    return reply({ ok: true });
  }

  if (path === '/api/events' && method === 'GET') {
    const day = url.searchParams.get('day');
    return reply({ events: await eventsFor(env.DB, day) });
  }
  if (path === '/api/calendar' && method === 'GET') return reply(await calendarFor(env.DB, url.searchParams.get('month') || ''));
  if (path === '/api/events' && method === 'POST') return reply({ id: await createSingle(env.DB, await jsonBody(request)) }, 201);
  const event = /^\/api\/events\/([a-f0-9-]{36})$/.exec(path);
  if (event && method === 'PUT') return (await updateSingle(env.DB, event[1], await jsonBody(request)))
    ? reply({ ok: true }) : reply({ error: '安排不存在。' }, 404);
  if (event && method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(event[1]).run();
    return result.meta.changes ? reply({ ok: true }) : reply({ error: '安排不存在。' }, 404);
  }

  if (path === '/api/series' && method === 'POST') return reply({ id: await createSeries(env.DB, await jsonBody(request)) }, 201);
  const series = /^\/api\/series\/([a-f0-9-]{36})$/.exec(path);
  if (series && method === 'GET') {
    const value = await getSeries(env.DB, series[1]);
    return value ? reply(value) : reply({ error: '循环不存在。' }, 404);
  }
  if (series && method === 'DELETE') return (await stopSeries(env.DB, series[1]))
    ? reply({ ok: true }) : reply({ error: '循环不存在。' }, 404);
  const template = /^\/api\/series\/([a-f0-9-]{36})\/template$/.exec(path);
  if (template && method === 'PUT') return (await updateSeriesTemplate(env.DB, template[1], await jsonBody(request)))
    ? reply({ ok: true }) : reply({ error: '循环不存在。' }, 404);
  const occurrence = /^\/api\/series\/([a-f0-9-]{36})\/occurrences\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (occurrence && method === 'PUT') return (await overrideOccurrence(env.DB, occurrence[1], occurrence[2], await jsonBody(request)))
    ? reply({ ok: true }) : reply({ error: '该日不属于此循环。' }, 404);
  if (occurrence && method === 'DELETE') return (await skipOccurrence(env.DB, occurrence[1], occurrence[2]))
    ? reply({ ok: true }) : reply({ error: '该日不属于此循环。' }, 404);

  if (path === '/api/preview' && method === 'GET') {
    const day = url.searchParams.get('day');
    const items = await eventsFor(env.DB, day);
    return reply({ message: renderDigest(day, items) });
  }
  if (path === '/api/status' && method === 'GET') {
    const day = url.searchParams.get('day');
    if (!validDay(day)) throw new Error('日期无效。');
    const deliveries = (await env.DB.prepare('SELECT kind, status, sent_at, last_error FROM deliveries WHERE day = ? ORDER BY kind, key').bind(day).all()).results;
    return reply({ deliveries });
  }
  if (path === '/api/test' && method === 'POST') {
    const input = request.headers.get('content-type')?.includes('application/json') ? await jsonBody(request) : {};
    const settings = await settingsFor(env.DB);
    const channel = input.channel || settings.notification_channel;
    const wecomChannelId = input.wecom_channel_id === undefined ? settings.wecom_channel_id : input.wecom_channel_id;
    await sendNotification(env, channel, '日程 Bot 测试', '这是一条手动测试消息。', fetch, wecomChannelId);
    return reply({ ok: true });
  }
  return reply({ error: '接口不存在。' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith('/api/')) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return reply({ error: error.message || '请求失败。' }, error.message === '请求来源无效。' ? 403 : 400);
    }
  },
  async scheduled(controller, env) {
    await sendDue(env, new Date(controller.scheduledTime));
  }
};
