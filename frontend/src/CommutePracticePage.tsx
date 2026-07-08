import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';

const API_BASE_URL = '/api';
const TARGET_QUESTIONS_PER_SLOT = 20;
// 運用開始日。前日（2026-07-08）以前で実績のない日は薄くグレーアウトする。
const TRACKING_START_DATE = '2026-07-09';
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface CommuteSlotSummary {
  attempts: number;
  total_count: number;
  correct_count: number;
}

interface CommuteDaySummary {
  date: string;
  morning: CommuteSlotSummary;
  evening: CommuteSlotSummary;
}

interface CommuteMonthlySummary {
  year: number;
  month: number;
  days: CommuteDaySummary[];
}

type CommuteSlotKey = 'morning' | 'evening';
type CommuteDotStatus = 'achieved' | 'partial' | 'missed' | 'future' | 'inactive';

const SLOT_DEFINITIONS: Array<{ key: CommuteSlotKey; title: string; subtitle: string }> = [
  { key: 'morning', title: '行き', subtitle: '3:00〜14:59 の提出' },
  { key: 'evening', title: '帰り', subtitle: '15:00〜翌2:59 の提出' },
];

function padTwo(value: number) {
  return String(value).padStart(2, '0');
}

function buildDateKey(year: number, month: number, day: number) {
  return `${year}-${padTwo(month)}-${padTwo(day)}`;
}

function getTodayKeyInTokyo() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

function getSlotStatus(slot: CommuteSlotSummary | undefined, dateKey: string, todayKey: string): CommuteDotStatus {
  const totalCount = slot?.total_count ?? 0;
  if (totalCount >= TARGET_QUESTIONS_PER_SLOT) return 'achieved';
  if (totalCount > 0) return 'partial';
  if (dateKey < TRACKING_START_DATE) return 'inactive';
  return dateKey > todayKey ? 'future' : 'missed';
}

function dotClassName(status: CommuteDotStatus, isToday: boolean, isSelected: boolean) {
  let className = 'flex aspect-square w-full items-center justify-center rounded-md text-[10px] font-semibold transition-colors sm:text-xs ';
  if (status === 'achieved') {
    className += 'bg-primary-new text-white ';
  } else if (status === 'partial') {
    className += 'bg-blue-300 text-white ';
  } else if (status === 'missed') {
    className += 'bg-slate-200 text-slate-500 ';
  } else if (status === 'inactive') {
    className += 'bg-slate-100 text-slate-300 opacity-40 ';
  } else {
    className += 'bg-slate-100 text-slate-300 ';
  }
  if (isSelected) {
    className += 'ring-2 ring-primary-new ring-offset-2 ';
  } else if (isToday) {
    className += 'ring-2 ring-blue-300 ring-offset-1 ';
  }
  return className.trim();
}

function accuracyLabel(slot: CommuteSlotSummary | undefined) {
  const totalCount = slot?.total_count ?? 0;
  if (totalCount === 0) return '-';
  return `${Math.round(((slot?.correct_count ?? 0) / totalCount) * 100)}%`;
}

