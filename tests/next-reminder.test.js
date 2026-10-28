import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSeriesReminder } from '../src/next-reminder.js';

const series = { id: 'cycle-1', first_day: '2026-10-28', interval_days: 3, slots_per_cycle: 3, stop_after_day: null };
const versions = [{ id: 'v1', effective_from_day: '2026-10-28', title: '循环任务', slots: [
  { slot_index: 0, remind_time: '09:00', title_override: null },
  { slot_index: 1, remind_time: '10:00', title_override: '第二次' },
  { slot_index: 2, remind_time: '13:30', title_override: null }
] }];

test('下一条提醒按循环时间组跨月查找', () => {
  assert.deepEqual(nextSeriesReminder(series, versions, [], '2026-10-28', '08:59'),
    { kind: 'cycle', source_id: 'cycle-1', day: '2026-10-28', time: '09:00', title: '循环任务' });
  assert.deepEqual(nextSeriesReminder(series, versions, [], '2026-10-28', '09:01'),
    { kind: 'cycle', source_id: 'cycle-1', day: '2026-10-31', time: '10:00', title: '第二次' });
});

test('跳过本次、单次覆盖和已发送状态会影响下一条', () => {
  const overrides = [
    { day: '2026-10-28', skipped: 1, remind_time: null, title: null },
    { day: '2026-10-31', skipped: 0, remind_time: '11:00', title: '临时调整' }
  ];
  assert.equal(nextSeriesReminder(series, versions, overrides, '2026-10-28', '08:00').time, '11:00');
  assert.equal(nextSeriesReminder(series, versions, overrides, '2026-10-31', '10:00',
    new Set(['reminder:cycle:cycle-1:2026-10-31'])).day, '2026-11-03');
});

test('未来模板和关闭的时间组按生效日期计算', () => {
  const changed = [
    { ...versions[0], slots: versions[0].slots.map(slot => ({ ...slot, remind_time: null })) },
    { id: 'v2', effective_from_day: '2026-10-31', title: '新模板', slots: [
      { slot_index: 0, remind_time: null, title_override: null },
      { slot_index: 1, remind_time: '10:45', title_override: null },
      { slot_index: 2, remind_time: null, title_override: null }
    ] }
  ];
  assert.deepEqual(nextSeriesReminder(series, changed, [], '2026-10-28', '08:00'),
    { kind: 'cycle', source_id: 'cycle-1', day: '2026-10-31', time: '10:45', title: '新模板' });
  assert.equal(nextSeriesReminder({ ...series, stop_after_day: '2026-10-30' }, changed, [], '2026-10-28', '08:00'), null);
});
