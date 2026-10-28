import { cyclePosition, dayNumber, shanghaiParts } from './core.js';

const all = async statement => (await statement.all()).results;
const dayFromNumber = number => new Date(number * 86400000).toISOString().slice(0, 10);
const upcoming = (day, time, today, nowTime) => day > today || (day === today && time >= nowTime);
const earlier = (a, b) => !a ? b : !b || `${a.day} ${a.time}` < `${b.day} ${b.time}` ? a : b;

export function nextSeriesReminder(series, versions, overrides, today, nowTime, sentKeys = new Set()) {
  const first = dayNumber(series.first_day);
  const todayNumber = dayNumber(today);
  const interval = Number(series.interval_days);
  const count = Number(series.slots_per_cycle);
  const last = series.stop_after_day ? dayNumber(series.stop_after_day) : Infinity;
  const overrideByDay = new Map(overrides.map(item => [item.day, item]));
  let best = null;

  for (const override of overrides) {
    if (override.skipped || !override.remind_time || !cyclePosition(series, override.day) ||
        !upcoming(override.day, override.remind_time, today, nowTime) ||
        sentKeys.has(`reminder:cycle:${series.id}:${override.day}`)) continue;
    best = earlier({ kind: 'cycle', source_id: series.id, day: override.day,
      time: override.remind_time, title: override.title }, best);
  }

  for (let v = 0; v < versions.length; v++) {
    const version = versions[v];
    const segmentStart = Math.max(first, todayNumber, dayNumber(version.effective_from_day));
    const segmentEnd = Math.min(last, versions[v + 1] ? dayNumber(versions[v + 1].effective_from_day) - 1 : Infinity);
    if (segmentStart > segmentEnd) continue;
    const firstIndex = Math.max(0, Math.ceil((segmentStart - first) / interval));
    for (const slot of version.slots) {
      if (!slot.remind_time) continue;
      let index = firstIndex + (Number(slot.slot_index) - firstIndex % count + count) % count;
      while (first + index * interval <= segmentEnd) {
        const day = dayFromNumber(first + index * interval);
        if (best && `${day} ${slot.remind_time}` >= `${best.day} ${best.time}`) break;
        if (upcoming(day, slot.remind_time, today, nowTime) && !overrideByDay.has(day) &&
            !sentKeys.has(`reminder:cycle:${series.id}:${day}`)) {
          best = earlier({ kind: 'cycle', source_id: series.id, day,
            time: slot.remind_time, title: slot.title_override || version.title }, best);
          break;
        }
        index += count;
      }
    }
  }
  return best;
}

export async function nextReminderFor(db, now = new Date()) {
  const { day: today, time: nowTime } = shanghaiParts(now);
  const single = await db.prepare(`SELECT e.id, e.day, e.remind_time, e.title FROM events e
    WHERE e.remind_time IS NOT NULL AND (e.day > ? OR (e.day = ? AND e.remind_time >= ?))
    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.key = 'reminder:single:' || e.id || ':' || e.day AND d.status = 'sent')
    ORDER BY e.day, e.remind_time, e.id LIMIT 1`).bind(today, today, nowTime).first();
  let best = single ? { kind: 'single', source_id: single.id, day: single.day,
    time: single.remind_time, title: single.title } : null;
  const sent = await all(db.prepare("SELECT key FROM deliveries WHERE day = ? AND kind = 'reminder' AND status = 'sent'").bind(today));
  const sentKeys = new Set(sent.map(row => row.key));
  const series = await all(db.prepare('SELECT id, first_day, interval_days, slots_per_cycle, stop_after_day FROM series WHERE stop_after_day IS NULL OR stop_after_day >= ?').bind(today));
  for (const group of series) {
    const rows = await all(db.prepare(`SELECT v.id AS version_id, v.effective_from_day, v.title, s.slot_index,
      s.remind_time, s.title_override FROM series_versions v JOIN cycle_slots s ON s.version_id = v.id
      WHERE v.series_id = ? ORDER BY v.effective_from_day, s.slot_index`).bind(group.id));
    const versions = [];
    for (const row of rows) {
      let version = versions[versions.length - 1];
      if (!version || version.id !== row.version_id) {
        version = { id: row.version_id, effective_from_day: row.effective_from_day, title: row.title, slots: [] };
        versions.push(version);
      }
      version.slots.push(row);
    }
    const overrides = await all(db.prepare('SELECT day, skipped, remind_time, title FROM occurrence_overrides WHERE series_id = ? AND day >= ? ORDER BY day').bind(group.id, today));
    best = earlier(nextSeriesReminder(group, versions, overrides, today, nowTime, sentKeys), best);
  }
  return best;
}
