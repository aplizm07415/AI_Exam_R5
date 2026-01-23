import React, { useState, useMemo } from 'react';
import { usePlans } from './hooks/usePlans';
import type { Plan } from './types/plan.d';
import { isHoliday } from './utils/date';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
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
  dailySummaryAll: DailySummaryItem[];
}

interface ProgressDataRow {
  date: string;
  plan: { daily: number; cumulative: number };
  actual: { daily: number; cumulative: number };
  progress: { daily: number; cumulative: number };
}

export default function PlanManagementDashboard({ subjects, dailySummaryAll }: PlanManagementDashboardProps) {
  const { plans, addPlan, updatePlan, deletePlan, isLoading, error } = usePlans();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

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
    setPlanCreationMode('daily'); // Editing defaults to daily mode for simplicity
    setIsFormOpen(true);
  };

  const toggleEnabled = (plan: Plan) => {
    updatePlan({ ...plan, enabled: !plan.enabled });
  };
  
  const progressData = useMemo((): ProgressDataRow[] => {
    const activePlans = plans.filter(p => p.enabled);
    if (activePlans.length === 0) return [];

    const actualsMap = new Map(dailySummaryAll.filter(item => item.date).map(item => [item.date, item.total_questions]));

    const allDates = new Set<string>();
    activePlans.forEach(p => {
        if (!p.period || typeof p.period.from !== 'string' || typeof p.period.to !== 'string') {
          return;
        }
        let current = new Date(p.period.from);
        const to = new Date(p.period.to);
        while(current <= to) {
            allDates.add(current.toISOString().split('T')[0]!);
            current.setDate(current.getDate() + 1);
        }
    });
    dailySummaryAll.forEach(item => {
      if (item.date) {
        allDates.add(item.date);
      }
    });
    
    if (allDates.size === 0) return [];

    const sortedDates = Array.from(allDates).sort();
    
    let cumulativePlan = 0;
    let cumulativeActual = 0;

    return sortedDates.map(dateStr => {
      const date = new Date(dateStr);
      date.setUTCHours(0,0,0,0); 
      
      let dailyPlan = 0;
      activePlans.forEach((plan: Plan) => {
        if (!plan.period.from || !plan.period.to) return;
        
        const from = new Date(plan.period.from);
        const to = new Date(plan.period.to);
        from.setUTCHours(0,0,0,0);
        to.setUTCHours(0,0,0,0);

        if(date >= from && date <= to) {
          const holiday = isHoliday(date);
          if (plan.applyDays === 'all') {
            dailyPlan += holiday ? plan.dailyGoal.holiday : plan.dailyGoal.weekday;
          } else if (plan.applyDays === 'holiday' && holiday) {
            dailyPlan += plan.dailyGoal.holiday;
          } else if (plan.applyDays === 'weekday' && !holiday) {
            dailyPlan += plan.dailyGoal.weekday;
          }
        }
      });

      const dailyActual = actualsMap.get(dateStr) || 0;

      cumulativePlan += dailyPlan;
      cumulativeActual += dailyActual;
      
      const dailyProgress = dailyPlan > 0 ? (dailyActual / dailyPlan) * 100 : 0;
      const cumulativeProgress = cumulativePlan > 0 ? (cumulativeActual / cumulativePlan) * 100 : 0;

      return {
        date: dateStr,
        plan: { daily: dailyPlan, cumulative: cumulativePlan },
        actual: { daily: dailyActual, cumulative: cumulativeActual },
        progress: { daily: dailyProgress, cumulative: cumulativeProgress },
      };
    }).filter(d => d.plan.cumulative > 0 || d.actual.cumulative > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [plans, dailySummaryAll]);

  const chartData = useMemo(() => {
    return progressData.map(d => ({
      date: d.date,
      '予定': d.plan.cumulative,
      '実績': d.actual.cumulative,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [progressData]);

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
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">学習予定管理</h2>
        <button onClick={() => setIsFormOpen(!isFormOpen)} className="px-4 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700 transition-colors">
          {isFormOpen ? '閉じる' : '新しい予定を追加'}
        </button>
      </div>

      {isFormOpen && (
        <div className="mb-8 p-6 border border-gray-200 rounded-lg bg-gray-50">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700">予定タイトル</label>
              <input type="text" id="title" value={title} onChange={e => setTitle(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">対象科目 (複数選択可)</label>
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
                <label htmlFor="fromDate" className="block text-sm font-medium text-gray-700">対象期間 (From)</label>
                <input type="date" id="fromDate" value={fromDate} onChange={e => setFromDate(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
              </div>
              <div>
                <label htmlFor="toDate" className="block text-sm font-medium text-gray-700">対象期間 (To)</label>
                <input type="date" id="toDate" value={toDate} onChange={e => setToDate(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" />
              </div>
            </div>
            
            {/* Plan Creation Mode Switcher */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">計画方法</label>
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
            <div className="flex justify-end gap-4">
              <button type="button" onClick={resetForm} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">キャンセル</button>
              <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">{editingPlan ? '更新' : '登録'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {plans.map(plan => (
          <div key={plan.id} className="p-4 border rounded-lg flex items-center justify-between hover:bg-gray-50 transition-colors">
            <div className="flex-1 cursor-pointer" onClick={() => handleEdit(plan)}>
              <p className="font-bold text-gray-800">{plan.title}</p>
              <p className="text-sm text-gray-500">{plan.subjectNames.join(', ')}</p>
              <p className="text-sm text-gray-500">{plan.period.from} ~ {plan.period.to}</p>
            </div>
            <div className="flex items-center gap-4 ml-4">
              <label htmlFor={`toggle-${plan.id}`} className="flex items-center cursor-pointer">
                <div className="relative">
                  <input type="checkbox" id={`toggle-${plan.id}`} className="sr-only" checked={plan.enabled} onChange={() => toggleEnabled(plan)} />
                  <div className={`block w-14 h-8 rounded-full ${plan.enabled ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${plan.enabled ? 'translate-x-6' : ''}`}></div>
                </div>
              </label>
              <button onClick={() => deletePlan(plan.id)} className="text-gray-400 hover:text-red-600">
                <TrashIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">予実グラフ</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={chartData}
            margin={{
              top: 5, right: 30, left: 20, bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="予定" stroke="#3b82f6" activeDot={{ r: 8 }} />
            <Line type="monotone" dataKey="実績" stroke="#16a34a" />
          </LineChart>
        </ResponsiveContainer>
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
                {progressData.map((row, index) => (
                  <tr key={index}>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.date}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{row.plan.daily} / {row.plan.cumulative}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{row.actual.daily} / {row.actual.cumulative}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{row.progress.daily.toFixed(0)}% / {row.progress.cumulative.toFixed(0)}%</td>
                  </tr>
                ))}
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
        </details>
      </div>
    </div>
  );
}
