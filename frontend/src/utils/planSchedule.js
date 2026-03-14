import { isHoliday } from './date';
const formatDateYmd = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};
const parseDate = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y ?? 1970, ((m ?? 1) || 1) - 1, (d ?? 1) || 1);
};
const toDayStart = (date) => {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
};
export const buildPlanSchedule = (plans, actualsByDate, todayYmd) => {
    const activePlans = plans.filter((p) => p.enabled);
    if (activePlans.length === 0) {
        return { rows: [], debtToRedistribute: 0, extraPerDay: 0 };
    }
    const allDates = new Set();
    const baseDailyMap = new Map();
    const adjustableDailyMap = new Map();
    for (const plan of activePlans) {
        if (!plan.period?.from || !plan.period?.to)
            continue;
        let current = toDayStart(parseDate(plan.period.from));
        const end = toDayStart(parseDate(plan.period.to));
        const minimumDaily = Math.max(0, plan.minimumDaily ?? 0);
        const autoRedistribute = plan.autoRedistribute !== false;
        while (current.getTime() <= end.getTime()) {
            const dateKey = formatDateYmd(current);
            allDates.add(dateKey);
            const holiday = isHoliday(current);
            let dailyGoal = 0;
            const applies = plan.applyDays === 'all' ||
                (plan.applyDays === 'holiday' && holiday) ||
                (plan.applyDays === 'weekday' && !holiday);
            if (applies) {
                dailyGoal = holiday ? plan.dailyGoal.holiday : plan.dailyGoal.weekday;
                dailyGoal = Math.max(dailyGoal, minimumDaily);
            }
            if (dailyGoal > 0) {
                baseDailyMap.set(dateKey, (baseDailyMap.get(dateKey) ?? 0) + dailyGoal);
                if (autoRedistribute) {
                    adjustableDailyMap.set(dateKey, (adjustableDailyMap.get(dateKey) ?? 0) + dailyGoal);
                }
            }
            current.setDate(current.getDate() + 1);
        }
    }
    if (allDates.size === 0) {
        return { rows: [], debtToRedistribute: 0, extraPerDay: 0 };
    }
    const sortedDates = Array.from(allDates).sort();
    const debtToRedistribute = Math.max(0, sortedDates
        .filter((d) => d < todayYmd)
        .reduce((acc, date) => acc + (baseDailyMap.get(date) ?? 0) - (actualsByDate.get(date) ?? 0), 0));
    const remainingAdjustableDates = sortedDates.filter((d) => d >= todayYmd && (adjustableDailyMap.get(d) ?? 0) > 0);
    const remainingAdjustableDateSet = new Set(remainingAdjustableDates);
    const extraPerDay = debtToRedistribute > 0 && remainingAdjustableDates.length > 0
        ? Math.ceil(debtToRedistribute / remainingAdjustableDates.length)
        : 0;
    let planCumulative = 0;
    let actualCumulative = 0;
    const rows = sortedDates.map((date) => {
        const basePlan = baseDailyMap.get(date) ?? 0;
        const shouldAddExtra = date >= todayYmd && remainingAdjustableDateSet.has(date);
        const planDaily = basePlan + (shouldAddExtra ? extraPerDay : 0);
        const actualDaily = actualsByDate.get(date) ?? 0;
        planCumulative += planDaily;
        actualCumulative += actualDaily;
        return {
            date,
            planDaily,
            planCumulative,
            actualDaily,
            actualCumulative,
        };
    });
    return { rows, debtToRedistribute, extraPerDay };
};
//# sourceMappingURL=planSchedule.js.map