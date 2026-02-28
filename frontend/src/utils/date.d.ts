export declare const JST_TIME_ZONE = "Asia/Tokyo";
/**
 * 指定された日付が休日（土日または日本の祝日）であるかを判定します。
 * @param date - 判定する日付。
 * @returns 休日であればtrue、そうでなければfalse。
 */
export declare const isHoliday: (date: Date) => boolean;
export declare const getTodayYmdJst: () => string;
export declare const formatDateTimeJst: (value: string | Date) => string;
export declare const getNowJstParts: () => {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};
export declare const getMinutesUntilJstHour: (targetHour24: number) => number;
//# sourceMappingURL=date.d.ts.map