function CommuteDotCalendar({
  title,
  subtitle,
  slotKey,
  year,
  month,
  daysByDate,
  todayKey,
  selectedDate,
  onSelectDate,
}: {
  title: string;
  subtitle: string;
  slotKey: CommuteSlotKey;
  year: number;
  month: number;
  daysByDate: Map<string, CommuteDaySummary>;
  todayKey: string;
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const achievedCount = Array.from({ length: daysInMonth }, (_, index) => buildDateKey(year, month, index + 1))
    .filter((dateKey) => getSlotStatus(daysByDate.get(dateKey)?.[slotKey], dateKey, todayKey) === 'achieved')
    .length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle} / 目標 {TARGET_QUESTIONS_PER_SLOT}問</p>
        </div>
        <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary-new">
          達成 {achievedCount}日
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="pb-1 text-center text-[10px] font-semibold text-slate-400 sm:text-xs">
            {label}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <div key={`blank-${index}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const dateKey = buildDateKey(year, month, day);
          const status = getSlotStatus(daysByDate.get(dateKey)?.[slotKey], dateKey, todayKey);
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(dateKey)}
              aria-label={`${month}月${day}日の${title}の実績`}
              className={dotClassName(status, dateKey === todayKey, dateKey === selectedDate)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function CommutePracticePage() {
  const todayKey = useMemo(getTodayKeyInTokyo, []);
  const [viewYear, setViewYear] = useState(() => Number(todayKey.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(todayKey.slice(5, 7)));
  const [summary, setSummary] = useState<CommuteMonthlySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const fetchSummary = useCallback(async (year: number, month: number) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/paper-practice/attempts/monthly-summary?year=${year}&month=${month}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '通勤演習の実績取得に失敗しました。');
      }
      const payload: CommuteMonthlySummary = await response.json();
      setSummary(payload);
    } catch (fetchError) {
      setSummary(null);
      setError(fetchError instanceof Error ? fetchError.message : '通勤演習の実績取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary(viewYear, viewMonth);
  }, [fetchSummary, viewYear, viewMonth]);

  const daysByDate = useMemo(
    () => new Map((summary?.days ?? []).map((day) => [day.date, day])),
    [summary],
  );

  const monthStats = useMemo(() => {
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    let morningAchieved = 0;
    let eveningAchieved = 0;
    let bothAchieved = 0;
    let totalQuestions = 0;
    let totalCorrect = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = buildDateKey(viewYear, viewMonth, day);
      const summaryForDay = daysByDate.get(dateKey);
      const morningDone = getSlotStatus(summaryForDay?.morning, dateKey, todayKey) === 'achieved';
      const eveningDone = getSlotStatus(summaryForDay?.evening, dateKey, todayKey) === 'achieved';
      if (morningDone) morningAchieved += 1;
      if (eveningDone) eveningAchieved += 1;
      if (morningDone && eveningDone) bothAchieved += 1;
      totalQuestions += (summaryForDay?.morning.total_count ?? 0) + (summaryForDay?.evening.total_count ?? 0);
      totalCorrect += (summaryForDay?.morning.correct_count ?? 0) + (summaryForDay?.evening.correct_count ?? 0);
    }
    return {
      morningAchieved,
      eveningAchieved,
      bothAchieved,
      totalQuestions,
      accuracy: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    };
  }, [daysByDate, viewYear, viewMonth, todayKey]);

  const selectedDaySummary = selectedDate ? daysByDate.get(selectedDate) : undefined;

  const moveMonth = (delta: number) => {
    const moved = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(moved.getFullYear());
    setViewMonth(moved.getMonth() + 1);
    setSelectedDate('');
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">通勤演習管理</h2>
          <p className="mt-1 text-sm text-slate-500">
            通勤時間の演習（行き{TARGET_QUESTIONS_PER_SLOT}問・帰り{TARGET_QUESTIONS_PER_SLOT}問）を、紙演習モードの回答提出記録から一元管理します。
          </p>
        </div>
        <Link
          to="/paper-practice"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          紙演習ロット一覧へ
        </Link>
      </div>

      <div className="mb-4 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          aria-label="前の月へ"
        >
          ◀
        </button>
        <div className="min-w-[9rem] text-center text-lg font-semibold text-slate-900">
          {viewYear}年{viewMonth}月
        </div>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          aria-label="次の月へ"
        >
          ▶
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-blue-50 p-3 text-center sm:p-4">
              <div className="text-xs font-semibold text-primary-new">行き達成</div>
              <div className="mt-1 text-xl font-bold text-primary-new sm:text-2xl">{monthStats.morningAchieved}日</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center sm:p-4">
              <div className="text-xs font-semibold text-primary-new">帰り達成</div>
              <div className="mt-1 text-xl font-bold text-primary-new sm:text-2xl">{monthStats.eveningAchieved}日</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center sm:p-4">
              <div className="text-xs font-semibold text-primary-new">両方達成</div>
              <div className="mt-1 text-xl font-bold text-primary-new sm:text-2xl">{monthStats.bothAchieved}日</div>
            </div>
            <div className="rounded-lg bg-slate-100 p-3 text-center sm:p-4">
              <div className="text-xs font-semibold text-slate-500">月間実施</div>
              <div className="mt-1 text-xl font-bold text-slate-800 sm:text-2xl">{monthStats.totalQuestions}問</div>
              <div className="text-xs text-slate-500">正答率 {monthStats.totalQuestions > 0 ? `${monthStats.accuracy}%` : '-'}</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {SLOT_DEFINITIONS.map((slot) => (
              <CommuteDotCalendar
                key={slot.key}
                title={slot.title}
                subtitle={slot.subtitle}
                slotKey={slot.key}
                year={viewYear}
                month={viewMonth}
                daysByDate={daysByDate}
                todayKey={todayKey}
                selectedDate={selectedDate}
                onSelectDate={(dateKey) => setSelectedDate((current) => (current === dateKey ? '' : dateKey))}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-primary-new" />
              {TARGET_QUESTIONS_PER_SLOT}問以上（達成）
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-blue-300" />
              1〜{TARGET_QUESTIONS_PER_SLOT - 1}問
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-slate-200" />
              未実施
            </span>
          </div>

          {selectedDate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">{selectedDate} の実績</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {SLOT_DEFINITIONS.map((slot) => {
                  const slotSummary = selectedDaySummary?.[slot.key];
                  const status = getSlotStatus(slotSummary, selectedDate, todayKey);
                  return (
                    <div key={slot.key} className="rounded-lg bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">{slot.title}</div>
                        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          status === 'achieved'
                            ? 'bg-primary-new text-white'
                            : status === 'partial'
                              ? 'bg-blue-100 text-primary-new'
                              : 'bg-slate-200 text-slate-500'
                        }`}
                        >
                          {status === 'achieved' ? '達成' : status === 'partial' ? '一部実施' : '未実施'}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                        <span>提出 {slotSummary?.attempts ?? 0}回</span>
                        <span>{slotSummary?.total_count ?? 0}問</span>
                        <span>正解 {slotSummary?.correct_count ?? 0}</span>
                        <span>正答率 {accuracyLabel(slotSummary)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
