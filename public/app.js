const $ = id => document.getElementById(id);
const state = { day: '', month: '', calendar: null, events: [], settings: null, config: null, editing: null, slots: [], initialized: false, followReminder: true };
const defaultTimes = ['09:00', '10:00', '13:30'];
const channelName = () => state.settings?.notification_channel === 'pushdeer' ? 'PushDeer'
  : state.settings?.notification_channel === 'wecom_robot' ? '企业微信群机器人'
  : state.settings?.notification_channel === 'wecom' ? '企业微信' : '微信';

function setTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (dark ? 'dark' : 'light')));
  });
  try { localStorage.setItem('schedule-theme', dark ? 'dark' : 'light'); } catch { /* 浏览器禁用存储时仍可切换 */ }
}

function todayShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function timeShanghai() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

function shiftDay(day, amount) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}

function shiftMonth(day, amount) {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const month = date.toISOString().slice(0, 7);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return `${month}-${String(Math.min(Number(day.slice(8)), date.getUTCDate())).padStart(2, '0')}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(result.error || `请求失败（${response.status}）`);
  }
  return result;
}

function json(method, body) { return { method, body: JSON.stringify(body) }; }

function showLogin() { $('appView').hidden = true; $('loginView').hidden = false; }
function showApp() { $('loginView').hidden = true; $('appView').hidden = false; }

function notice(message, isError = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error-notice', isError);
  $('notice').hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => { $('notice').hidden = true; }, 6000);
}

function create(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function actionButton(label, className, onClick) {
  const button = create('button', `action-button ${className}`, label);
  button.type = 'button';
  button.onclick = onClick;
  return button;
}

function renderCalendar() {
  const calendar = state.calendar;
  if (!calendar || calendar.month !== state.month) return;
  const [year, month] = state.month.split('-');
  $('monthLabel').textContent = `${year} 年 ${Number(month)} 月`;
  const monthTotal = Object.entries(calendar.counts).reduce((sum, [day, count]) =>
    sum + (day.startsWith(state.month) ? Number(count) : 0), 0);
  $('monthSummary').textContent = `本月共 ${monthTotal} 项安排 · 悬停日期查看任务数`;
  const grid = $('calendarGrid');
  grid.replaceChildren();
  const days = Math.round((Date.parse(`${calendar.end}T00:00:00Z`) - Date.parse(`${calendar.start}T00:00:00Z`)) / 86400000) + 1;
  for (let i = 0; i < days; i++) {
    const day = shiftDay(calendar.start, i);
    const count = Number(calendar.counts[day] || 0);
    const button = create('button', 'calendar-day');
    button.type = 'button';
    button.dataset.tooltip = `${count} 项安排`;
    button.setAttribute('aria-label', `${day}，${count} 项安排`);
    button.setAttribute('aria-pressed', String(day === state.day));
    if (!day.startsWith(state.month)) button.classList.add('outside');
    if (day === state.day) button.classList.add('selected');
    if (day === todayShanghai()) button.classList.add('today');
    if (count) button.classList.add('has-events');
    button.append(create('span', 'calendar-number', String(Number(day.slice(8)))));
    if (count) button.append(create('span', 'calendar-dot'));
    button.onclick = () => selectDay(day);
    grid.append(button);
  }
}

async function loadCalendar() {
  const month = state.month;
  const calendar = await api(`/api/calendar?month=${encodeURIComponent(month)}`);
  if (state.month !== month) return;
  state.calendar = calendar;
  renderCalendar();
}

async function selectDay(day) {
  if (!day) return;
  const monthChanged = day.slice(0, 7) !== state.month;
  state.day = day;
  state.month = day.slice(0, 7);
  resetForm();
  try {
    if (monthChanged) await loadCalendar();
    await loadDay();
  } catch (error) { notice(error.message, true); }
}

function renderEvents() {
  const list = $('eventsList');
  list.replaceChildren();
  $('eventCount').textContent = `${state.events.length} 项安排`;
  $('listDate').textContent = state.day;
  $('dayCaption').textContent = state.day === todayShanghai() ? '今天' : '当前选择';
  $('selectedDateLabel').textContent = state.day;
  renderCalendar();
  if (!state.events.length) {
    const empty = create('div', 'empty');
    empty.append(create('strong', '', '这天还没有安排'), create('span', '', '可以在右侧新增一项。'));
    list.append(empty);
    return;
  }
  for (const item of state.events) {
    const row = create('article', 'event-row');
    const top = create('div', 'event-top');
    top.append(create('div', 'event-time', item.start_time));
    const main = create('div', 'event-main');
    const heading = create('div', 'event-heading');
    heading.append(create('strong', '', item.title));
    if (item.kind === 'cycle') heading.append(create('span', 'event-meta', `第 ${item.slot_index + 1}/${item.slots_per_cycle} 组 · 第 ${item.round} 轮`));
    main.append(heading);
    const details = create('div', 'event-details');
    if (item.end_time) details.append(create('span', 'event-detail', `结束 ${item.end_time}`));
    details.append(create('span', `event-reminder${item.remind_time ? '' : ' off'}`,
      item.remind_time ? `${channelName()}提醒 ${item.remind_time}` : '仅每日汇总'));
    if (item.note) details.append(create('p', 'event-note', item.note));
    main.append(details);
    top.append(main);
    row.append(top);
    const actions = create('div', 'event-actions');
    if (item.kind === 'cycle') {
      actions.append(
        actionButton('编辑本次', 'action-edit', () => editOccurrence(item)),
        actionButton('编辑循环', 'action-template', () => editTemplate(item.series_id)),
        actionButton('跳过本次', 'action-skip', () => removeItem(item, 'skip')),
        actionButton('停止循环', 'action-stop', () => removeItem(item, 'stop'))
      );
    } else {
      actions.append(
        actionButton('编辑安排', 'action-edit', () => editSingle(item)),
        actionButton('删除安排', 'action-stop', () => removeItem(item, 'single'))
      );
    }
    row.append(actions);
    list.append(row);
  }
}

function renderStatus(deliveries) {
  const digest = deliveries.find(x => x.kind === 'digest');
  let label = '尚未发送';
  if (digest?.status === 'sent') label = `已发送 · ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date(digest.sent_at))}`;
  if (digest?.status === 'sending') label = '发送中';
  if (digest?.status === 'failed') label = `发送失败：${digest.last_error || '请查看日志'}`;
  $('selectedDayStatus').textContent = `${state.day} 的每日汇总：${label}`;
}

function updateNextDigestCard() {
  if (!state.settings) return;
  const today = todayShanghai();
  const nextDay = timeShanghai() < state.settings.send_at ? today : shiftDay(today, 1);
  $('nextSend').textContent = `${state.settings.send_at} 北京时间`;
  $('sendStatus').textContent = `${nextDay} · 尚未发送`;
}

async function loadDay() {
  if (!state.day) return;
  $('selectedDay').value = state.day;
  const day = encodeURIComponent(state.day);
  const [events, preview, status] = await Promise.all([
    api(`/api/events?day=${day}`), api(`/api/preview?day=${day}`), api(`/api/status?day=${day}`)
  ]);
  state.events = events.events;
  renderEvents();
  $('messagePreview').textContent = `${preview.message.title}\n\n${preview.message.body}`;
  renderStatus(status.deliveries);
}

function setType(type) {
  $('eventType').value = type;
  $('singleFields').hidden = type !== 'single';
  $('cycleFields').hidden = type !== 'cycle';
  if (type === 'cycle') renderSlots();
}

function setSingleReminderEnabled(enabled) {
  $('remindEnabled').checked = enabled;
  $('remindTime').disabled = !enabled;
  $('remindTimeField').classList.toggle('is-disabled', !enabled);
  if (!enabled) {
    $('remindTime').value = '';
    state.followReminder = false;
  } else if (!$('remindTime').value) {
    $('remindTime').value = $('startTime').value;
    state.followReminder = true;
  }
}

function resetForm() {
  state.editing = null;
  $('eventForm').reset();
  $('eventType').disabled = false;
  $('eventDay').disabled = false;
  $('firstDay').disabled = false;
  $('intervalDays').disabled = false;
  $('slotCount').disabled = false;
  $('eventDay').value = state.day || todayShanghai();
  $('firstDay').value = state.day || todayShanghai();
  $('startTime').value = '09:00';
  $('remindTime').value = '09:00';
  state.followReminder = true;
  setSingleReminderEnabled(true);
  $('formTitle').textContent = '新增安排';
  $('saveButton').textContent = '保存安排';
  $('cancelEdit').hidden = true;
  $('formError').textContent = '';
  state.slots = defaultTimes.map(time => ({ start_time: time, end_time: '', remind_time: time, title: '', note: '' }));
  $('slotRows').replaceChildren();
  setType('single');
}

function editSingle(item) {
  resetForm(); state.editing = { kind: 'single', id: item.id };
  $('formTitle').textContent = '编辑安排'; $('saveButton').textContent = '保存修改'; $('cancelEdit').hidden = false;
  $('title').value = item.title; $('note').value = item.note || ''; $('eventDay').value = item.day;
  $('startTime').value = item.start_time; $('endTime').value = item.end_time || ''; $('remindTime').value = item.remind_time || '';
  state.followReminder = $('remindTime').value === $('startTime').value;
  setSingleReminderEnabled(Boolean(item.remind_time));
  $('title').focus();
}

function editOccurrence(item) {
  editSingle(item);
  state.editing = { kind: 'occurrence', seriesId: item.series_id, day: item.day };
  $('formTitle').textContent = '仅编辑这一次'; $('eventType').disabled = true; $('eventDay').disabled = true;
}

async function editTemplate(id) {
  try {
    const item = await api(`/api/series/${id}`);
    resetForm(); state.editing = { kind: 'template', id };
    $('formTitle').textContent = '编辑循环模板'; $('saveButton').textContent = '保存未来轮次'; $('cancelEdit').hidden = false;
    $('title').value = item.title; $('note').value = item.note || ''; $('firstDay').value = item.first_day;
    $('intervalDays').value = item.interval_days; $('slotCount').value = item.slots_per_cycle;
    $('firstDay').disabled = true; $('intervalDays').disabled = true; $('slotCount').disabled = true;
    $('eventType').disabled = true; $('endMode').value = item.stop_after_day ? 'date' : 'never';
    $('stopDay').value = item.stop_after_day || ''; $('stopDayField').hidden = !item.stop_after_day;
    state.slots = item.slots.map(x => ({ start_time: x.start_time, end_time: x.end_time || '', remind_time: x.remind_time || '', title: x.title || '', note: x.note || '' }));
    setType('cycle'); $('title').focus();
  } catch (error) { notice(error.message, true); }
}

async function removeItem(item, action) {
  const descriptions = { single: `删除「${item.title}」？`, skip: `仅跳过 ${item.day} 的「${item.title}」？`, stop: `停止「${item.title}」的后续循环？` };
  if (!confirm(descriptions[action])) return;
  const path = action === 'single' ? `/api/events/${item.id}` : action === 'skip'
    ? `/api/series/${item.series_id}/occurrences/${item.day}` : `/api/series/${item.series_id}`;
  try { await api(path, { method: 'DELETE' }); notice('已更新安排。'); resetForm(); await Promise.all([loadDay(), loadCalendar(), loadNextReminder()]); }
  catch (error) { notice(error.message, true); }
}

function captureSlots() {
  for (const row of $('slotRows').children) {
    const i = Number(row.dataset.index);
    state.slots[i] = {
      start_time: row.querySelector('[data-field="start_time"]').value,
      end_time: row.querySelector('[data-field="end_time"]').value,
      remind_time: row.querySelector('[data-field="remind_time"]').value,
      title: row.querySelector('[data-field="title"]').value,
      note: row.querySelector('[data-field="note"]').value
    };
  }
}

function renderSlots() {
  captureSlots();
  const count = Math.max(1, Math.min(20, Number($('slotCount').value) || 1));
  while (state.slots.length < count) {
    const time = defaultTimes[state.slots.length] || '09:00';
    state.slots.push({ start_time: time, end_time: '', remind_time: time, title: '', note: '' });
  }
  state.slots.length = count;
  const host = $('slotRows'); host.replaceChildren();
  state.slots.forEach((slot, i) => {
    const row = create('div', 'slot-row'); row.dataset.index = i;
    row.append(create('strong', '', `第 ${i + 1} 组时间`));
    const first = create('div', 'field-row');
    first.append(slotField('任务开始', 'start_time', slot.start_time, 'time'), slotField('任务结束', 'end_time', slot.end_time, 'time'));
    const second = create('div', 'field-row');
    second.append(slotField('提醒时间', 'remind_time', slot.remind_time, 'time'), slotField('标题覆盖', 'title', slot.title, 'text'));
    const reminderToggle = create('label', 'check-line slot-remind-toggle');
    const reminderCheckbox = document.createElement('input');
    reminderCheckbox.type = 'checkbox';
    reminderCheckbox.checked = Boolean(slot.remind_time);
    reminderToggle.append(reminderCheckbox, create('span', '', '单独发送提醒'));
    row.append(first, reminderToggle, second, slotField('备注覆盖', 'note', slot.note, 'text'));
    const startInput = row.querySelector('[data-field="start_time"]');
    const remindInput = row.querySelector('[data-field="remind_time"]');
    remindInput.disabled = !reminderCheckbox.checked;
    let followReminder = remindInput.value === startInput.value;
    startInput.addEventListener('input', () => {
      if (reminderCheckbox.checked && followReminder) remindInput.value = startInput.value;
      captureSlots(); renderCyclePreview();
    });
    remindInput.addEventListener('input', () => { followReminder = remindInput.value === startInput.value; });
    reminderCheckbox.addEventListener('change', () => {
      remindInput.disabled = !reminderCheckbox.checked;
      remindInput.value = reminderCheckbox.checked ? startInput.value : '';
      followReminder = reminderCheckbox.checked;
      captureSlots(); renderCyclePreview();
    });
    row.querySelectorAll('input:not([data-field="start_time"])').forEach(input => input.addEventListener('input', () => { captureSlots(); renderCyclePreview(); }));
    host.append(row);
  });
  renderCyclePreview();
}

function slotField(labelText, field, value, type) {
  const label = create('label', '', labelText);
  const input = document.createElement('input'); input.type = type; input.value = value || ''; input.dataset.field = field;
  if (field === 'title') input.maxLength = 100;
  if (field === 'note') input.maxLength = 1000;
  label.append(input); return label;
}

function renderCyclePreview() {
  const start = $('firstDay').value, interval = Number($('intervalDays').value);
  const host = $('cyclePreview'); host.replaceChildren();
  if (!start || !Number.isInteger(interval) || interval < 1 || !state.slots.length) return;
  for (let i = 0; i < Math.min(state.slots.length * 2, 40); i++) {
    const slot = state.slots[i % state.slots.length];
    const day = shiftDay(start, i * interval);
    if ($('endMode').value === 'date' && $('stopDay').value && day > $('stopDay').value) break;
    host.append(create('div', '', `${day} · 第 ${i % state.slots.length + 1} 组 · 任务 ${slot.start_time || '未设置'} · 提醒 ${slot.remind_time || '关闭'}`));
  }
}

function formValue() {
  const common = { title: $('title').value, note: $('note').value };
  if ($('eventType').value === 'single') return { ...common, day: $('eventDay').value,
    start_time: $('startTime').value, end_time: $('endTime').value,
    remind_time: $('remindEnabled').checked ? $('remindTime').value : '' };
  captureSlots();
  return { ...common, first_day: $('firstDay').value, interval_days: Number($('intervalDays').value),
    stop_after_day: $('endMode').value === 'date' ? $('stopDay').value : null,
    slots: state.slots };
}

async function saveEvent(event) {
  event.preventDefault(); $('formError').textContent = '';
  const data = formValue(); const button = $('saveButton'); button.disabled = true;
  try {
    if (state.editing?.kind === 'single') await api(`/api/events/${state.editing.id}`, json('PUT', data));
    else if (state.editing?.kind === 'occurrence') await api(`/api/series/${state.editing.seriesId}/occurrences/${state.editing.day}`, json('PUT', data));
    else if (state.editing?.kind === 'template') await api(`/api/series/${state.editing.id}/template`, json('PUT', data));
    else if ($('eventType').value === 'cycle') await api('/api/series', json('POST', data));
    else await api('/api/events', json('POST', data));
    if (!state.editing || state.editing.kind === 'single') state.day = data.day || data.first_day || state.day;
    state.month = state.day.slice(0, 7);
    notice('安排已保存。'); resetForm(); await Promise.all([loadDay(), loadCalendar(), loadNextReminder()]);
  } catch (error) { $('formError').textContent = error.message; }
  finally { button.disabled = false; }
}

function updateChannelStatus() {
  const channel = $('notificationChannel').value;
  const isWecom = channel === 'wecom';
  $('wecomChannelField').hidden = !isWecom;
  $('wecomChannelHint').hidden = !isWecom;
  const ready = isWecom ? Boolean(state.config?.channels?.serverchan && /^\d{1,20}$/.test($('wecomChannelId').value.trim()))
    : Boolean(state.config?.channels?.[channel]);
  const label = channel === 'pushdeer' ? 'PushDeer' : channel === 'wecom_robot' ? '企业微信群机器人'
    : isWecom ? '企业微信应用消息' : '微信（Server酱）';
  $('channelStatus').textContent = `${label}${ready ? '已配置，可以发送测试通知'
    : isWecom ? '需要 Server酱密钥和企业微信通道编号' : channel === 'wecom_robot' ? '尚未配置 WebHook' : '尚未配置密钥'}`;
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  $('notificationChannel').value = state.settings.notification_channel;
  $('wecomChannelId').value = state.settings.wecom_channel_id || '';
  $('sendAt').value = state.settings.send_at;
  $('sendEmpty').checked = Boolean(state.settings.send_empty);
  $('remindersEnabled').checked = Boolean(state.settings.reminders_enabled);
  $('dailyLimit').value = state.settings.daily_limit;
  updateNextDigestCard();
  state.config = await api('/api/config');
  updateChannelStatus();
  $('reminderCardLabel').textContent = `下一条${channelName()}提醒`;
  $('reminderCardFoot').textContent = `${state.settings.notification_channel === 'pushdeer' ? 'PUSHDEER'
    : state.settings.notification_channel === 'wecom_robot' ? 'WECOM GROUP'
    : state.settings.notification_channel === 'wecom' ? 'WECOM' : 'WECHAT'} · INDIVIDUAL REMINDER`;
  renderEvents();
  await loadNextReminder();
}

async function loadNextReminder() {
  const card = document.querySelector('.reminder-card');
  try {
    const result = await api('/api/next-reminder');
    card.classList.toggle('is-empty', !result.next);
    if (!result.enabled) {
      $('nextReminderTime').textContent = '单次提醒已关闭';
      $('nextReminderDetail').textContent = '可在设置中重新开启';
    } else if (result.next) {
      $('nextReminderTime').textContent = `${result.next.time} 北京时间`;
      $('nextReminderDetail').textContent = `${result.next.day} · ${result.next.title}`;
    } else {
      $('nextReminderTime').textContent = '暂无待提醒安排';
      $('nextReminderDetail').textContent = '为任务开启单独提醒后显示';
    }
  } catch {
    card.classList.add('is-empty');
    $('nextReminderTime').textContent = '暂时无法读取';
    $('nextReminderDetail').textContent = '稍后刷新页面重试';
  }
}

async function saveSettings(event) {
  event.preventDefault(); $('settingsError').textContent = '';
  try {
    await api('/api/settings', json('PUT', { notification_channel: $('notificationChannel').value,
      wecom_channel_id: $('wecomChannelId').value.trim(), send_at: $('sendAt').value,
      send_empty: $('sendEmpty').checked, reminders_enabled: $('remindersEnabled').checked,
      daily_limit: Number($('dailyLimit').value) }));
    await loadSettings(); $('settingsDialog').close(); notice('设置已保存。');
  } catch (error) { $('settingsError').textContent = error.message; }
}

async function start() {
  setTheme(document.documentElement.dataset.theme);
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.onclick = () => setTheme(button.dataset.themeChoice);
  });
  state.day = todayShanghai();
  state.month = state.day.slice(0, 7);
  $('selectedDay').value = state.day;
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); $('loginError').textContent = '';
    try { await api('/api/login', json('POST', { password: $('password').value })); $('password').value = ''; showApp(); await Promise.all([loadSettings(), loadDay(), loadCalendar()]); if (!state.initialized) resetForm(); state.initialized = true; }
    catch (error) { $('loginError').textContent = error.message; }
  });
  $('logoutButton').onclick = async () => { await api('/api/logout', { method: 'POST' }); showLogin(); };
  $('selectedDay').onchange = () => selectDay($('selectedDay').value);
  $('prevMonth').onclick = () => selectDay(shiftMonth(state.day, -1));
  $('nextMonth').onclick = () => selectDay(shiftMonth(state.day, 1));
  $('todayButton').onclick = () => selectDay(todayShanghai());
  $('eventType').onchange = () => setType($('eventType').value);
  $('startTime').addEventListener('input', () => {
    if ($('remindEnabled').checked && state.followReminder) $('remindTime').value = $('startTime').value;
  });
  $('remindEnabled').addEventListener('change', () => setSingleReminderEnabled($('remindEnabled').checked));
  $('remindTime').addEventListener('input', () => {
    state.followReminder = $('remindTime').value === $('startTime').value;
  });
  $('slotCount').onchange = renderSlots;
  $('intervalDays').oninput = renderCyclePreview;
  $('firstDay').onchange = renderCyclePreview;
  $('endMode').onchange = () => { $('stopDayField').hidden = $('endMode').value !== 'date'; renderCyclePreview(); };
  $('stopDay').onchange = renderCyclePreview;
  $('cancelEdit').onclick = resetForm;
  $('eventForm').onsubmit = saveEvent;
  $('settingsButton').onclick = () => $('settingsDialog').showModal();
  $('closeSettings').onclick = () => $('settingsDialog').close();
  $('settingsForm').onsubmit = saveSettings;
  $('notificationChannel').onchange = updateChannelStatus;
  $('wecomChannelId').oninput = updateChannelStatus;
  setInterval(() => { if (!$('appView').hidden) { loadNextReminder(); updateNextDigestCard(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('appView').hidden) updateNextDigestCard(); });
  $('testPush').onclick = async () => {
    const channel = $('notificationChannel').value;
    const label = channel === 'pushdeer' ? 'PushDeer' : channel === 'wecom_robot' ? '企业微信群机器人'
      : channel === 'wecom' ? '企业微信' : '微信';
    if (!confirm(`向${label}发送一条真实测试通知？`)) return;
    $('settingsError').textContent = '';
    try { await api('/api/test', json('POST', { channel, wecom_channel_id: $('wecomChannelId').value.trim() })); notice('测试通知已提交。'); }
    catch (error) { $('settingsError').textContent = error.message; }
  };
  try { await api('/api/session'); showApp(); await Promise.all([loadSettings(), loadDay(), loadCalendar()]); resetForm(); state.initialized = true; }
  catch { showLogin(); }
}

start();
