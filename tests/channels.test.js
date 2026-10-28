import test from 'node:test';
import assert from 'node:assert/strict';
import { channelReady, sendNotification } from '../src/channels.js';

test('PushDeer 使用官方 POST 接口和表单参数', async () => {
  const env = { PUSHDEER_PUSHKEY: 'private-push-key' };
  let request;
  await sendNotification(env, 'pushdeer', '日程提醒', '任务正文', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ code: 0 }) };
  });
  assert.equal(request.url, 'https://api2.pushdeer.com/message/push');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body.get('pushkey'), env.PUSHDEER_PUSHKEY);
  assert.equal(request.options.body.get('text'), '日程提醒');
  assert.equal(request.options.body.get('desp'), '任务正文');
  assert.equal(request.options.body.get('type'), 'markdown');
});

test('微信通道继续使用 Server酱发送', async () => {
  let request;
  await sendNotification({ SERVERCHAN_SENDKEY: 'SCT_example' }, 'serverchan', '每日汇总', '安排正文',
    async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ code: 0 }) };
    });
  assert.match(request.url, /^https:\/\/sctapi\.ftqq\.com\//);
  assert.equal(request.options.body.get('title'), '每日汇总');
  assert.equal(request.options.body.get('desp'), '安排正文');
  assert.equal(request.options.body.has('channel'), false);
});

test('企业微信应用消息使用指定的 Server酱通道编号', async () => {
  let request;
  await sendNotification({ SERVERCHAN_SENDKEY: 'SCT_example' }, 'wecom', '安排提醒', '任务正文',
    async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ code: 0 }) };
    }, '12345');
  assert.match(request.url, /^https:\/\/sctapi\.ftqq\.com\//);
  assert.equal(request.options.body.get('channel'), '12345');
  assert.equal(request.options.body.get('title'), '安排提醒');
  assert.equal(channelReady({ SERVERCHAN_SENDKEY: 'SCT_example' }, 'wecom', '12345'), true);
  assert.equal(channelReady({ SERVERCHAN_SENDKEY: 'SCT_example' }, 'wecom'), false);
  await assert.rejects(sendNotification({ SERVERCHAN_SENDKEY: 'SCT_example' }, 'wecom', '标题', '正文',
    async () => { throw new Error('不应发起请求'); }), /通道编号/);
});

test('企业微信群机器人发送文本并检查企业微信返回码', async () => {
  const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=11111111-2222-3333-4444-555555555555';
  const env = { WECOM_ROBOT_WEBHOOK: webhook };
  let request;
  assert.equal(channelReady(env, 'wecom_robot'), true);
  await sendNotification(env, 'wecom_robot', '今日安排', '09:00 开会', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ errcode: 0, errmsg: 'ok' }) };
  });
  assert.equal(request.url, webhook);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {
    msgtype: 'text', text: { content: '今日安排\n09:00 开会' }
  });
  await assert.rejects(sendNotification(env, 'wecom_robot', '标题', '正文',
    async () => ({ ok: true, json: async () => ({ errcode: 93000 }) })), /拒绝消息/);
  assert.equal(channelReady({ WECOM_ROBOT_WEBHOOK: 'https://example.com/' }, 'wecom_robot'), false);
});

test('通知通道按密钥配置检查，服务端拒绝时报告失败', async () => {
  assert.equal(channelReady({ SERVERCHAN_SENDKEY: 'SCT_example' }, 'serverchan'), true);
  assert.equal(channelReady({}, 'pushdeer'), false);
  await assert.rejects(sendNotification({}, 'pushdeer', '标题', '正文', async () => {
    throw new Error('不应发起请求');
  }), /PushKey 未配置/);
  await assert.rejects(sendNotification({ PUSHDEER_PUSHKEY: 'private-push-key' }, 'pushdeer', '标题', '正文',
    async () => ({ ok: true, json: async () => ({ code: 1 }) })), /拒绝消息/);
});
