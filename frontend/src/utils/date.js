import { isHoliday as isPublicHoliday } from '@holiday-jp/holiday_jp';
export const JST_TIME_ZONE = 'Asia/Tokyo';
/**
 * 指定された日付が休日（土日または日本の祝日）であるかを判定します。
 * @param date - 判定する日付。
 * @returns 休日であればtrue、そうでなければfalse。
 */
export const isHoliday = (date) => {
    const day = date.getDay();
    // 0: Sunday, 6: Saturday
    if (day === 0 || day === 6) {
        return true;
    }
    // Check for public holidays
    return isPublicHoliday(date);
};
const jstDatePartFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: JST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const jstDateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});
const jstPartsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: JST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});
export const getTodayYmdJst = () => jstDatePartFormatter.format(new Date());
export const formatDateTimeJst = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value : '';
    }
    return jstDateTimeFormatter.format(date);
};
export const getNowJstParts = () => {
    const parts = jstPartsFormatter.formatToParts(new Date());
    const map = Object.fromEntries(parts
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]));
    return {
        year: Number(map.year),
        month: Number(map.month),
        day: Number(map.day),
        hour: Number(map.hour),
        minute: Number(map.minute),
        second: Number(map.second),
    };
};
export const getMinutesUntilJstHour = (targetHour24) => {
    const { hour, minute } = getNowJstParts();
    return (targetHour24 - hour) * 60 - minute;
};
//# sourceMappingURL=date.js.map