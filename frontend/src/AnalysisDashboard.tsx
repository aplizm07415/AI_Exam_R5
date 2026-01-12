import React, { useState, useMemo } from 'react';
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
  selectedSubjectName: string;
  setSelectedSubjectName: (name: string) => void;
  analytics: AnalyticsData | null;
  isLoading: boolean;
  error: string;
  dailySummary: DailySummaryItem[];
  isDailySummaryLoading: boolean;
  dailySummaryError: string;
}

export default function AnalysisDashboard({
  subjects,
  selectedSubjectName,
  setSelectedSubjectName,
  analytics,
  isLoading,
  error,
  dailySummary,
  isDailySummaryLoading,
  dailySummaryError
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
    if (!selectedSubjectName) {
      alert("科目を選択してください。");
      return;
    }
    setIsExporting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/${selectedSubjectName}/missed-problems`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '不正解問題リストの取得に失敗しました。');
      }
      const data = await response.json();
      
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `missed_problems_${selectedSubjectName}.json`;
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

      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-8 gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-bold text-dark">分析ダッシュボード</h2>
          <button onClick={openConsolidatedModal} className="px-4 py-2 bg-white border border-gray-300 text-primary-new text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50">
            統合ボード
          </button>
        </div>
        <div className="w-full sm:w-64">
          <select
            id="subject"
            value={selectedSubjectName}
            onChange={e => setSelectedSubjectName(e.target.value)}
            className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
          >
            {subjects.map(s => <option key={s.name} value={s.name}>
              {s.name}
            </option>)}
          </select>
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
              <p>「{selectedSubjectName}」の練習履歴が見つかりません。</p>
              <p className="mt-2">クイズを完了すると、ダッシュボードが表示されます。</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow p-6">
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
                    <p className="text-sm text-gray-500">未回答問題</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-700">主な苦手分野 (エラー数順)</h3>
                  {missedCategories.length > 0 && (
                    <button
                      onClick={handleExportMissedProblems}
                      disabled={isExporting}
                      className="px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isExporting ? 'エクスポート中...' : 'エクスポート'}
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
                  </div>

                  <div className="relative flex-grow overflow-x-auto">
                    <div className="relative h-full" style={{ minWidth: trendData.length > 21 ? `${trendData.length * 25}px` : '100%'}}>
                      
                      {/* Background Grid lines */}
                      <div className="absolute inset-0">
                        {[100, 90, 80, 70, 60, 50].map(p => {
                          const topPosition = 100 - p;
                          return <div key={p} className="absolute w-full border-t border-gray-200 border-dashed" style={{ top: `${topPosition}%` }} />;
                        })}
                      </div>

                      {/* Bars */}
                      {trendData.length > 1 ? (
                        <div className="relative w-full h-full flex justify-around gap-2 items-end px-1">
                          {trendData.map((d, i) => {
                              const isAboveThreshold = threshold > 0 && d.rate >= threshold;
                              const barColor = isAboveThreshold ? 'bg-orange-300 hover:bg-orange-400' : 'bg-blue-200 hover:bg-blue-300';
                              return (
                                <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group">
                                    <div className="text-xs font-bold text-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-200">{d.rate.toFixed(0)}%</div>
                                    <div className={`w-full ${barColor} transition-colors duration-200 rounded-t min-h-[2px]`} style={{ height: `${d.rate}%` }}></div>
                                    <div className="text-xs text-gray-500 mt-1">{d.date.substring(5)}</div>
                                </div>
                              )
                          })}
                        </div>
                      ) : <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">グラフを表示するには2日以上の履歴が必要です。</p>}
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
