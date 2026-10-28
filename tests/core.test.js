import test from 'node:test';
import assert from 'node:assert/strict';
import { cyclePosition, isDue, renderDigest, shanghaiParts, validateCycle, validateEvent } from '../src/core.js';

test('三天间隔、三组时间跨月持续循环', () => {
  const series = { first_day: '2026-10-28', interval_days: 3, slots_per_cycle: 3, stop_after_day: null };
  const days = ['2026-10-28', '2026-10-31', '2026-11-03', '2026-11-06', '2026-11-09', '2026-11-12'];
  assert.deepEqual(days.map(day => cyclePosition(series, day)?.slot_index), [0, 1, 2, 0, 1, 2]);
  assert.deepEqual(days.map(day => cyclePosition(series, day)?.round), [1, 1, 1, 2, 2, 2]);
  assert.equal(cyclePosition(series, '2026-10-29'), null);
  assert.equal(cyclePosition(series, '2026-10-25'), null);
});

test('可配置间隔和组数，并可截止', () => {
  const series = { first_day: '2026-10-28', interval_days: 2, slots_per_cycle: 4, stop_after_day: '2026-11-05' };
  assert.deepEqual(['2026-10-28', '2026-10-30', '2026-11-01', '2026-11-03', '2026-11-05']
    .map(day => cyclePosition(series, day)?.slot_index), [0, 1, 2, 3, 0]);
  assert.equal(cyclePosition(series, '2026-11-07'), null);
});

test('循环配置校验每组独立提醒时间', () => {
  const result = validateCycle({ first_day: '2026-10-28', interval_days: 3, title: '锻炼',
    slots: [
      { start_time: '09:00', remind_time: '09:00' },
      { start_time: '10:00', remind_time: '09:30' },
      { start_time: '14:00', remind_time: '13:30' }
    ] });
  assert.deepEqual(result.slots.map(x => x.remind_time), ['09:00', '09:30', '13:30']);
  assert.throws(() => validateCycle({ first_day: '2026-10-28', interval_days: 0, title: '锻炼', slots: result.slots }));
  assert.throws(() => validateEvent({ day: '2026-10-28', start_time: '10:00', end_time: '09:00', title: '错误' }));
});

test('北京时间和发送窗口', () => {
  assert.deepEqual(shanghaiParts(new Date('2026-10-27T16:00:00Z')), { day: '2026-10-28', time: '00:00' });
  assert.equal(isDue('09:00', '09:00'), true);
  assert.equal(isDue('09:01', '09:00'), true);
  assert.equal(isDue('08:59', '09:00'), false);
  assert.equal(isDue('11:01', '09:00'), false);
});

test('每日汇总按任务时间排序并合并成一条正文', () => {
  const message = renderDigest('2026-10-28', [
    { id: 'b', start_time: '10:00', end_time: null, title: '第二项', note: '' },
    { id: 'a', start_time: '09:00', end_time: null, title: '第一项', note: '' }
  ]);
  assert.ok(message.body.indexOf('第一项') < message.body.indexOf('第二项'));
  assert.match(message.body, /共 2 项/);
});
