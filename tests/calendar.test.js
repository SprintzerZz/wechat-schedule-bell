import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarCountsFromRows, calendarRange } from '../src/schedule.js';

test('月历以周一开始，包含首尾相邻日期', () => {
  assert.deepEqual(calendarRange('2026-10'), { start: '2026-09-28', end: '2026-11-01' });
  assert.throws(() => calendarRange('2026-13'));
});

test('月历任务数合并单次与循环，并扣除跳过的本次', () => {
  const range = calendarRange('2026-10');
  const counts = calendarCountsFromRows(range,
    [{ day: '2026-10-28', count: 2 }, { day: '2026-10-29', count: 1 }],
    [{ id: 'series-1', first_day: '2026-10-28', interval_days: 3,
      slots_per_cycle: 3, stop_after_day: null }],
    [{ series_id: 'series-1', day: '2026-10-31' }]);
  assert.equal(counts['2026-10-28'], 3);
  assert.equal(counts['2026-10-29'], 1);
  assert.equal(counts['2026-10-31'] || 0, 0);
});
