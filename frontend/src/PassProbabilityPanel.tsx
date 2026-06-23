import React, { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from './components/LoadingSpinner';

const API_BASE_URL = '/api';
const PASSING_SCORE_STORAGE_KEY = 'dashboard:passingScore';
const PAST_EXAM_WEIGHT_STORAGE_KEY = 'dashboard:pastExamWeight';
const INCLUDE_PAST_EXAM_STORAGE_KEY = 'dashboard:includePastExamRecords';
const ANALYSIS_POLICY_STORAGE_KEY = 'dashboard:passProbabilityAnalysisPolicy';
const COUNTDOWN_EXAMS_STORAGE_KEY = 'countdownExams';
const SELECTED_EXAM_STORAGE_KEY = 'dashboard:passProbabilitySelectedExamId';
const DAILY_PRACTICE_CAPACITY_STORAGE_KEY = 'dashboard:dailyPracticeCapacity';

type AnalysisPolicy = 'coverage_adjusted' | 'answered_recent_weighted';

interface Subject {
  name: string;
}

interface SubjectPassProbabilityItem {
  subject: string;
  total_problems: number;
  answered_problems: number;
  coverage_rate: number;
  total_attempts: number;
  correct_attempts: number;
  accuracy_rate: number;
  average_attempts_per_answered: number;
  expected_score: number;
  pass_probability: number;
  weak_problem_count: number;
  strong_problem_count: number;
}

interface PastExamRecordCell {
  attempted_at?: string | null;
  score?: number | null;
}

interface PastExamRecordRow {
  id: string;
  label: string;
  cells: Record<string, PastExamRecordCell>;
}

interface PastExamRecordsBook {
  subject_columns: string[];
  problem_json_mappings: Record<string, string[]>;
  rows: PastExamRecordRow[];
  updated_at?: string | null;
}

interface PastExamRecordEvidence {
  included: boolean;
  columns: string[];
  problem_json_mappings: Record<string, string[]>;
  mapping_applied: boolean;
  ignored_columns: string[];
  record_count: number;
  average_score?: number | null;
  weighted_score?: number | null;
  requested_weight: number;
  effective_weight: number;
}

interface CountdownExam {
  id: number;
  name: string;
  date: string;
}

interface SubjectPracticeRecommendation {
  subject: string;
  recommended_attempts: number;
  daily_attempts?: number | null;
  score_gap: number;
  focus: string;
  reason: string;
}

interface PracticePlan {
  exam_name?: string | null;
  exam_date?: string | null;
  days_to_exam?: number | null;
  daily_practice_capacity: number;
  total_recommended_attempts: number;
  recommended_daily_attempts?: number | null;
  feasible_by_exam_date?: boolean | null;
  time_adjustment_factor: number;
  subject_recommendations: SubjectPracticeRecommendation[];
}

interface PassProbabilityResponse {
  analysis_id: string;
  analysis_policy: AnalysisPolicy;
  subjects: string[];
  passing_score: number;
  total_problems: number;
  answered_problems: number;
  coverage_rate: number;
  total_attempts: number;
  correct_attempts: number;
  accuracy_rate: number;
  average_attempts_per_answered: number;
  base_expected_score: number;
  expected_score: number;
  projected_score_low: number;
  projected_score_high: number;
  pass_probability: number;
  evidence_confidence: number;
  readiness_label: string;
  recommendation: string;
  past_exam_records: PastExamRecordEvidence;
  practice_plan: PracticePlan;
  subject_breakdown: SubjectPassProbabilityItem[];
  analyzed_at: string;
}

interface PassProbabilityHistoryItem {
  analysis_id: string;
  analyzed_at: string;
  pass_probability: number;
}

interface PassProbabilityRequest {
  subjects: string[];
  passingScore: number;
  analysisPolicy: AnalysisPolicy;
  includePastExamRecords: boolean;
  pastExamColumns: string[];
  pastExamWeight: number;
  examId: string;
  examName: string;
  examDate: string;
  dailyPracticeCapacity: number;
}

interface PassProbabilityPanelProps {
  subjects: Subject[];
  selectedSubjectNames: string[];
  setSelectedSubjectNames: (names: string[]) => void;
}

function loadInitialPassingScore() {
  try {
    const raw = localStorage.getItem(PASSING_SCORE_STORAGE_KEY);
    const value = raw ? Number(raw) : 60;
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 60;
  } catch {
    return 60;
  }
}

function loadInitialPastExamWeight() {
  try {
    const raw = localStorage.getItem(PAST_EXAM_WEIGHT_STORAGE_KEY);
    const value = raw ? Number(raw) : 35;
    return Number.isFinite(value) ? Math.max(0, Math.min(80, value)) : 35;
  } catch {
    return 35;
  }
}

function loadInitialIncludePastExamRecords() {
  try {
    return localStorage.getItem(INCLUDE_PAST_EXAM_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadInitialAnalysisPolicy(): AnalysisPolicy {
  try {
    const raw = localStorage.getItem(ANALYSIS_POLICY_STORAGE_KEY);
    return raw === 'answered_recent_weighted' ? 'answered_recent_weighted' : 'coverage_adjusted';
  } catch {
    return 'coverage_adjusted';
  }
}

function loadCountdownExams(): CountdownExam[] {
  try {
    const raw = localStorage.getItem(COUNTDOWN_EXAMS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CountdownExam => (
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'number' &&
        typeof item.name === 'string' &&
        typeof item.date === 'string'
      ))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  } catch {
    return [];
  }
}

function loadInitialSelectedExamId() {
  try {
    return localStorage.getItem(SELECTED_EXAM_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function loadInitialDailyPracticeCapacity() {
  try {
    const raw = localStorage.getItem(DAILY_PRACTICE_CAPACITY_STORAGE_KEY);
    const value = raw ? Number(raw) : 20;
    return Number.isFinite(value) ? Math.max(1, Math.min(500, Math.round(value))) : 20;
  } catch {
    return 20;
  }
}

function analysisPolicyLabel(policy: AnalysisPolicy) {
  return policy === 'answered_recent_weighted' ? '実施済み・直近重視' : '標準';
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatAnalyzedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace('T', ' ');
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scoreCountForColumn(book: PastExamRecordsBook | null, column: string) {
  if (!book) return 0;
  return book.rows.filter((row) => typeof row.cells[column]?.score === 'number').length;
}

function hasProblemJsonMappings(book: PastExamRecordsBook | null) {
  if (!book) return false;
  return book.subject_columns.some((column) => (book.problem_json_mappings[column] ?? []).length > 0);
}

function mappedColumnsForSubjects(book: PastExamRecordsBook | null, subjectNames: string[]) {
  if (!book) return [];
  const subjectNameSet = new Set(subjectNames);
  return book.subject_columns.filter((column) => (
    (book.problem_json_mappings[column] ?? []).some((subjectName) => subjectNameSet.has(subjectName))
  ));
}

function MetricTile({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'sky' | 'emerald' | 'amber';
}) {
  const toneClassName = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClassName}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function PassProbabilityPanel({
  subjects,
  selectedSubjectNames,
  setSelectedSubjectNames,
}: PassProbabilityPanelProps) {
  const [draftSubjectNames, setDraftSubjectNames] = useState<string[]>(selectedSubjectNames);
  const [passingScore, setPassingScore] = useState(loadInitialPassingScore);
  const [analysisPolicy, setAnalysisPolicy] = useState<AnalysisPolicy>(loadInitialAnalysisPolicy);
  const [includePastExamRecords, setIncludePastExamRecords] = useState(loadInitialIncludePastExamRecords);
  const [pastExamWeight, setPastExamWeight] = useState(loadInitialPastExamWeight);
  const [registeredExams, setRegisteredExams] = useState<CountdownExam[]>(loadCountdownExams);
  const [selectedExamId, setSelectedExamId] = useState(loadInitialSelectedExamId);
  const [dailyPracticeCapacity, setDailyPracticeCapacity] = useState(loadInitialDailyPracticeCapacity);
  const [pastExamRecordsBook, setPastExamRecordsBook] = useState<PastExamRecordsBook | null>(null);
  const [selectedPastExamColumns, setSelectedPastExamColumns] = useState<string[]>([]);
  const [isPastExamRecordsLoading, setIsPastExamRecordsLoading] = useState(false);
  const [data, setData] = useState<PassProbabilityResponse | null>(null);
  const [historyItems, setHistoryItems] = useState<PassProbabilityHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [lastRequest, setLastRequest] = useState<PassProbabilityRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const availableSubjectNameSet = useMemo(() => new Set(subjects.map((subject) => subject.name)), [subjects]);
  const draftSubjectNameSet = useMemo(() => new Set(draftSubjectNames), [draftSubjectNames]);
  const selectedPastExamColumnSet = useMemo(() => new Set(selectedPastExamColumns), [selectedPastExamColumns]);
  const hasPastExamMappings = useMemo(() => hasProblemJsonMappings(pastExamRecordsBook), [pastExamRecordsBook]);
  const mappedPastExamColumns = useMemo(
    () => mappedColumnsForSubjects(pastExamRecordsBook, draftSubjectNames),
    [draftSubjectNames, pastExamRecordsBook],
  );
  const selectedExam = useMemo(
    () => registeredExams.find((exam) => String(exam.id) === selectedExamId) ?? null,
    [registeredExams, selectedExamId],
  );
  const pastExamScoreCount = useMemo(() => {
    if (!pastExamRecordsBook) return 0;
    return pastExamRecordsBook.rows.reduce((count, row) => (
      count + selectedPastExamColumns.filter((column) => typeof row.cells[column]?.score === 'number').length
    ), 0);
  }, [pastExamRecordsBook, selectedPastExamColumns]);
  const hasUnappliedChanges = useMemo(() => {
    if (!lastRequest) return draftSubjectNames.length > 0;
    if (lastRequest.passingScore !== passingScore) return true;
    if (lastRequest.analysisPolicy !== analysisPolicy) return true;
    if (lastRequest.includePastExamRecords !== includePastExamRecords) return true;
    if (lastRequest.pastExamWeight !== pastExamWeight) return true;
    if (lastRequest.examId !== (selectedExam ? String(selectedExam.id) : '')) return true;
    if (lastRequest.examDate !== (selectedExam?.date ?? '')) return true;
    if (lastRequest.dailyPracticeCapacity !== dailyPracticeCapacity) return true;
    if (lastRequest.subjects.length !== draftSubjectNames.length) return true;
    const lastSubjectSet = new Set(lastRequest.subjects);
    if (draftSubjectNames.some((subjectName) => !lastSubjectSet.has(subjectName))) return true;
    if (lastRequest.pastExamColumns.length !== selectedPastExamColumns.length) return true;
    const lastPastExamColumnSet = new Set(lastRequest.pastExamColumns);
    return selectedPastExamColumns.some((column) => !lastPastExamColumnSet.has(column));
  }, [analysisPolicy, dailyPracticeCapacity, draftSubjectNames, includePastExamRecords, lastRequest, passingScore, pastExamWeight, selectedExam, selectedPastExamColumns]);

  useEffect(() => {
    try {
      localStorage.setItem(PASSING_SCORE_STORAGE_KEY, String(passingScore));
    } catch {
      // no-op
    }
  }, [passingScore]);

  useEffect(() => {
    try {
      localStorage.setItem(ANALYSIS_POLICY_STORAGE_KEY, analysisPolicy);
    } catch {
      // no-op
    }
  }, [analysisPolicy]);

  useEffect(() => {
    try {
      localStorage.setItem(PAST_EXAM_WEIGHT_STORAGE_KEY, String(pastExamWeight));
      localStorage.setItem(INCLUDE_PAST_EXAM_STORAGE_KEY, String(includePastExamRecords));
    } catch {
      // no-op
    }
  }, [includePastExamRecords, pastExamWeight]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_EXAM_STORAGE_KEY, selectedExamId);
      localStorage.setItem(DAILY_PRACTICE_CAPACITY_STORAGE_KEY, String(dailyPracticeCapacity));
    } catch {
      // no-op
    }
  }, [dailyPracticeCapacity, selectedExamId]);

  useEffect(() => {
    const reloadExams = () => setRegisteredExams(loadCountdownExams());
    window.addEventListener('focus', reloadExams);
    window.addEventListener('storage', reloadExams);
    return () => {
      window.removeEventListener('focus', reloadExams);
      window.removeEventListener('storage', reloadExams);
    };
  }, []);

  useEffect(() => {
    if (registeredExams.length === 0) {
      setSelectedExamId('');
      return;
    }
    setSelectedExamId((current) => {
      if (current && registeredExams.some((exam) => String(exam.id) === current)) {
        return current;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextExam = registeredExams.find((exam) => {
        const date = new Date(exam.date);
        date.setHours(0, 0, 0, 0);
        return date.getTime() >= today.getTime();
      });
      return nextExam ? String(nextExam.id) : String(registeredExams[0]?.id ?? '');
    });
  }, [registeredExams]);

  useEffect(() => {
    setDraftSubjectNames(
      selectedSubjectNames.filter((subjectName) => availableSubjectNameSet.has(subjectName)),
    );
  }, [availableSubjectNameSet, selectedSubjectNames]);

  useEffect(() => {
    let isMounted = true;

    const loadPastExamRecords = async () => {
      setIsPastExamRecordsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/dashboard/past-exam-records`);
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.detail || '過去問と模試記録の取得に失敗しました。');
        }
        if (!isMounted) return;
        setPastExamRecordsBook(payload);
        setSelectedPastExamColumns((current) => {
          const columns = Array.isArray(payload?.subject_columns) ? payload.subject_columns : [];
          const available = new Set(columns);
          const next = current.filter((column) => available.has(column));
          return next.length > 0 ? next : columns;
        });
      } catch (e) {
        if (isMounted) {
          setPastExamRecordsBook(null);
          setSelectedPastExamColumns([]);
        }
      } finally {
        if (isMounted) {
          setIsPastExamRecordsLoading(false);
        }
      }
    };

    void loadPastExamRecords();
    window.addEventListener('dashboard:pastExamRecordsUpdated', loadPastExamRecords);
    return () => {
      isMounted = false;
      window.removeEventListener('dashboard:pastExamRecordsUpdated', loadPastExamRecords);
    };
  }, []);

  useEffect(() => {
    if (!pastExamRecordsBook) return;
    const columns = pastExamRecordsBook.subject_columns;
    if (hasPastExamMappings) {
      setSelectedPastExamColumns(mappedPastExamColumns);
      return;
    }
    setSelectedPastExamColumns((current) => {
      const available = new Set(columns);
      const next = current.filter((column) => available.has(column));
      return next.length > 0 ? next : columns;
    });
  }, [hasPastExamMappings, mappedPastExamColumns, pastExamRecordsBook]);

  const loadHistory = async () => {
    setIsHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/pass-probability/history?limit=10`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || '合格可能性の履歴取得に失敗しました。');
      }
      setHistoryItems(Array.isArray(payload) ? payload : []);
    } catch {
      setHistoryItems([]);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const runAnalysis = async () => {
    const targetSubjects = Array.from(new Set(draftSubjectNames))
      .filter((subjectName) => availableSubjectNameSet.has(subjectName));
    if (targetSubjects.length === 0) {
      setData(null);
      setLastRequest(null);
      setError('対象問題jsonが未選択です。');
      return;
    }

    setSelectedSubjectNames(targetSubjects);
    setIsLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      targetSubjects.forEach((subject) => query.append('subjects', subject));
      query.append('passing_score', String(passingScore));
      query.append('analysis_policy', analysisPolicy);
      if (includePastExamRecords) {
        query.append('include_past_exam_records', 'true');
        selectedPastExamColumns.forEach((column) => query.append('past_exam_columns', column));
        query.append('past_exam_weight', String(pastExamWeight / 100));
      }
      if (selectedExam) {
        query.append('exam_name', selectedExam.name);
        query.append('exam_date', selectedExam.date);
      }
      query.append('daily_practice_capacity', String(dailyPracticeCapacity));
      const response = await fetch(`${API_BASE_URL}/dashboard/pass-probability?${query.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || '合格可能性の取得に失敗しました。');
      }
      setData(payload);
      setLastRequest({
        subjects: targetSubjects,
        passingScore,
        analysisPolicy,
        includePastExamRecords,
        pastExamColumns: includePastExamRecords ? selectedPastExamColumns : [],
        pastExamWeight,
        examId: selectedExam ? String(selectedExam.id) : '',
        examName: selectedExam?.name ?? '',
        examDate: selectedExam?.date ?? '',
        dailyPracticeCapacity,
      });
      void loadHistory();
    } catch (e: any) {
      setData(null);
      setLastRequest(null);
      setError(e.message || '合格可能性の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSubject = (subjectName: string) => {
    if (draftSubjectNameSet.has(subjectName)) {
      setDraftSubjectNames(draftSubjectNames.filter((name) => name !== subjectName));
    } else {
      setDraftSubjectNames([...draftSubjectNames, subjectName]);
    }
  };

  const togglePastExamColumn = (column: string) => {
    if (selectedPastExamColumnSet.has(column)) {
      setSelectedPastExamColumns(selectedPastExamColumns.filter((item) => item !== column));
    } else {
      setSelectedPastExamColumns([...selectedPastExamColumns, column]);
    }
  };

  const readinessTone = data && data.pass_probability >= 75
    ? 'text-emerald-700'
    : data && data.pass_probability >= 50
      ? 'text-sky-700'
      : data && data.pass_probability >= 30
        ? 'text-amber-700'
        : 'text-rose-700';

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Readiness</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">合格可能性</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,18rem)_10rem_minmax(0,16rem)_10rem] xl:items-end">
          <label>
            <span className="block text-xs font-semibold text-slate-600">対象問題json</span>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraftSubjectNames(subjects.map((subject) => subject.name))}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                すべて
              </button>
              <button
                type="button"
                onClick={() => setDraftSubjectNames([])}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                解除
              </button>
              <span className="text-xs text-slate-500">{draftSubjectNames.length}件</span>
            </div>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600">合格ライン</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={passingScore}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPassingScore(Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
                }}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
              <span className="text-sm font-semibold text-slate-500">点</span>
            </div>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600">試験日</span>
            <select
              value={selectedExamId}
              onChange={(event) => setSelectedExamId(event.target.value)}
              onFocus={() => setRegisteredExams(loadCountdownExams())}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">{registeredExams.length > 0 ? '未選択' : '登録なし'}</option>
              {registeredExams.map((exam) => (
                <option key={exam.id} value={String(exam.id)}>
                  {exam.name} / {exam.date}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600">1日の演習上限</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                value={dailyPracticeCapacity}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDailyPracticeCapacity(Number.isFinite(value) ? Math.max(1, Math.min(500, Math.round(value))) : 1);
                }}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
              <span className="text-sm font-semibold text-slate-500">問</span>
            </div>
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-semibold text-slate-600">分析方針</span>
        <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
          {(['coverage_adjusted', 'answered_recent_weighted'] as AnalysisPolicy[]).map((policy) => (
            <button
              key={policy}
              type="button"
              onClick={() => setAnalysisPolicy(policy)}
              className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                analysisPolicy === policy
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {analysisPolicyLabel(policy)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={includePastExamRecords}
              onChange={(event) => setIncludePastExamRecords(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span>実戦点数を反映</span>
          </label>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>保存済み {pastExamScoreCount}件</span>
            {hasPastExamMappings && (
              <span>JSON対応 {mappedPastExamColumns.length}列</span>
            )}
            <label className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">反映比率</span>
              <input
                type="range"
                min={0}
                max={80}
                step={5}
                value={pastExamWeight}
                disabled={!includePastExamRecords}
                onChange={(event) => setPastExamWeight(Number(event.target.value))}
                className="w-28 accent-sky-600 disabled:opacity-40"
              />
              <span className="w-10 text-right text-xs font-semibold text-slate-700">{pastExamWeight}%</span>
            </label>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {isPastExamRecordsLoading ? (
            <p className="text-sm text-slate-500">読み込み中...</p>
          ) : pastExamRecordsBook && pastExamRecordsBook.subject_columns.length > 0 ? (
            pastExamRecordsBook.subject_columns.map((column) => {
              const scoreCount = scoreCountForColumn(pastExamRecordsBook, column);
              const mappedSubjects = pastExamRecordsBook.problem_json_mappings[column] ?? [];
              const isMappedToTarget = mappedSubjects.some((subjectName) => draftSubjectNameSet.has(subjectName));
              const isSelectable = !hasPastExamMappings || isMappedToTarget;
              return (
                <label key={column} className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedPastExamColumnSet.has(column)}
                    disabled={!includePastExamRecords || !isSelectable}
                    onChange={() => togglePastExamColumn(column)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-40"
                  />
                  <span className="truncate" title={column}>{column}</span>
                  <span className="shrink-0 text-xs text-slate-400">{scoreCount}</span>
                  {hasPastExamMappings && (
                    <span className={`shrink-0 text-xs font-semibold ${isMappedToTarget ? 'text-sky-700' : 'text-slate-400'}`}>
                      {isMappedToTarget ? '対応' : '対象外'}
                    </span>
                  )}
                </label>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">保存済み記録なし</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          {data ? (
            <span>
              分析済み: {data.subjects.length}件 / {analysisPolicyLabel(data.analysis_policy)} / 合格ライン {data.passing_score.toFixed(1)}点 / 保存ID {data.analysis_id.slice(-8)}
            </span>
          ) : (
            <span>分析済みデータはありません。</span>
          )}
          {data?.past_exam_records.included && (
            <span className="ml-2">
              実戦 {data.past_exam_records.record_count}件 / 反映 {(data.past_exam_records.effective_weight * 100).toFixed(0)}%
            </span>
          )}
          {data?.past_exam_records.mapping_applied && (
            <span className="ml-2">
              JSON対応 {data.past_exam_records.columns.length}列
            </span>
          )}
          {data?.practice_plan.exam_date && (
            <span className="ml-2">
              試験まで {data.practice_plan.days_to_exam ?? '-'}日 / 1日上限 {data.practice_plan.daily_practice_capacity}問
            </span>
          )}
          {hasUnappliedChanges && <span className="ml-2 font-semibold text-amber-700">未分析の変更あり</span>}
        </div>
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={isLoading || draftSubjectNames.length === 0}
          className="rounded-md bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-500"
        >
          {isLoading ? '分析中...' : '分析する'}
        </button>
      </div>

      <div className="mt-4 max-h-28 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <label key={subject.name} className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draftSubjectNameSet.has(subject.name)}
                onChange={() => toggleSubject(subject.name)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span className="truncate" title={subject.name}>{subject.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">分析履歴</p>
          {isHistoryLoading && <span className="text-xs text-slate-400">読み込み中...</span>}
        </div>
        {historyItems.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {historyItems.map((item) => (
              <div key={item.analysis_id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-slate-600">{formatAnalyzedAt(item.analyzed_at)}</span>
                <span className="font-bold text-slate-900">{formatPercent(item.pass_probability)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-4 text-sm text-slate-500">履歴はまだありません。</div>
        )}
      </div>

      <div className="mt-5">
        {isLoading ? (
          <div className="py-8">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : draftSubjectNames.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            対象問題jsonが未選択です。
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
              <div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-500">合格ライン到達可能性</p>
                    <p className={`mt-1 text-5xl font-bold ${readinessTone}`}>{formatPercent(data.pass_probability)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-500">判定</p>
                    <p className={`mt-1 text-xl font-bold ${readinessTone}`}>{data.readiness_label}</p>
                  </div>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-sky-600 transition-all"
                    style={{ width: `${Math.max(2, Math.min(100, data.pass_probability))}%` }}
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{data.recommendation}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MetricTile label="最終推定" value={`${data.expected_score.toFixed(1)}点`} tone="sky" />
                <MetricTile label="想定レンジ" value={`${data.projected_score_low.toFixed(0)}-${data.projected_score_high.toFixed(0)}`} />
                <MetricTile label="進捗" value={formatPercent(data.coverage_rate)} tone="emerald" />
                <MetricTile label="根拠信頼度" value={formatPercent(data.evidence_confidence)} tone="amber" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <MetricTile label="問題総数" value={`${data.total_problems}`} />
              <MetricTile label="実施済み問題" value={`${data.answered_problems}`} />
              <MetricTile label="総回答回数" value={`${data.total_attempts}`} />
              <MetricTile label="正答率" value={formatPercent(data.accuracy_rate)} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <MetricTile
                label="試験まで"
                value={data.practice_plan.days_to_exam != null ? `${data.practice_plan.days_to_exam}日` : '-'}
                tone="sky"
              />
              <MetricTile
                label="推奨演習"
                value={`${data.practice_plan.total_recommended_attempts}問`}
                tone="emerald"
              />
              <MetricTile
                label="1日目安"
                value={data.practice_plan.recommended_daily_attempts != null ? `${data.practice_plan.recommended_daily_attempts}問` : '-'}
              />
              <MetricTile
                label="日程"
                value={
                  data.practice_plan.feasible_by_exam_date == null
                    ? '未指定'
                    : data.practice_plan.feasible_by_exam_date ? '収まる' : '不足'
                }
                tone={data.practice_plan.feasible_by_exam_date === false ? 'amber' : 'emerald'}
              />
            </div>

            {data.past_exam_records.included && (
              <div className="grid gap-3 md:grid-cols-4">
                <MetricTile label="問題演習推定" value={`${data.base_expected_score.toFixed(1)}点`} />
                <MetricTile
                  label="実戦点数"
                  value={data.past_exam_records.weighted_score != null ? `${data.past_exam_records.weighted_score.toFixed(1)}点` : '-'}
                  tone="emerald"
                />
                <MetricTile label="実戦記録数" value={`${data.past_exam_records.record_count}`} />
                <MetricTile label="実効反映" value={formatPercent(data.past_exam_records.effective_weight * 100)} tone="amber" />
              </div>
            )}

            {data.past_exam_records.mapping_applied && (
              <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                <p className="font-semibold">実戦点数の対応列</p>
                <p className="mt-1">
                  {data.past_exam_records.columns.length > 0 ? data.past_exam_records.columns.join(' / ') : '対応する列なし'}
                  {data.past_exam_records.ignored_columns.length > 0 && (
                    <span className="text-sky-700">
                      {' '}対象外: {data.past_exam_records.ignored_columns.join(' / ')}
                    </span>
                  )}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-700">算定ロジック</p>
              <p className="mt-1">
                {data.analysis_policy === 'answered_recent_weighted'
                  ? '未解答問題は推定得点の母集団から外し、解答済み問題は直近5回の重み付き正答率と最後の正誤を強めに見て問題ごとの推定正答確率を出します。'
                  : '未実施問題は対象内の初回正答率と同じ値で置き、実施済み問題は累計正答率、直近5回の重み付き正答率、最後の正誤を混ぜて問題ごとの推定正答確率を出します。'}
                実戦点数を反映する場合は、問題JSONマッピングに一致する科目列だけを使い、新しい模試/過去問ほど重く平均し、指定比率を上限に最終推定へ混ぜます。
                その推定得点を、問題数由来のばらつき、合格ラインとの差、履歴量・進捗による根拠信頼度で合格ライン到達可能性へ補正します。
                試験日を選択した場合は、問題JSONごとの不足点、未実施数、弱点数から推奨演習量を出し、残日数と1日の演習上限に収まるかで可能性を時間補正します。
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[1120px] w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-3 py-3">問題json</th>
                    <th className="px-3 py-3 text-right">進捗</th>
                    <th className="px-3 py-3 text-right">正答率</th>
                    <th className="px-3 py-3 text-right">推定得点</th>
                    <th className="px-3 py-3 text-right">可能性</th>
                    <th className="px-3 py-3 text-right">弱点</th>
                    <th className="px-3 py-3 text-right">安定</th>
                    <th className="px-3 py-3 text-right">推奨演習</th>
                    <th className="px-3 py-3 text-right">1日目安</th>
                    <th className="px-3 py-3">重点</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.subject_breakdown.map((item) => {
                    const recommendation = data.practice_plan.subject_recommendations.find((entry) => entry.subject === item.subject);
                    return (
                      <tr key={item.subject} className="hover:bg-slate-50">
                        <td className="max-w-[20rem] truncate px-3 py-3 font-semibold text-slate-800" title={item.subject}>{item.subject}</td>
                        <td className="px-3 py-3 text-right text-slate-600">
                          {item.answered_problems}/{item.total_problems} ({formatPercent(item.coverage_rate)})
                        </td>
                        <td className="px-3 py-3 text-right text-slate-600">{formatPercent(item.accuracy_rate)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{item.expected_score.toFixed(1)}点</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-800">{formatPercent(item.pass_probability)}</td>
                        <td className="px-3 py-3 text-right text-rose-700">{item.weak_problem_count}</td>
                        <td className="px-3 py-3 text-right text-emerald-700">{item.strong_problem_count}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-800">{recommendation?.recommended_attempts ?? 0}問</td>
                        <td className="px-3 py-3 text-right text-slate-600">
                          {recommendation?.daily_attempts != null ? `${recommendation.daily_attempts}問` : '-'}
                        </td>
                        <td className="max-w-[16rem] px-3 py-3 text-slate-600" title={recommendation?.reason ?? ''}>
                          {recommendation?.focus ?? '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            未分析です。
          </div>
        )}
      </div>
    </section>
  );
}
