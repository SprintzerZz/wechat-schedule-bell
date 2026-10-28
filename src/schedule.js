import { cyclePosition, shanghaiParts, validateCycle, validateEvent, validDay } from './core.js';

const all = async (stmt) => (await stmt.all()).results;

export async function settingsFor(db) {
  return db.prepare('SELECT send_at, send_empty, reminders_enabled, daily_limit, notification_channel, wecom_channel_id FROM settings WHERE id = 1').first();
}

export async function eventsFor(db, day) {
  if (!validDay(day)) throw new Error('日期无效。');
  const singles = await all(db.prepare('SELECT id, day, start_time, end_time, remind_time, title, note FROM events WHERE day = ?').bind(day));
  const result = singles.map(item => ({ ...item, kind: 'single', source_id: item.id }));
  const series = await all(db.prepare('SELECT * FROM series WHERE first_day <= ? AND (stop_after_day IS NULL OR stop_after_day >= ?)').bind(day, day));
  for (const group of series) {
    const position = cyclePosition(group, day);
    if (!position) continue;
    const override = await db.prepare('SELECT * FROM occurrence_overrides WHERE series_id = ? AND day = ?').bind(group.id, day).first();
    if (override?.skipped) continue;
    const version = await db.prepare('SELECT * FROM series_versions WHERE series_id = ? AND effective_from_day <= ? ORDER BY effective_from_day DESC LIMIT 1').bind(group.id, day).first();
    if (!version) continue;
    const slot = await db.prepare('SELECT * FROM cycle_slots WHERE version_id = ? AND slot_index = ?').bind(version.id, position.slot_index).first();
    if (!slot) continue;
    result.push({ id: `${group.id}:${day}`, source_id: group.id, series_id: group.id, day,
      kind: 'cycle', slot_index: position.slot_index, slots_per_cycle: group.slots_per_cycle, round: position.round,
      start_time: override ? override.start_time : slot.start_time,
      end_time: override ? override.end_time : slot.end_time,
      remind_time: override ? override.remind_time : slot.remind_time,
      title: override ? override.title : slot.title_override ?? version.title,
      note: override ? override.note : slot.note_override ?? version.note });
  }
  return result.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id));
}

export function calendarRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validDay(`${month}-01`)) throw new Error('月份无效。');
  const first = Date.parse(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * 86400000;
  const end = last.getTime() + (7 - last.getUTCDay()) % 7 * 86400000;
  return { start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) };
}

export function calendarCountsFromRows(range, singles, series, skips) {
  const counts = {};
  for (const row of singles) counts[row.day] = Number(row.count);
  const skipped = new Set(skips.map(row => `${row.series_id}:${row.day}`));
  for (const group of series) {
    for (let number = Date.parse(`${range.start}T00:00:00Z`); number <= Date.parse(`${range.end}T00:00:00Z`); number += 86400000) {
      const day = new Date(number).toISOString().slice(0, 10);
      if (cyclePosition(group, day) && !skipped.has(`${group.id}:${day}`)) counts[day] = (counts[day] || 0) + 1;
    }
  }
  return counts;
}

export async function calendarFor(db, month) {
  const range = calendarRange(month);
  const [singles, series, skips] = await Promise.all([
    all(db.prepare('SELECT day, COUNT(*) AS count FROM events WHERE day BETWEEN ? AND ? GROUP BY day').bind(range.start, range.end)),
    all(db.prepare('SELECT id, first_day, interval_days, slots_per_cycle, stop_after_day FROM series WHERE first_day <= ? AND (stop_after_day IS NULL OR stop_after_day >= ?)').bind(range.end, range.start)),
    all(db.prepare('SELECT series_id, day FROM occurrence_overrides WHERE skipped = 1 AND day BETWEEN ? AND ?').bind(range.start, range.end))
  ]);
  return { month, ...range, counts: calendarCountsFromRows(range, singles, series, skips) };
}

export async function createSingle(db, input) {
  const item = validateEvent(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO events (id, day, start_time, end_time, remind_time, title, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, item.day, item.start_time, item.end_time,
    item.remind_time, item.title, item.note, now, now).run();
  return id;
}

export async function updateSingle(db, id, input) {
  const item = validateEvent(input);
  const result = await db.prepare(`UPDATE events SET day = ?, start_time = ?, end_time = ?, remind_time = ?, title = ?, note = ?, updated_at = ? WHERE id = ?`)
    .bind(item.day, item.start_time, item.end_time, item.remind_time, item.title, item.note, new Date().toISOString(), id).run();
  return result.meta.changes > 0;
}

export async function createSeries(db, input) {
  const item = validateCycle(input);
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`INSERT INTO series (id, first_day, interval_days, slots_per_cycle, stop_after_day, title, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, item.first_day, item.interval_days, item.slots.length, item.stop_after_day, item.title, item.note, now),
    db.prepare('INSERT INTO series_versions (id, series_id, effective_from_day, title, note) VALUES (?, ?, ?, ?, ?)')
      .bind(versionId, id, item.first_day, item.title, item.note),
    ...item.slots.map((slot, index) => db.prepare(`INSERT INTO cycle_slots
      (version_id, slot_index, start_time, end_time, remind_time, title_override, note_override) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(versionId, index, slot.start_time, slot.end_time, slot.remind_time, slot.title, slot.note))
  ];
  await db.batch(statements);
  return id;
}

