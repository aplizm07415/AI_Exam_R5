import { isHoliday as isPublicHoliday } from '@holiday-jp/holiday_jp';

/**
 * 指定された日付が休日（土日または日本の祝日）であるかを判定します。
 * @param date - 判定する日付。
 * @returns 休日であればtrue、そうでなければfalse。
 */
export const isHoliday = (date: Date): boolean => {
  const day = date.getDay();
  // 0: Sunday, 6: Saturday
  if (day === 0 || day === 6) {
    return true;
  }
  // Check for public holidays
  return isPublicHoliday(date);
};
