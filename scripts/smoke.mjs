import assert from 'node:assert/strict';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787';
const password = process.env.LOCAL_TEST_PASSWORD;
if (!password) throw new Error('设置 LOCAL_TEST_PASSWORD 后再运行本地集成检查。');

async function request(path, method = 'GET', body, cookie = '') {
  const response = await fetch(base + path, { method, headers: {
    ...(method === 'GET' ? {} : { origin: base }),
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {})
  }, body: body ? JSON.stringify(body) : undefined });
  return { response, data: await response.json().catch(() => ({})) };
}

assert.equal((await fetch(base)).status, 200);
assert.equal((await request('/api/events?day=2030-01-01')).response.status, 401);
const login = await request('/api/login', 'POST', { password });
assert.equal(login.response.status, 200, JSON.stringify(login.data));
const cookie = login.response.headers.get('set-cookie').split(';')[0];
assert.equal((await request('/api/session', 'GET', undefined, cookie)).response.status, 200);

const series = await request('/api/series', 'POST', {
  first_day: '2030-01-01', interval_days: 3, title: '本地集成检查', note: '',
  slots: [
    { start_time: '09:00', remind_time: '09:00' },
    { start_time: '10:00', remind_time: '10:00' },
    { start_time: '14:00', remind_time: '13:30' }
  ]
}, cookie);
assert.equal(series.response.status, 201, JSON.stringify(series.data));
const id = series.data.id;
async function item(day) {
  const result = await request(`/api/events?day=${day}`, 'GET', undefined, cookie);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data.events.find(event => event.series_id === id);
}
assert.equal((await item('2030-01-01')).remind_time, '09:00');
assert.equal((await item('2030-01-04')).remind_time, '10:00');
assert.equal((await item('2030-01-07')).remind_time, '13:30');
assert.equal((await item('2030-01-10')).remind_time, '09:00');
assert.equal(await item('2030-01-02'), undefined);

const template = await request(`/api/series/${id}/template`, 'PUT', {
  title: '本地集成检查', note: '循环模板已更新',
  slots: [
    { start_time: '09:00', remind_time: '09:15' },
    { start_time: '10:00', remind_time: '10:00' },
    { start_time: '14:00', remind_time: '13:30' }
  ]
}, cookie);
assert.equal(template.response.status, 200, JSON.stringify(template.data));
assert.equal((await item('2030-01-10')).remind_time, '09:15');

const override = await request(`/api/series/${id}/occurrences/2030-01-04`, 'PUT',
  { start_time: '11:00', remind_time: '10:30', title: '仅本次修改' }, cookie);
assert.equal(override.response.status, 200, JSON.stringify(override.data));
assert.equal((await item('2030-01-04')).remind_time, '10:30');
assert.equal((await item('2030-01-13')).remind_time, '10:00');

const skip = await request(`/api/series/${id}/occurrences/2030-01-07`, 'DELETE', undefined, cookie);
assert.equal(skip.response.status, 200, JSON.stringify(skip.data));
assert.equal(await item('2030-01-07'), undefined);
assert.equal((await item('2030-01-16')).remind_time, '13:30');

const stop = await request(`/api/series/${id}`, 'DELETE', undefined, cookie);
assert.equal(stop.response.status, 200, JSON.stringify(stop.data));
assert.equal(await item('2030-01-10'), undefined);
const single = await request('/api/events', 'POST', { day: '2030-01-11', start_time: '15:00',
  remind_time: '14:30', title: '单次安排' }, cookie);
assert.equal(single.response.status, 201, JSON.stringify(single.data));
assert.ok((await request('/api/events?day=2030-01-11', 'GET', undefined, cookie)).data.events
  .some(event => event.id === single.data.id));
assert.equal((await request(`/api/events/${single.data.id}`, 'DELETE', undefined, cookie)).response.status, 200);
console.log('本地集成检查通过：登录、循环、模板更新、单次修改、跳过、停止和单次安排。');
