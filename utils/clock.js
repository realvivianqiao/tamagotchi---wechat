// Local time for a family member in another city. Mini program JS engines can't be trusted with
// Intl time zones (some Android builds ship without them), so the daylight-saving rules are written out.

function nthSunday(year, month, n) { // month 0-based; n = 1..5, or -1 for the last Sunday
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

// Each rule returns the UTC offset in hours for a moment `t` (ms).
function usRule(std) { // DST: 2nd Sunday of March 2:00 local → 1st Sunday of November 2:00 local
  return (t) => {
    const y = new Date(t).getUTCFullYear();
    const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 2 - std);
    const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 2 - (std + 1));
    return t >= start && t < end ? std + 1 : std;
  };
}
function euRule(std) { // summer time: last Sunday of March → last Sunday of October, both 01:00 UTC
  return (t) => {
    const y = new Date(t).getUTCFullYear();
    const start = Date.UTC(y, 2, nthSunday(y, 2, -1), 1);
    const end = Date.UTC(y, 9, nthSunday(y, 9, -1), 1);
    return t >= start && t < end ? std + 1 : std;
  };
}
function sydneyRule(t) { // daylight: 1st Sunday of October 2:00 → 1st Sunday of April 3:00 (local)
  const y = new Date(t).getUTCFullYear();
  const end = Date.UTC(y, 3, nthSunday(y, 3, 1), 3 - 11);
  const start = Date.UTC(y, 9, nthSunday(y, 9, 1), 2 - 10);
  return t < end || t >= start ? 11 : 10;
}
const fixed = (h) => () => h;

// At most six: wx.showActionSheet shows six items.
const CITIES = [
  { id: 'ny', name: '纽约', offset: usRule(-5) },
  { id: 'sf', name: '旧金山', offset: usRule(-8) },
  { id: 'london', name: '伦敦', offset: euRule(0) },
  { id: 'beijing', name: '北京', offset: fixed(8) },
  { id: 'tokyo', name: '东京', offset: fixed(9) },
  { id: 'sydney', name: '悉尼', offset: sydneyRule },
];
const DEFAULT_CITY = 'ny';

function city(id) {
  return CITIES.find((c) => c.id === id) || CITIES.find((c) => c.id === DEFAULT_CITY);
}

/** Hour (0–23) and minute in that city right now. */
function localParts(cityId, now = Date.now()) {
  const c = city(cityId);
  const d = new Date(now + c.offset(now) * 3600 * 1000);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** "凌晨 2:10", "晚上 8:05" — how a parent would say the time. */
function sayTime(hour, minute) {
  const part = hour < 5 ? '凌晨' : hour < 8 ? '早上' : hour < 11 ? '上午' : hour < 13 ? '中午' : hour < 18 ? '下午' : '晚上';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${part} ${h12}:${String(minute).padStart(2, '0')}`;
}

/** Everything the friend card needs: "纽约 · 凌晨 2:10" and whether it's the middle of the night there. */
function describe(cityId, now = Date.now()) {
  const c = city(cityId);
  const { hour, minute } = localParts(cityId, now);
  return { city: c.name, time: sayTime(hour, minute), night: hour >= 23 || hour < 7 };
}

/** "下午 2:10" for a timestamp on this phone (log entries). Adds 昨天 / a date when it isn't today. */
function stamp(t, now = Date.now()) {
  const d = new Date(t), n = new Date(now);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const y = new Date(now - 86400000);
  const day = same(d, n) ? '今天' : same(d, y) ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${day} ${sayTime(d.getHours(), d.getMinutes())}`;
}

/** The city matching a phone's getTimezoneOffset() (minutes west of UTC), or null. */
function cityFromOffset(tzMinutes, now = Date.now()) {
  const c = CITIES.find((x) => Math.round(-x.offset(now) * 60) === Math.round(tzMinutes));
  return c ? c.id : null;
}

module.exports = { CITIES, DEFAULT_CITY, city, describe, sayTime, stamp, localParts, cityFromOffset };
