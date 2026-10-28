export function shanghaiParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function isDue(nowTime, sendAt, minutesAfter = 120) {
  if (!sendAt) return false;
  const toMinutes = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const delta = toMinutes(nowTime) - toMinutes(sendAt);
  return delta >= 0 && delta <= minutesAfter;
}

export function renderDigest(day, events) {
  const [, month, date] = day.split('-');
  const lines = [];
  for (const item of [...events].sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id))) {
    lines.push(`${item.start_time}${item.end_time ? `–${item.end_time}` : ''} ${item.title}`);
    if (item.note) lines.push(`  ${item.note}`);
  }
  lines.push('', `共 ${events.length} 项`);
  return { title: `今日安排 · ${Number(month)}月${Number(date)}日`, body: lines.join('\n') };
}

export function renderReminder(day, item) {
  const [, month, date] = day.split('-');
  const weekday = '日一二三四五六'[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const time = `${item.start_time}${item.end_time ? `—${item.end_time}` : ''}`;
  const lines = [`📅 ${Number(month)}月${Number(date)}日 · 周${weekday}`, `⏰ 任务时间：${time}`];
  if (item.remind_time !== item.start_time) lines.push(`🔔 提醒时间：${item.remind_time}`);
  if (item.note) lines.push(`📝 ${item.note}`);
  lines.push('', '记得留意这项安排 ✨');
  return { title: `安排提醒 · ${item.title}`, body: lines.join('\n') };
}

export function validateEvent(value) {
  const day = String(value?.day || '');
  const start_time = String(value?.start_time || '');
  const end_time = String(value?.end_time || '');
  const title = String(value?.title || '').trim();
  const note = String(value?.note || '').trim();
  const remind_time = String(value?.remind_time || '');
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  const validTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (!validDay || !validTime(start_time) || (end_time && (!validTime(end_time) || end_time <= start_time)) || (remind_time && !validTime(remind_time))) throw new Error('请填写有效的日期和时间；结束时间须晚于开始时间。');
  if (!title || title.length > 100 || note.length > 1000) throw new Error('标题必填且不超过 100 字；备注不超过 1000 字。');
  return { day, start_time, end_time: end_time || null, remind_time: remind_time || null, title, note };
}

export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function dayNumber(day) {
  if (!validDay(day)) throw new Error('日期无效。');
  return Date.parse(`${day}T00:00:00Z`) / 86400000;
}

export function cyclePosition(series, day) {
  const difference = dayNumber(day) - dayNumber(series.first_day);
  const interval = Number(series.interval_days);
  const count = Number(series.slots_per_cycle);
  if (difference < 0 || interval < 1 || count < 1 || difference % interval !== 0 ||
      (series.stop_after_day && day > series.stop_after_day)) return null;
  const occurrenceIndex = difference / interval;
  return { slot_index: occurrenceIndex % count, round: Math.floor(occurrenceIndex / count) + 1, occurrence_index: occurrenceIndex };
}

export function validateCycle(value) {
  const first_day = String(value?.first_day || '');
  const interval_days = Number(value?.interval_days);
  const slots = value?.slots;
  const title = String(value?.title || '').trim();
  const note = String(value?.note || '').trim();
  const stop_after_day = value?.stop_after_day ? String(value.stop_after_day) : null;
  if (!validDay(first_day) || !Number.isInteger(interval_days) || interval_days < 1 || interval_days > 365 ||
      !Array.isArray(slots) || slots.length < 1 || slots.length > 20 ||
      (stop_after_day && (!validDay(stop_after_day) || stop_after_day < first_day))) throw new Error('循环日期、间隔或时间组数无效。');
  if (!title || title.length > 100 || note.length > 1000) throw new Error('标题必填且不超过 100 字；备注不超过 1000 字。');
  const normalizedSlots = slots.map(slot => {
    const item = validateEvent({ day: first_day, start_time: slot.start_time, end_time: slot.end_time,
      remind_time: slot.remind_time, title: slot.title || title, note: slot.note || note });
    return { start_time: item.start_time, end_time: item.end_time, remind_time: item.remind_time,
      title: slot.title ? item.title : null, note: slot.note ? item.note : null };
  });
  return { first_day, interval_days, slots: normalizedSlots, title, note, stop_after_day };
}
