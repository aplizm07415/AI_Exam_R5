import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';

const API_BASE_URL = "/api";

interface Subject {
  name: string;
}

interface AnalyticsData {
  overall_correct_rate: number;
  total_runs: number;
  daily_correct_rate_trend: Record<string, number>;
  frequently_missed_categories: Record<string, number>;
  total_problems_in_subject: number;
  unanswered_problems_count: number;
}

interface DailySummaryItem {
  date: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
}

interface AnalysisDashboardProps {
  subjects: Subject[];
  selectedSubjectNames: string[];
  setSelectedSubjectNames: (names: string[]) => void;
  analytics: AnalyticsData | null;
  isLoading: boolean;
  error: string;
  dailySummary: DailySummaryItem[];
  isDailySummaryLoading: boolean;
  dailySummaryError: string;
  // Filters
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  categories: string[];
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  onApplyFilters: () => void;
}

export default function AnalysisDashboard({
  subjects,
  selectedSubjectNames,
  setSelectedSubjectNames,
  analytics,
  isLoading,
  error,
  dailySummary,
  isDailySummaryLoading,
  dailySummaryError,
  // Filters
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  categories,
  selectedCategory,
  setSelectedCategory,
  onApplyFilters,
}: AnalysisDashboardProps) {
  
  const [isExporting, setIsExporting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [consolidatedData, setConsolidatedData] = useState<DailySummaryItem[]>([]);
  const [isConsolidatedLoading, setIsConsolidatedLoading] = useState(false);
  const [consolidatedError, setConsolidatedError] = useState('');
  const [threshold, setThreshold] = useState<number>(0);

  const fetchConsolidatedData = async () => {
    setIsConsolidatedLoading(true);
    setConsolidatedError('');
    try {
      const response = await fetch(`${API_BASE_URL}/history/daily-summary/all`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '統合履歴の取得に失敗しました。');
      }
      const data: DailySummaryItem[] = await response.json();
      setConsolidatedData(data);
    } catch (e: any) {
      setConsolidatedError(e.message);
      setConsolidatedData([]);
    } finally {
      setIsConsolidatedLoading(false);
    }
  };

  const openConsolidatedModal = () => {
    setIsModalOpen(true);
    fetchConsolidatedData();
  };

  const missedCategories = useMemo(() => {
    if (!analytics?.frequently_missed_categories) return [];
    return Object.entries(analytics.frequently_missed_categories)
      .map(([category, errors]) => ({ category, errors }))
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 5);
  }, [analytics]);

  const trendData = useMemo(() => {
    if (!analytics?.daily_correct_rate_trend) return [];
    return Object.entries(analytics.daily_correct_rate_trend)
      .map(([date, rate]) => ({ date, rate: rate * 100 }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [analytics]);

  const handleExportMissedProblems = async () => {
    if (selectedSubjectNames.length === 0) {
      alert("科目を選択してください。");
      return;
    }
    setIsExporting(true);
    try {
      const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
      const response = await fetch(`${API_BASE_URL}/analytics/export/first-missed-problems?${subjectParams}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '不正解問題リストの取得に失敗しました。');
      }
      const data = await response.json();
      const questionCount = Array.isArray(data?.questions) ? data.questions.length : 0;
      
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `初回間違い_${questionCount}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (e: any) {
      alert(`エクスポートに失敗しました: ${e.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSubject = (name: string) => {
    setSelectedSubjectNames(
      selectedSubjectNames.includes(name)
        ? selectedSubjectNames.filter((s) => s !== name)
        : [...selectedSubjectNames, name]
    );
  };

  return (
    <>
      {/* モーダルウィンドウ */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-xl font-bold text-gray-800">統合日別履歴 (全科目)</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {isConsolidatedLoading ? (
                <LoadingSpinner />
              ) : consolidatedError ? (
                <p className="text-danger text-sm text-center">{consolidatedError}</p>
              ) : consolidatedData.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">履歴がありません。</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">日付</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">総実施数</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">総正答数</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">全体正答率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {consolidatedData.map((item) => (
                      <tr key={item.date} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-800">{item.date}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{item.total_questions}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{item.correct_count}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-medium">{(item.accuracy * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end p-4 border-t">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-bold text-dark">分析ダッシュボード</h2>
          <button onClick={openConsolidatedModal} className="px-4 py-2 bg-white border border-gray-300 text-primary-new text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50">
            統合ボード
          </button>
          <Link
            to="/dashboard/review-later"
            className="px-4 py-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm font-semibold rounded-lg shadow-sm hover:bg-amber-100"
          >
            後で確認
          </Link>
        </div>
        <div className="w-full sm:flex-1">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">対象科目（複数選択可）</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedSubjectNames(subjects.map((s) => s.name))}
                className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                すべて選択
              </button>
              <button
                type="button"
                onClick={() => setSelectedSubjectNames([])}
                className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                解除
              </button>
            </div>
          </div>
          <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2 bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {subjects.map((s) => (
                <label key={s.name} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedSubjectNames.includes(s.name)}
                    onChange={() => toggleSubject(s.name)}
                    className="h-4 w-4 text-primary-new border-gray-300 rounded focus:ring-primary-new"
                  />
                  <span className="truncate" title={s.name}>{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- Filter Bar --- */}
      <div className="bg-white rounded-xl shadow p-4 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Date Range Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日付範囲</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" />
              <span className="text-gray-500">~</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" />
            </div>
          </div>
          {/* Category Filter */}
          <div>
            <label htmlFor="category-filter" className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new"
            >
              <option value="">すべてのカテゴリ</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          {/* Apply Button */}
          <div className="md:justify-self-end">
            <button
              onClick={onApplyFilters}
              className="w-full md:w-auto px-6 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700"
            >
              適用
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="text-center text-gray-500 p-12"><LoadingSpinner /></div>
          ) : error ? (
            <div className="text-center text-danger bg-danger/10 rounded-xl p-12"><p>{error}</p></div>
          ) : !analytics || analytics.total_runs === 0 ? (
            <div className="text-center text-gray-500 bg-white rounded-xl p-12">
              <p>選択した科目の練習履歴が見つかりません。</p>
              <p className="mt-2">クイズを完了すると、ダッシュボードが表示されます。</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow p-6 print-color-graph">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">総合パフォーマンス</h3>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.overall_correct_rate.toFixed(1)}%</p>
                    <p className="text-sm text-gray-500">全体正答率</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.total_problems_in_subject}</p>
                    <p className="text-sm text-gray-500">問題総数</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.total_runs}</p>
                    <p className="text-sm text-gray-500">総解答数</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-green-600">{analytics.unanswered_problems_count}</p>
                    <p className="text-sm text-gray-500">未解答問題</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-700">主な苦手分野 (エラー数順)</h3>
                  {missedCategories.length > 0 && (
                    <button
                      onClick={handleExportMissedProblems}
                      disabled={isExporting || selectedSubjectNames.length === 0}
                      className="px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isExporting ? 'エクスポート中...' : '初回間違いJSONエクスポート'}
                    </button>
                  )}
                </div>
                {missedCategories.length > 0 ? (
                  <ul className="space-y-3">
                    {missedCategories.map(area => (
                      <li key={area.category}>
                        <div className="flex justify-between items-center">
                          <p className="text-sm font-medium text-gray-700">{area.category}</p>
                          <p className="text-sm font-bold text-danger">{area.errors} 回</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">ミスした問題はありませんでした！</p>
                )}
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-700">正答率の推移</h3>
                  <select 
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    value={threshold}
                    className="text-xs border border-gray-300 rounded-md py-1 px-2"
                  >
                    <option value={0}>閾値なし</option>
                    <option value={60}>60%</option>
                    <option value={70}>70%</option>
                    <option value={80}>80%</option>
                    <option value={90}>90%</option>
                  </select>
                </div>
                <div className="h-64 flex items-stretch">
                  <div className="flex-shrink-0 flex flex-col justify-between text-xs text-gray-500 pr-2">
                    <span>100%</span>
                    <span>90%</span>
                    <span>80%</span>
                    <span>70%</span>
                    <span>60%</span>
                    <span>50%</span>
                    <span>40%</span>
                    <span>30%</span>
                    <span>20%</span>
                    <span>10%</span>
                    <span>0%</span>
                  </div>

                  <div className="relative flex-grow overflow-x-auto">
                    <div className="relative h-full" style={{ minWidth: trendData.length > 21 ? `${trendData.length * 25}px` : '100%'}}>
                      
                      {/* Background Grid lines */}
                      <div className="absolute inset-0">
                        {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map(p => {
                          const topPosition = 100 - p;
                          return <div key={p} className="absolute w-full border-t border-gray-200 border-dashed" style={{ top: `${topPosition}%` }} />;
                        })}
                      </div>

                      {/* Bars */}
                      {trendData.length > 0 ? (
                        <div className="relative w-full h-full flex justify-around gap-2 items-end px-1">
                          {trendData.map((d, i) => {
                              const isAboveThreshold = threshold > 0 && d.rate >= threshold;
                              const barColor = isAboveThreshold ? 'bg-danger/50 hover:bg-danger' : 'bg-blue-200 hover:bg-blue-300';
                              return (
                                <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group relative">
                                    <div className="absolute -top-5 text-xs font-bold text-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                                      {d.rate.toFixed(0)}%
                                    </div>
                                    <div
                                      className={`w-full ${barColor} transition-colors duration-200 rounded-t min-h-[2px] print-keep-color`}
                                      style={{ height: `${Math.max(0, Math.min(100, d.rate))}%` }}
                                      title={`${d.rate.toFixed(1)}%`}
                                    ></div>
                                    <div className="text-xs text-gray-500 mt-1">{d.date.substring(5)}</div>
                                </div>
                              )
                          })}
                        </div>
                      ) : <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">履歴データがありません。</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">日別実施履歴</h3>
            {isDailySummaryLoading ? (
              <LoadingSpinner />
            ) : dailySummaryError ? (
              <p className="text-danger text-sm text-center">履歴が取得できませんでした。</p>
            ) : dailySummary.length === 0 ? (
              <p className="text-sm text-gray-500">日別実施履歴がありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">日付</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">実施数</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">正答数</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">正答率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {dailySummary.map((item) => (
                      <tr key={item.date} className="hover:bg-gray-100">
                        <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700">{item.date}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{item.total_questions}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{item.correct_count}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{(item.accuracy * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
