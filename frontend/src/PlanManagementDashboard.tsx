import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePlans } from './hooks/usePlans';
import type { Plan } from './types/plan.d';
import { isHoliday, getTodayYmdJst } from './utils/date';
import { buildPlanSchedule } from './utils/planSchedule';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush } from 'recharts';
import LoadingSpinner from './components/LoadingSpinner';

const TrashIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
    <path fill="currentColor" d="M7 21q-.825 0-1.412-.588T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.588 1.413T17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2zM7 6v13z"></path>
  </svg>
);

interface DailySummaryItem {
  date: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
}

interface Subject {
  name: string;
}

interface PlanManagementDashboardProps {
  subjects: Subject[];
}

interface ProgressDataRow {
  date: string;
  plan: { daily: number; cumulative: number };
  actual: { daily: number; cumulative: number };
  progress: { daily: number; cumulative: number };
}

const formatDateYmd = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function PlanManagementDashboard({ subjects }: PlanManagementDashboardProps) {
  const { plans, addPlan, updatePlan, deletePlan, isLoading, error } = usePlans();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [dailySummaryAll, setDailySummaryAll] = useState<DailySummaryItem[]>([]);

  // Form state
  const [title, setTitle] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  
  // New state for plan creation mode
  const [planCreationMode, setPlanCreationMode] = useState<'daily' | 'total'>('daily');
  
  // State for "daily" mode
  const [weekdayGoal, setWeekdayGoal] = useState(10);
  const [holidayGoal, setHolidayGoal] = useState(10);

  // State for "total" mode
  const [totalQuestions, setTotalQuestions] = useState(500);
  const [weekdayRatio, setWeekdayRatio] = useState(1);
  const [holidayRatio, setHolidayRatio] = useState(2);

  const [applyDays, setApplyDays] = useState<'all' | 'weekday' | 'holiday'>('all');
  const [minimumDaily, setMinimumDaily] = useState(0);
  const [autoRedistribute, setAutoRedistribute] = useState(true);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  const [printChartWidth, setPrintChartWidth] = useState(900);
  const [chartStartDate, setChartStartDate] = useState('');
  const [chartEndDate, setChartEndDate] = useState('');

  useEffect(() => {
    // plansが読み込まれたら、デフォルトで全ての有効なプランを選択状態にする
    const defaultSelectedIds = plans.filter(p => p.enabled).map(p => p.id);
    setSelectedPlanIds(defaultSelectedIds);
  }, [plans]); // plansが変わった時だけ実行

  useEffect(() => {
    const fetchFilteredSummary = async () => {
      const targetPlans = plans.filter(p => selectedPlanIds.includes(p.id));
      const planSubjects = Array.from(new Set(targetPlans.flatMap(p => p.subjectNames)));
      const planStartDate = targetPlans.map((p) => p.period.from).filter(Boolean).sort()[0] ?? '';
      const planEndDate = targetPlans.map((p) => p.period.to).filter(Boolean).sort().at(-1) ?? '';

      if (planSubjects.length === 0) {
        setDailySummaryAll([]);
        return;
      }

      try {
        const params = new URLSearchParams();
        planSubjects.forEach((s) => params.append('subjects', s));
        if (planStartDate) params.append('start_date', planStartDate);
        if (planEndDate) params.append('end_date', planEndDate);
        const response = await fetch(`/api/history/daily-summary/all?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setDailySummaryAll(data);
        } else {
          console.error("Failed to fetch filtered daily summary for Plan Mngmt");
          setDailySummaryAll([]);
        }
      } catch (e) {
        console.error("Error fetching filtered daily summary for Plan Mngmt:", e);
        setDailySummaryAll([]);
      }
    };

    if (plans.length > 0) {
      fetchFilteredSummary();
    }
  }, [plans, selectedPlanIds]);

  useEffect(() => {
    const activePlans = plans.filter(p => p.enabled && selectedPlanIds.includes(p.id));
    if (activePlans.length === 0) {
      setChartStartDate('');
      setChartEndDate('');
      return;
    }

    const defaultStart = activePlans.map((p) => p.period.from).filter(Boolean).sort()[0] ?? '';
    const defaultEnd = activePlans.map((p) => p.period.to).filter(Boolean).sort().at(-1) ?? '';
    setChartStartDate(defaultStart);
    setChartEndDate(defaultEnd);
  }, [plans, selectedPlanIds]);

  useEffect(() => {
    const triggerChartResize = () => {
      // Recharts ResponsiveContainer sometimes keeps stale width in print preview.
      window.dispatchEvent(new Event('resize'));
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    };

    const updatePrintChartWidth = () => {
      const width = chartWrapperRef.current?.getBoundingClientRect().width;
      if (width && width > 0) {
        setPrintChartWidth(Math.floor(width));
      }
    };

    const handleBeforePrint = () => {
      updatePrintChartWidth();
      setIsPrintPreview(true);
      triggerChartResize();
    };

    const handleAfterPrint = () => {
      setIsPrintPreview(false);
      triggerChartResize();
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  const handleSubjectChange = (subjectName: string) => {
    setSelectedSubjects(prev =>
      prev.includes(subjectName)
        ? prev.filter(s => s !== subjectName)
        : [...prev, subjectName]
    );
  };

  const resetForm = () => {
    setTitle('');
    setSelectedSubjects([]);
    setFromDate('');
    setToDate('');
    setWeekdayGoal(10);
    setHolidayGoal(10);
    setTotalQuestions(500);
    setWeekdayRatio(1);
    setHolidayRatio(2);
    setApplyDays('all');
    setMinimumDaily(0);
    setAutoRedistribute(true);
    setPlanCreationMode('daily');
    setEditingPlan(null);
    setIsFormOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || selectedSubjects.length === 0 || !fromDate || !toDate) {
      alert('タイトル、科目、期間をすべて入力してください。');
      return;
    }

    let calculatedWeekdayGoal = weekdayGoal;
    let calculatedHolidayGoal = holidayGoal;

    if (planCreationMode === 'total') {
      if (!totalQuestions || (weekdayRatio <= 0 && holidayRatio <= 0)) {
        alert('総問題数と比率を正しく入力してください。');
        return;
      }
      
      let numWeekdays = 0;
      let numHolidays = 0;
      let currentDate = new Date(fromDate);
      const lastDate = new Date(toDate);

      while(currentDate <= lastDate) {
        if(isHoliday(currentDate)) {
          numHolidays++;
        } else {
          numWeekdays++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      if (numWeekdays === 0 && numHolidays === 0) {
        alert('有効な期間ではありません。');
        return;
      }

      const totalRatioUnits = (numWeekdays * weekdayRatio) + (numHolidays * holidayRatio);
      
      if (totalRatioUnits === 0) {
          alert('比率が0のため、一日あたりの問題数を計算できません。平日か休日のどちらかの比率を0より大きくしてください。');
          return;
      }

      const questionsPerRatioUnit = totalQuestions / totalRatioUnits;
      
      calculatedWeekdayGoal = Math.round(questionsPerRatioUnit * weekdayRatio);
      calculatedHolidayGoal = Math.round(questionsPerRatioUnit * holidayRatio);
    }
    
    const newPlan: Omit<Plan, 'id'> = {
      title,
      subjectNames: selectedSubjects,
      period: { from: fromDate, to: toDate },
      dailyGoal: { weekday: calculatedWeekdayGoal, holiday: calculatedHolidayGoal },
      applyDays,
      minimumDaily: Math.max(0, minimumDaily),
      autoRedistribute,
      enabled: true,
    };

    if (editingPlan) {
      updatePlan({ ...editingPlan, ...newPlan });
    } else {
      addPlan(newPlan);
    }
    resetForm();
  };

  const handleEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setTitle(plan.title);
    setSelectedSubjects(plan.subjectNames);
    setFromDate(plan.period.from);
    setToDate(plan.period.to);
    setWeekdayGoal(plan.dailyGoal.weekday);
    setHolidayGoal(plan.dailyGoal.holiday);
    setApplyDays(plan.applyDays);
    setMinimumDaily(plan.minimumDaily ?? 0);
    setAutoRedistribute(plan.autoRedistribute !== false);
    setPlanCreationMode('daily'); // Editing defaults to daily mode for simplicity
    setIsFormOpen(true);
  };

  const toggleEnabled = (plan: Plan) => {
    updatePlan({ ...plan, enabled: !plan.enabled });
  };

  const confirmDeletePlan = (plan: Plan) => {
    const ok = window.confirm(`予定「${plan.title}」を削除しますか？`);
    if (!ok) return;
    deletePlan(plan.id);
  };
  
  const progressData = useMemo((): ProgressDataRow[] => {
    const activePlans = plans.filter(p => p.enabled && selectedPlanIds.includes(p.id));
    if (activePlans.length === 0) return [];

    const actualsMap = new Map(dailySummaryAll.filter(item => item.date).map(item => [item.date, item.total_questions]));
    const schedule = buildPlanSchedule(activePlans, actualsMap, getTodayYmdJst());
    return schedule.rows
      .map((row) => ({
        date: row.date,
        plan: { daily: row.planDaily, cumulative: row.planCumulative },
        actual: { daily: row.actualDaily, cumulative: row.actualCumulative },
        progress: {
          daily: row.planDaily > 0 ? (row.actualDaily / row.planDaily) * 100 : 0,
          cumulative: row.planCumulative > 0 ? (row.actualCumulative / row.planCumulative) * 100 : 0,
        },
      }))
      .filter(d => d.plan.cumulative > 0 || d.actual.cumulative > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [plans, dailySummaryAll, selectedPlanIds]);

  const learningDebt = useMemo(() => {
    const today = getTodayYmdJst();
    const upToToday = progressData.filter((row) => row.date <= today);
    const latest = upToToday.length > 0 ? upToToday[upToToday.length - 1] : null;
    if (!latest) return 0;
    return Math.max(0, latest.plan.cumulative - latest.actual.cumulative);
  }, [progressData]);

  const displayProgressData = useMemo(() => {
    return progressData
      .filter((d) => (!chartStartDate || d.date >= chartStartDate) && (!chartEndDate || d.date <= chartEndDate))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [chartEndDate, chartStartDate, progressData]);

  const chartData = useMemo(() => {
    return displayProgressData
      .map(d => ({
      date: d.date,
      '予定': d.plan.cumulative,
      '実績': d.actual.cumulative,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [displayProgressData]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 p-4">エラー: {error}</div>;
  }

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-3xl font-bold text-dark mb-4">予実ダッシュボード</h2>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">学習予定管理</h2>
        <button onClick={() => setIsFormOpen(!isFormOpen)} className="px-4 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700 transition-colors">
          {isFormOpen ? '閉じる' : '新規予定追加'}
        </button>
      </div>

      {isFormOpen && (
        <div className="mb-8 p-6 border border-gray-200 rounded-lg bg-gray-50">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="title" className="heading-2 block text-sm font-medium text-gray-700">予定タイトル</label>
              <input type="text" id="title" value={title} onChange={e => setTitle(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
            </div>
            <div>
              <label className="heading-2 block text-sm font-medium text-gray-700">対象科目 (複数選択可)</label>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {subjects.map(s => (
                  <button type="button" key={s.name} onClick={() => handleSubjectChange(s.name)} className={`px-3 py-2 rounded-md text-sm font-medium text-left truncate ${selectedSubjects.includes(s.name) ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="fromDate" className="heading-2 block text-sm font-medium text-gray-700">対象期間 (From)</label>
                <input type="date" id="fromDate" value={fromDate} onChange={e => setFromDate(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
              </div>
              <div>
                <label htmlFor="toDate" className="heading-2 block text-sm font-medium text-gray-700">対象期間 (To)</label>
                <input type="date" id="toDate" value={toDate} onChange={e => setToDate(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
              </div>
            </div>
            
            {/* Plan Creation Mode Switcher */}
            <div>
                <label className="heading-2 block text-sm font-medium text-gray-700 mb-2">計画方法</label>
                <div className="flex rounded-md shadow-sm">
                    <button type="button" onClick={() => setPlanCreationMode('daily')} className={`px-4 py-2 text-sm font-medium rounded-l-md w-1/2 ${planCreationMode === 'daily' ? 'bg-primary-new text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                        日別目標
                    </button>
                    <button type="button" onClick={() => setPlanCreationMode('total')} className={`px-4 py-2 text-sm font-medium rounded-r-md w-1/2 ${planCreationMode === 'total' ? 'bg-primary-new text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                        総数から逆算
                    </button>
                </div>
            </div>

            {planCreationMode === 'daily' && (
              <div>
                <label className="block text-sm font-medium text-gray-700">1日の問題実施計画数</label>
                <div className="mt-2 space-y-4">
                  <div className="flex items-center gap-4">
                     <label htmlFor="weekdayGoal" className="w-20 text-sm text-gray-500">平日</label>
                     <input type="number" id="weekdayGoal" value={weekdayGoal} onChange={e => setWeekdayGoal(parseInt(e.target.value, 10))} min="0" className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
                  </div>
                  <div className="flex items-center gap-4">
                     <label htmlFor="holidayGoal" className="w-20 text-sm text-gray-500">土日祝</label>
                     <input type="number" id="holidayGoal" value={holidayGoal} onChange={e => setHolidayGoal(parseInt(e.target.value, 10))} min="0" className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
                  </div>
                </div>
              </div>
            )}

            {planCreationMode === 'total' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="totalQuestions" className="block text-sm font-medium text-gray-700">期間中の総問題数</label>
                  <input type="number" id="totalQuestions" value={totalQuestions} onChange={e => setTotalQuestions(parseInt(e.target.value, 10))} min="0" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">平日と土日祝の活動比率</label>
                  <div className="mt-2 flex items-center gap-4">
                     <input type="number" value={weekdayRatio} onChange={e => setWeekdayRatio(parseInt(e.target.value, 10))} min="0" className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm" />
                     <span className="text-gray-500">:</span>
                     <input type="number" value={holidayRatio} onChange={e => setHolidayRatio(parseInt(e.target.value, 10))} min="0" className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm" />
                  </div>
                </div>
              </div>
            )}

             <div>
                <label className="block text-sm font-medium text-gray-700">適用曜日</label>
                 <div className="mt-2 flex space-x-4">
                     {(['all', 'weekday', 'holiday'] as const).map(dayType => (
                         <button type="button" key={dayType} onClick={() => setApplyDays(dayType)} className={`px-4 py-2 rounded-md text-sm font-medium ${applyDays === dayType ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                             {dayType === 'all' ? '毎日' : dayType === 'weekday' ? '平日のみ' : '土日祝のみ'}
                         </button>
                     ))}
                 </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="minimumDaily" className="block text-sm font-medium text-gray-700">最低実施ライン（1日あたり）</label>
                <input
                  type="number"
                  id="minimumDaily"
                  value={minimumDaily}
                  onChange={e => setMinimumDaily(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  min="0"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">平日/休日目標より小さい場合は目標値が優先されます。</p>
              </div>
              <div className="flex items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 mt-6 sm:mt-0">
                <div>
                  <p className="text-sm font-medium text-gray-700">未達分の自動日次再配分</p>
                  <p className="text-xs text-gray-500">前日までの未達を残り日程に均等加算します。</p>
                </div>
                <input
                  type="checkbox"
                  checked={autoRedistribute}
                  onChange={(e) => setAutoRedistribute(e.target.checked)}
                  className="h-4 w-4 accent-primary-new"
                />
              </div>
            </div>
            <div className="flex justify-end gap-4">
              <button type="button" onClick={resetForm} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">キャンセル</button>
              <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">{editingPlan ? '更新' : '登録'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="my-6 p-4 border rounded-lg bg-gray-50">
        <label className="block text-sm font-medium text-gray-700 mb-2">表示する予定</label>
        <div className="flex items-center gap-4 mb-3">
          <button
            type="button"
            onClick={() => setSelectedPlanIds(plans.filter(p => p.enabled).map(p => p.id))}
            className="px-3 py-1 text-xs font-medium text-white bg-primary-new rounded-md hover:bg-primary"
          >
            すべて選択
          </button>
          <button
            type="button"
            onClick={() => setSelectedPlanIds([])}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            すべて解除
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {plans.map(plan => (
            <div key={plan.id} className="flex items-center">
              <input
                type="checkbox"
                id={`plan-toggle-${plan.id}`}
                checked={selectedPlanIds.includes(plan.id)}
                onChange={() => {
                  setSelectedPlanIds(prev =>
                    prev.includes(plan.id)
                      ? prev.filter(id => id !== plan.id)
                      : [...prev, plan.id]
                  );
                }}
                className="h-4 w-4 accent-primary-new text-primary-new border-gray-300 rounded focus:ring-primary-new"
                disabled={!plan.enabled}
              />
              <label
                htmlFor={`plan-toggle-${plan.id}`}
                className={`ml-2 text-sm text-gray-700 truncate ${!plan.enabled ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}
                title={plan.title}
              >
                {plan.title}
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {plans.map(plan => (
          <div key={plan.id} className="p-4 border rounded-lg flex items-center justify-between hover:bg-gray-50 transition-colors">
            <div className="flex-1 cursor-pointer" onClick={() => handleEdit(plan)}>
              <p className="font-bold text-gray-800">{plan.title}</p>
              <p className="text-sm text-gray-500">{plan.subjectNames.join(', ')}</p>
              <p className="text-sm text-gray-500">{plan.period.from} ~ {plan.period.to}</p>
              <p className="text-xs text-gray-500 mt-1">
                最低実施ライン: {plan.minimumDaily ?? 0}問 / 自動再配分: {plan.autoRedistribute === false ? 'OFF' : 'ON'}
              </p>
            </div>
            <div className="flex items-center gap-4 ml-4">
              <label htmlFor={`toggle-${plan.id}`} className="flex items-center cursor-pointer">
                <div className="relative">
                  <input type="checkbox" id={`toggle-${plan.id}`} className="sr-only" checked={plan.enabled} onChange={() => toggleEnabled(plan)} />
                  <div className={`block w-14 h-8 rounded-full border-2 border-primary-new transition-colors ${plan.enabled ? 'bg-primary-new' : 'bg-white'}`}></div>
                </div>
              </label>
              <button onClick={() => confirmDeletePlan(plan)} className="text-gray-400 hover:text-danger">
                <TrashIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-8 print-chart-fix">
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">学習負債メーター</p>
          <p className="text-2xl font-bold text-amber-700">{learningDebt} 問</p>
          <p className="text-xs text-amber-800">未消化復習（累計予定 - 累計実績）</p>
        </div>
        <div className="mb-4 grid gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label htmlFor="chartStartDate" className="block text-sm font-medium text-gray-700">表示開始日</label>
            <input
              type="date"
              id="chartStartDate"
              value={chartStartDate}
              onChange={(e) => setChartStartDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div>
            <label htmlFor="chartEndDate" className="block text-sm font-medium text-gray-700">表示終了日</label>
            <input
              type="date"
              id="chartEndDate"
              value={chartEndDate}
              onChange={(e) => setChartEndDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                const activePlans = plans.filter(p => p.enabled && selectedPlanIds.includes(p.id));
                const defaultStart = activePlans.map((p) => p.period.from).filter(Boolean).sort()[0] ?? '';
                const defaultEnd = activePlans.map((p) => p.period.to).filter(Boolean).sort().at(-1) ?? '';
                setChartStartDate(defaultStart);
                setChartEndDate(defaultEnd);
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 md:w-auto"
            >
              期間をリセット
            </button>
          </div>
        </div>
        <h3 className="text-lg font-semibold text-gray-700 mb-4">予実グラフ</h3>
        {chartData.length === 0 ? (
          <div className="text-sm text-gray-500 py-8">選択した期間に表示対象データがありません。</div>
        ) : (
          <div ref={chartWrapperRef}>
            {isPrintPreview ? (
              <LineChart
                width={printChartWidth}
                height={350}
                data={chartData}
                margin={{
                  top: 5, right: 30, left: 20, bottom: 50,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="予定" stroke="#3d7cce" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="実績" stroke="#cf483e" dot={false} isAnimationActive={false} />
              </LineChart>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart
                  data={chartData}
                  margin={{
                    top: 5, right: 30, left: 20, bottom: 50,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="予定" stroke="#3d7cce" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="実績" stroke="#cf483e" dot={false} isAnimationActive={false} /> {/* Changed to dot={false} for '実績' for better mobile visibility */}
                  <Brush dataKey="date" height={30} stroke="#3d7cce" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
      
      <div className="mt-8">
        <details>
          <summary className="text-lg font-semibold text-gray-700 mb-4 cursor-pointer">進捗サマリー</summary>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">日付</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">予定 (日/累)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">実績 (日/累)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">進捗 (日/累)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {progressData.map((row, index) => {
                  const isAchieved = row.actual.daily > row.plan.daily; // 当日の実績が日次計画数を上回っている場合
                  return (
                    <tr key={index} className={isAchieved ? 'bg-orange-100' : ''}>
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.date}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{row.plan.daily} / {row.plan.cumulative}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{row.actual.daily} / {row.actual.cumulative}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{row.progress.daily.toFixed(0)}% / {row.progress.cumulative.toFixed(0)}%</td>
                    </tr>
                  );
                })}
                {progressData.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-10 text-sm text-gray-500">
                      表示できる進捗データがありません。予定を登録し、演習を行うと表示されます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-sm text-gray-600 space-y-1">
            <p className="font-semibold">列の仕様:</p>
            <ul className="list-disc pl-5">
              <li><span className="font-semibold">日付</span>: 計画期間内の日付</li>
              <li><span className="font-semibold">予定 (日/累)</span>: その日の計画問題数 / 累計の計画問題数</li>
              <li><span className="font-semibold">実績 (日/累)</span>: その日の実績問題数 / 累計の実績問題数</li>
              <li><span className="font-semibold">進捗 (日/累)</span>: `(実績(日) / 予定(日)) * 100` / `(実績(累) / 予定(累)) * 100`</li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