export async function getSeries(db, id) {
  const series = await db.prepare('SELECT * FROM series WHERE id = ?').bind(id).first();
  if (!series) return null;
  const version = await db.prepare('SELECT * FROM series_versions WHERE series_id = ? ORDER BY effective_from_day DESC LIMIT 1').bind(id).first();
  const slots = await all(db.prepare('SELECT * FROM cycle_slots WHERE version_id = ? ORDER BY slot_index').bind(version.id));
  return { ...series, title: version.title, note: version.note, slots: slots.map(slot => ({
    start_time: slot.start_time, end_time: slot.end_time, remind_time: slot.remind_time,
    title: slot.title_override, note: slot.note_override
  })) };
}

export async function updateSeriesTemplate(db, id, input) {
  const series = await db.prepare('SELECT * FROM series WHERE id = ?').bind(id).first();
  if (!series) return false;
  const item = validateCycle({ ...input, first_day: series.first_day, interval_days: series.interval_days });
  if (item.slots.length !== series.slots_per_cycle) throw new Error('已有循环不能修改时间组数；请停止后新建。');
  const today = shanghaiParts(new Date()).day;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const effective = tomorrow > series.first_day ? tomorrow : series.first_day;
  const existing = await db.prepare('SELECT id FROM series_versions WHERE series_id = ? AND effective_from_day = ?').bind(id, effective).first();
  const versionId = existing?.id || crypto.randomUUID();
  await db.batch([
    ...(existing ? [
      db.prepare('DELETE FROM cycle_slots WHERE version_id = ?').bind(versionId),
      db.prepare('UPDATE series_versions SET title = ?, note = ? WHERE id = ?').bind(item.title, item.note, versionId)
    ] : [
      db.prepare('INSERT INTO series_versions (id, series_id, effective_from_day, title, note) VALUES (?, ?, ?, ?, ?)')
        .bind(versionId, id, effective, item.title, item.note)
    ]),
    ...item.slots.map((slot, index) => db.prepare(`INSERT INTO cycle_slots
      (version_id, slot_index, start_time, end_time, remind_time, title_override, note_override) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(versionId, index, slot.start_time, slot.end_time, slot.remind_time, slot.title, slot.note))
  ]);
  await db.prepare('UPDATE series SET stop_after_day = ? WHERE id = ?').bind(item.stop_after_day, id).run();
  return true;
}

export async function overrideOccurrence(db, seriesId, day, input) {
  if (!validDay(day)) throw new Error('日期无效。');
  const series = await db.prepare('SELECT * FROM series WHERE id = ?').bind(seriesId).first();
  if (!series || !cyclePosition(series, day)) return false;
  const item = validateEvent({ ...input, day });
  await db.prepare(`INSERT INTO occurrence_overrides
    (series_id, day, skipped, start_time, end_time, remind_time, title, note)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(series_id, day) DO UPDATE SET skipped = 0, start_time = excluded.start_time,
    end_time = excluded.end_time, remind_time = excluded.remind_time, title = excluded.title, note = excluded.note`)
    .bind(seriesId, day, item.start_time, item.end_time, item.remind_time, item.title, item.note).run();
  return true;
}

export async function skipOccurrence(db, seriesId, day) {
  if (!validDay(day)) throw new Error('日期无效。');
  const series = await db.prepare('SELECT * FROM series WHERE id = ?').bind(seriesId).first();
  if (!series || !cyclePosition(series, day)) return false;
  await db.prepare(`INSERT INTO occurrence_overrides (series_id, day, skipped) VALUES (?, ?, 1)
    ON CONFLICT(series_id, day) DO UPDATE SET skipped = 1`).bind(seriesId, day).run();
  return true;
}

export async function stopSeries(db, id) {
  const yesterday = new Date((Date.parse(`${shanghaiParts(new Date()).day}T00:00:00Z`) - 86400000)).toISOString().slice(0, 10);
  const result = await db.prepare('UPDATE series SET stop_after_day = ? WHERE id = ?').bind(yesterday, id).run();
  return result.meta.changes > 0;
}
