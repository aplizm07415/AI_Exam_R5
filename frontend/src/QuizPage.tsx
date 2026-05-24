import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import SubjectVisibilityModal from './components/SubjectVisibilityModal';
import SubjectProgress from './components/SubjectProgress';
import { usePlans } from './hooks/usePlans';
import type { Plan } from './types/plan.d';
import { getMinutesUntilJstHour, getNowJstParts, getTodayYmdJst } from './utils/date';
import { buildPlanSchedule } from './utils/planSchedule';

const API_BASE_URL = "/api";
const QUESTION_TIMER_MS = 2 * 60 * 1000;
const FORCED_ANSWER_TIMER_MS = 80 * 1000;
const SPECIFIC_AREA_PROGRESS_STEPS = [
  '条件を確認中',
  '問題文・解説を照合中',
  '対象件数を集計中',
] as const;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

interface Choice {
  label: string;
  text: string;
}

interface Explanation {
  text: string;
}

interface QuizQuestion {
  id: string;
  question_text: string;
  choices: Choice[];
  answer: string;
  subject: string;
  explanation: Explanation;
  category?: string;
  image_urls?: string[];
  explanation_image_urls?: string[];
  custom_explanation?: string;
  custom_explanation_image_data_url?: string | undefined;
  custom_question_image_data_url?: string | undefined;
  custom_explanation_image_data_urls?: string[];
  custom_question_image_data_urls?: string[];
}

interface Subject {
  name: string;
}

interface QuizPageProps {
  subjects: Subject[];
}

interface DailySummaryItem {
  date: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
}

interface HistoryStat {
  total: number;
  correct: number;
}

type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining' | 'specific_area';
type OralVivaStep = 'root' | 'refute' | 'apply' | 'summary';

interface OralVivaMessage {
  role: 'assistant' | 'user';
  content: string;
}

interface OralVivaScores {
  logicality: number;
  specificity: number;
  reproducibility: number;
}

interface OralVivaResponse {
  step: OralVivaStep;
  assistant_message: string;
  scores: OralVivaScores;
  is_final_step: boolean;
  improvement_points: string[];
  mini_quiz_question?: string | null;
  mini_quiz_answer?: string | null;
  memo_summary?: string | null;
}

interface QuestionHelpResponse {
  assistant_message: string;
  suggested_followups: string[];
  used_ai: boolean;
}

type IpadProfile = 'air' | 'mini';
type SpecificAreaHistoryScope = 'all' | 'unanswered' | 'answered';

type QuizTimelineItem = {
  key: string;
  label: string;
  state: 'prev' | 'current' | 'upcoming' | 'gap';
};

const getCustomImageUrls = (
  urls: string[] | undefined,
  legacyUrl: string | undefined,
): string[] => {
  const normalized = (urls ?? []).filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
  if (normalized.length > 0) {
    return normalized;
  }
  return legacyUrl && legacyUrl.trim() ? [legacyUrl] : [];
};

function TimerProgressBar({
  durationMs,
  isActive,
  resetToken,
  onExpire,
}: {
  durationMs: number;
  isActive: boolean;
  resetToken: string;
  onExpire?: (() => void) | undefined;
}) {
  const [remainingRatio, setRemainingRatio] = useState(1);
  const expireHandledRef = useRef(false);

  useEffect(() => {
    setRemainingRatio(1);
    expireHandledRef.current = false;

    if (!isActive) {
      return;
    }

    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Math.max(0, Date.now() - startedAt);
      const nextRatio = Math.max(0, Math.min(1, 1 - elapsed / durationMs));
      setRemainingRatio(nextRatio);

      if (elapsed >= durationMs && !expireHandledRef.current) {
        expireHandledRef.current = true;
        onExpire?.();
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [durationMs, isActive, onExpire, resetToken]);

  return (
    <div className="w-full h-2.5 rounded-full bg-gray-200/90 border border-gray-200 mb-6 pointer-events-none" aria-hidden="true">
      <div
        className="h-full rounded-full bg-[#a2c2e6] transition-[width] duration-200 ease-linear"
        style={{ width: `${remainingRatio * 100}%` }}
      />
    </div>
  );
}

function buildQuizTimelineItems(total: number, currentIndex: number): QuizTimelineItem[] {
  if (total <= 0) {
    return [];
  }

  const currentStep = currentIndex + 1;
  const visibleSteps = new Set<number>();

  if (total <= 7) {
    for (let step = 1; step <= total; step += 1) {
      visibleSteps.add(step);
    }
  } else {
    visibleSteps.add(1);
    visibleSteps.add(total);

    for (let step = currentStep - 1; step <= currentStep + 1; step += 1) {
      if (step >= 1 && step <= total) {
        visibleSteps.add(step);
      }
    }

    if (currentStep <= 3) {
      visibleSteps.add(2);
      visibleSteps.add(3);
      visibleSteps.add(4);
    }

    if (currentStep >= total - 2) {
      visibleSteps.add(total - 3);
      visibleSteps.add(total - 2);
      visibleSteps.add(total - 1);
    }
  }

  const orderedSteps = Array.from(visibleSteps)
    .filter((step) => step >= 1 && step <= total)
    .sort((a, b) => a - b);

  const items: QuizTimelineItem[] = [];

  orderedSteps.forEach((step, index) => {
    const previousStep = index > 0 ? orderedSteps[index - 1] : undefined;
    if (previousStep !== undefined && step - previousStep > 1) {
      items.push({
        key: `gap-${previousStep}-${step}`,
        label: '...',
        state: 'gap',
      });
    }

    items.push({
      key: `step-${step}`,
      label: String(step),
      state: step < currentStep ? 'prev' : step === currentStep ? 'current' : 'upcoming',
    });
  });

  return items;
}

export default function QuizPage({ subjects: allSubjects }: QuizPageProps) {
  const { plans, isLoading: isPlansLoading, error: plansError } = usePlans();
  const [dailySummaryAll, setDailySummaryAll] = useState<DailySummaryItem[]>([]);
  const [selectedSubjectNames, setSelectedSubjectNames] = useState<string[]>([]);
  const [quizMode, setQuizMode] = useState<QuizMode>('today_remaining');
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const [quizState, setQuizState] = useState<'setup' | 'active' | 'finished'>('setup');
  const [isForcedSession, setIsForcedSession] = useState(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [historyStats, setHistoryStats] = useState<Record<string, HistoryStat>>({});

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: Explanation } | null>(null);
  const [score, setScore] = useState(0);
  const [scratchpadText, setScratchpadText] = useState('');
  const [customExplanationText, setCustomExplanationText] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [editingMemo, setEditingMemo] = useState<{type: 'scratchpad' | 'customExplanation', content: string} | null>(null);
  const [editingProblem, setEditingProblem] = useState<QuizQuestion | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isSavingCustomExplanation, setIsSavingCustomExplanation] = useState(false);
  const [reviewLaterKeys, setReviewLaterKeys] = useState<string[]>([]);
  const [isUpdatingReviewLater, setIsUpdatingReviewLater] = useState(false);
  const [error, setError] = useState('');
  const [effectStatus, setEffectStatus] = useState<'correct' | 'incorrect' | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<number>(Date.now());
  const [isScratchpadOpen, setIsScratchpadOpen] = useState(false);
  const [adhocQuizLabel, setAdhocQuizLabel] = useState('');
  const [isOralVivaActive, setIsOralVivaActive] = useState(false);
  const [oralVivaStepIndex, setOralVivaStepIndex] = useState(0);
  const [oralVivaMessages, setOralVivaMessages] = useState<OralVivaMessage[]>([]);
  const [oralVivaInput, setOralVivaInput] = useState('');
  const [oralVivaScores, setOralVivaScores] = useState<OralVivaScores>({
    logicality: 0,
    specificity: 0,
    reproducibility: 0,
  });
  const [oralVivaResult, setOralVivaResult] = useState<{
    improvementPoints: string[];
    miniQuizQuestion: string;
    miniQuizAnswer: string;
  } | null>(null);
  const [isOralVivaLoading, setIsOralVivaLoading] = useState(false);
  const [isQuestionHelpActive, setIsQuestionHelpActive] = useState(false);
  const [questionHelpMessages, setQuestionHelpMessages] = useState<OralVivaMessage[]>([]);
  const [questionHelpInput, setQuestionHelpInput] = useState('');
  const [questionHelpSuggestedFollowups, setQuestionHelpSuggestedFollowups] = useState<string[]>([]);
  const [isQuestionHelpLoading, setIsQuestionHelpLoading] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const [isListeningSpeech, setIsListeningSpeech] = useState(false);
  const questionTopRef = useRef<HTMLDivElement | null>(null);
  const oralVivaMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const questionHelpMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const shuffledChoicesByQuestionRef = useRef<Record<string, Choice[]>>({});
  const prefetchedImageUrlsRef = useRef<Set<string>>(new Set());
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const currentQuestion = questions[currentQuestionIndex];
  const currentQuestionImageDataUrls = currentQuestion
    ? getCustomImageUrls(currentQuestion.custom_question_image_data_urls, currentQuestion.custom_question_image_data_url)
    : [];
  const currentExplanationImageDataUrls = currentQuestion
    ? getCustomImageUrls(currentQuestion.custom_explanation_image_data_urls, currentQuestion.custom_explanation_image_data_url)
    : [];

  const openMemoModal = (type: 'scratchpad' | 'customExplanation') => {
    const content = type === 'scratchpad' ? scratchpadText : customExplanationText;
    setEditingMemo({ type, content });
  };

  const buildReviewKey = useCallback((subject: string, problemId: string) => `${subject}::${problemId}`, []);
  const oralVivaSteps: OralVivaStep[] = ['root', 'refute', 'apply', 'summary'];
  const oralVivaStepLabels: Record<OralVivaStep, string> = {
    root: '根拠',
    refute: '反証',
    apply: '応用',
    summary: '要約',
  };

  const ensureShuffledChoicesForQuestion = useCallback((question: QuizQuestion) => {
    const existing = shuffledChoicesByQuestionRef.current[question.id];
    if (existing && existing.length === question.choices.length) {
      return existing;
    }
    const shuffled = [...question.choices];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j] as Choice;
      shuffled[j] = tmp as Choice;
    }
    shuffledChoicesByQuestionRef.current[question.id] = shuffled;
    return shuffled;
  }, []);

  const handleSaveAndCloseModal = () => {
    if (!editingMemo) return;
    if (editingMemo.type === 'scratchpad') {
        setScratchpadText(editingMemo.content);
    } else {
        setCustomExplanationText(editingMemo.content);
    }
    setEditingMemo(null);
  };

  // --- Problem Editing Functions ---
  const openProblemEditor = () => {
    if (currentQuestion) {
      setEditingProblem({ ...currentQuestion });
    }
  };

  const handleProblemFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!editingProblem) return;
    const { name, value } = e.target;

    if (name.startsWith('explanation.')) {
      const key = name.split('.')[1] as keyof Explanation;
      setEditingProblem({
        ...editingProblem,
        explanation: {
          ...editingProblem.explanation,
          [key]: value,
        },
      });
    } else {
      setEditingProblem({ ...editingProblem, [name]: value });
    }
  };

  const handleProblemChoiceChange = (index: number, field: 'label' | 'text', value: string) => {
    if (!editingProblem) return;
    const newChoices = [...editingProblem.choices];
    newChoices[index] = { ...newChoices[index], [field]: value } as Choice;
    setEditingProblem({ ...editingProblem, choices: newChoices });
  };

  const handleSaveChanges = async () => {
    if (!editingProblem) return;

    try {
      const {
        image_urls,
        explanation_image_urls,
        custom_explanation,
        custom_explanation_image_data_url,
        custom_question_image_data_url,
        custom_explanation_image_data_urls,
        custom_question_image_data_urls,
        ...payload
      } = editingProblem;
      
      const response = await fetch(`/api/subjects/${encodeURIComponent(editingProblem.subject)}/problems/${encodeURIComponent(editingProblem.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || '問題の更新に失敗しました。');
      }

      const updatedProblem = await response.json();
      
      // フロントエンドの状態を即時更新
      const updatedQuestions = questions.map(q => 
        q.id === editingProblem.id ? { ...q, ...updatedProblem } : q
      );
      setQuestions(updatedQuestions);
      
      setEditingProblem(null); // モーダルを閉じる

    } catch (error: any) {
      console.error("Failed to save problem changes:", error);
      alert(`保存に失敗しました: ${error.message}`);
    }
  };
  // --- End of Problem Editing Functions ---

  const fetchReviewLaterItems = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/review-later`);
      if (!response.ok) {
        throw new Error('後で確認一覧の取得に失敗しました。');
      }
      const data: Array<{ subject: string; problem_id: string }> = await response.json();
      setReviewLaterKeys(data.map((item) => buildReviewKey(item.subject, item.problem_id)));
    } catch (fetchError) {
      console.error(fetchError);
    }
  }, [buildReviewKey]);

  const toggleReviewLater = async () => {
    if (!currentQuestion || isUpdatingReviewLater) return;
    const reviewKey = buildReviewKey(currentQuestion.subject, currentQuestion.id);
    const alreadyRegistered = reviewLaterKeys.includes(reviewKey);

    try {
      setIsUpdatingReviewLater(true);
      const requestInit: RequestInit = alreadyRegistered
        ? { method: 'DELETE' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: currentQuestion.subject, problem_id: currentQuestion.id }),
          };
      const response = await fetch(
        alreadyRegistered
          ? `${API_BASE_URL}/review-later/${encodeURIComponent(currentQuestion.id)}?subject=${encodeURIComponent(currentQuestion.subject)}`
          : `${API_BASE_URL}/review-later`,
        requestInit
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '後で確認の更新に失敗しました。');
      }
      setReviewLaterKeys((prev) =>
        alreadyRegistered ? prev.filter((key) => key !== reviewKey) : [...prev, reviewKey]
      );
    } catch (toggleError) {
      console.error(toggleError);
      const message = toggleError instanceof Error ? toggleError.message : '後で確認の更新に失敗しました。';
      setError(message);
    } finally {
      setIsUpdatingReviewLater(false);
    }
  };

  const [subjectWeights, setSubjectWeights] = useState<{ [key: string]: 'light' | 'normal' | 'heavy' }>(() => {
    try {
      const saved = localStorage.getItem('subjectWeights');
      return saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.error('Failed to parse subjectWeights from localStorage', error);
      return {};
    }
  });

  const [unansweredCount, setUnansweredCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);
  const [weakAreaCount, setWeakAreaCount] = useState<number | null>(null);
  const [isWeakCountLoading, setIsWeakCountLoading] = useState(false);
  const [specificAreaKeywords, setSpecificAreaKeywords] = useState<string[]>(['']);
  const [specificAreaCount, setSpecificAreaCount] = useState<number | null>(null);
  const [isSpecificAreaCountLoading, setIsSpecificAreaCountLoading] = useState(false);
  const [specificAreaCountError, setSpecificAreaCountError] = useState('');
  const [specificAreaProgressStep, setSpecificAreaProgressStep] = useState(0);
  const [lastSpecificAreaInvestigationSignature, setLastSpecificAreaInvestigationSignature] = useState<string | null>(null);
  const [specificAreaHistoryScope, setSpecificAreaHistoryScope] = useState<SpecificAreaHistoryScope>('all');
  const [specificAreaSuggestions, setSpecificAreaSuggestions] = useState<string[]>([]);
  const [isSpecificAreaSuggestionsLoading, setIsSpecificAreaSuggestionsLoading] = useState(false);
  const specificAreaProgressTimerRef = useRef<number | null>(null);
  const normalizedSpecificAreaKeywords = useMemo(
    () => specificAreaKeywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0),
    [specificAreaKeywords],
  );
  const specificAreaInvestigationSignature = useMemo(
    () =>
      JSON.stringify({
        subjects: [...selectedSubjectNames].sort(),
        keywords: [...normalizedSpecificAreaKeywords].sort(),
        historyScope: specificAreaHistoryScope,
      }),
    [selectedSubjectNames, normalizedSpecificAreaKeywords, specificAreaHistoryScope],
  );
  const isSpecificAreaInvestigationReady = selectedSubjectNames.length > 0 && normalizedSpecificAreaKeywords.length > 0;
  const isSpecificAreaInvestigationStale =
    isSpecificAreaInvestigationReady && lastSpecificAreaInvestigationSignature !== specificAreaInvestigationSignature;
  const hasSpecificAreaInvestigationResult =
    isSpecificAreaInvestigationReady &&
    !isSpecificAreaInvestigationStale &&
    specificAreaCount !== null &&
    !specificAreaCountError;

  const clearSpecificAreaProgressTimer = useCallback(() => {
    if (specificAreaProgressTimerRef.current !== null) {
      window.clearInterval(specificAreaProgressTimerRef.current);
      specificAreaProgressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('subjectWeights', JSON.stringify(subjectWeights));
  }, [subjectWeights]);

  useEffect(() => {
    const fetchDailySummaryAll = async () => {
      const planSubjects = Array.from(new Set(
        plans.filter(p => p.enabled).flatMap(p => p.subjectNames)
      ));

      if (planSubjects.length === 0) {
        setDailySummaryAll([]);
        return;
      }

      try {
        const subjectParams = planSubjects.map(s => `subjects=${encodeURIComponent(s)}`).join('&');
        const response = await fetch(`${API_BASE_URL}/history/daily-summary/all?${subjectParams}`);
        if (response.ok) {
          const data = await response.json();
          setDailySummaryAll(data);
        } else {
          // エラーレスポンスのテキストをログに出力
          const errorText = await response.text();
          console.error("Failed to fetch filtered daily summary:", response.status, errorText);
          setDailySummaryAll([]); // エラーの場合は空にする
        }
      } catch (error) {
        console.error("Failed to fetch all daily summary:", error);
        setDailySummaryAll([]); // エラーの場合は空にする
      }
    };
    if (!isPlansLoading) {
        fetchDailySummaryAll();
    }
  }, [plans, isPlansLoading]);
  
  const todayRemaining = useMemo(() => {
    if (isPlansLoading) return { count: 0, subjects: [], plan: 0, actual: 0 };
    const todayYmd = getTodayYmdJst();
    const activePlans = plans.filter((p: Plan) => p.enabled);
    const targetSubjects = new Set<string>();
    activePlans.forEach((plan) => {
      plan.subjectNames.forEach((name: string) => targetSubjects.add(name));
    });

    const actualsMap = new Map(dailySummaryAll.filter(item => item.date).map(item => [item.date, item.total_questions]));
    const schedule = buildPlanSchedule(activePlans, actualsMap, todayYmd);
    const todayRow = schedule.rows.find((row) => row.date === todayYmd);

    const cumulativePlannedTotal = todayRow?.planCumulative ?? 0;
    const cumulativeActualTotal = todayRow?.actualCumulative ?? 0;
    const remaining = todayRow ? Math.max(0, todayRow.planDaily - todayRow.actualDaily) : 0;

    return {
      count: remaining,
      subjects: Array.from(targetSubjects),
      plan: cumulativePlannedTotal,
      actual: cumulativeActualTotal
    };
  }, [plans, dailySummaryAll, isPlansLoading]);

  useEffect(() => {
    if (quizMode === 'today_remaining') {
      setSelectedSubjectNames(todayRemaining.subjects);
    }
  }, [quizMode, todayRemaining]);

  useEffect(() => {
    if (quizState !== 'setup') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('adhoc') !== '1') return;
    const raw = sessionStorage.getItem('adhocQuizSet');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as QuizQuestion[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('類題セットが空です。');
      }
      setQuestions(parsed);
      setCurrentQuestionIndex(0);
      setScore(0);
      setIsForcedSession(false);
      setQuizState('active');
      setSelectedSubjectNames(Array.from(new Set(parsed.map((q) => q.subject).filter(Boolean))));
      setAdhocQuizLabel(sessionStorage.getItem('adhocQuizLabel') || '類題演習');
      shuffledChoicesByQuestionRef.current = {};
      prefetchedImageUrlsRef.current = new Set();
      resetQuestionState();
      sessionStorage.removeItem('adhocQuizSet');
      sessionStorage.removeItem('adhocQuizLabel');
      params.delete('adhoc');
      const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : '類題セットの読み込みに失敗しました。';
      setError(message);
      sessionStorage.removeItem('adhocQuizSet');
      sessionStorage.removeItem('adhocQuizLabel');
    }
  }, [quizState]);

  // 科目表示制御
  const [hiddenSubjects, setHiddenSubjects] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('hiddenSubjects');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Failed to parse hiddenSubjects from localStorage', error);
      return [];
    }
  });
  const [isVisibilityModalOpen, setIsVisibilityModalOpen] = useState(false);

  const visibleSubjects = useMemo(() => {
    return allSubjects.filter((s: Subject) => !hiddenSubjects.includes(s.name));
  }, [allSubjects, hiddenSubjects]);

  const handleHiddenSubjectsChange = (newHiddenSubjects: string[]) => {
    setHiddenSubjects(newHiddenSubjects);
    localStorage.setItem('hiddenSubjects', JSON.stringify(newHiddenSubjects));
    setSelectedSubjectNames((prev: string[]) => prev.filter((name: string) => !newHiddenSubjects.includes(name)));
  };

  useEffect(() => {
    const fetchUnansweredCount = async () => {
      if (quizMode === 'unanswered' && selectedSubjectNames.length > 0) {
        setIsCountLoading(true);
        setUnansweredCount(null);
        try {
          const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
          const response = await fetch(`${API_BASE_URL}/quiz/unanswered-count?${subjectParams}`);
          if (!response.ok) {
            throw new Error('Failed to fetch unanswered count.');
          }
          const data = await response.json();
          setUnansweredCount(data.unanswered_count);
        } catch (error) {
          console.error(error);
        } finally {
          setIsCountLoading(false);
        }
      } else {
        setUnansweredCount(null);
      }
    };

    fetchUnansweredCount();
  }, [quizMode, selectedSubjectNames]);

  useEffect(() => {
    const fetchWeakAreaCount = async () => {
      if (quizMode === 'weak_area' && selectedSubjectNames.length > 0) {
        setIsWeakCountLoading(true);
        setWeakAreaCount(null);
        try {
          const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
          const response = await fetch(`${API_BASE_URL}/quiz/missed-problems-count?${subjectParams}`);
          if (!response.ok) {
            throw new Error('Failed to fetch weak area count.');
          }
          const data = await response.json();
          setWeakAreaCount(data.missed_problems_count);
        } catch (error) {
          console.error(error);
        } finally {
          setIsWeakCountLoading(false);
        }
      } else {
        setWeakAreaCount(null);
      }
    };

    fetchWeakAreaCount();
  }, [quizMode, selectedSubjectNames]);

  useEffect(() => {
    if (!isSpecificAreaInvestigationReady) {
      setSpecificAreaCount(null);
      setSpecificAreaCountError('');
      setSpecificAreaProgressStep(0);
      clearSpecificAreaProgressTimer();
      return;
    }

    if (isSpecificAreaInvestigationStale) {
      setSpecificAreaCount(null);
      setSpecificAreaCountError('');
      setSpecificAreaProgressStep(0);
    }
  }, [
    clearSpecificAreaProgressTimer,
    isSpecificAreaInvestigationReady,
    isSpecificAreaInvestigationStale,
  ]);

  useEffect(() => () => {
    clearSpecificAreaProgressTimer();
  }, [clearSpecificAreaProgressTimer]);

  const fetchHistoryStats = useCallback(async () => {
    if (questions.length === 0) {
      setHistoryStats({});
      return;
    }
    try {
      const problemIds = questions.map((q) => q.id);
      const response = await fetch(`${API_BASE_URL}/quiz/bulk-history-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_ids: problemIds,
          subjects: selectedSubjectNames,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setHistoryStats(data);
      }
    } catch (fetchError) {
      console.error("Failed to fetch history stats:", fetchError);
    }
  }, [questions, selectedSubjectNames]);

  useEffect(() => {
    fetchHistoryStats();
  }, [fetchHistoryStats]);

  const handleSubjectSelection = (subjectName: string) => {
    setSelectedSubjectNames((prev: string[]) =>
      prev.includes(subjectName)
        ? prev.filter((s: string) => s !== subjectName)
        : [...prev, subjectName]
    );
  };

  const updateSpecificAreaKeyword = (index: number, value: string) => {
    setSpecificAreaKeywords((prev) => prev.map((keyword, idx) => (idx === index ? value : keyword)));
  };

  const addSpecificAreaKeywordField = () => {
    setSpecificAreaKeywords((prev) => [...prev, '']);
  };

  const removeSpecificAreaKeywordField = (index: number) => {
    setSpecificAreaKeywords((prev) => {
      if (prev.length === 1) {
        return [''];
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const applySpecificAreaSuggestion = (suggestion: string) => {
    setSpecificAreaKeywords((prev) => {
      const normalizedSuggestion = suggestion.trim();
      if (!normalizedSuggestion) return prev;
      const alreadyExists = prev.some((keyword) => keyword.trim() === normalizedSuggestion);
      if (alreadyExists) {
        return prev;
      }
      const firstEmptyIndex = prev.findIndex((keyword) => keyword.trim().length === 0);
      if (firstEmptyIndex >= 0) {
        return prev.map((keyword, index) => (index === firstEmptyIndex ? normalizedSuggestion : keyword));
      }
      return [...prev, normalizedSuggestion];
    });
  };

  const fetchSpecificAreaSuggestions = async () => {
    if (normalizedSpecificAreaKeywords.length === 0) {
      setError('関連語を提案するには、先にキーワードを1つ以上入力してください。');
      return;
    }

    try {
      setIsSpecificAreaSuggestionsLoading(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/quiz/specific-area-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: normalizedSpecificAreaKeywords }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '関連語の提案に失敗しました。');
      }
      const data = await response.json();
      setSpecificAreaSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch (suggestionError) {
      console.error(suggestionError);
      const message = suggestionError instanceof Error ? suggestionError.message : '関連語の提案に失敗しました。';
      setError(message);
      setSpecificAreaSuggestions([]);
    } finally {
      setIsSpecificAreaSuggestionsLoading(false);
    }
  };

  const fetchSpecificAreaCount = async () => {
    if (selectedSubjectNames.length === 0) {
      setError('科目を1つ以上選択してください。');
      return;
    }
    if (normalizedSpecificAreaKeywords.length === 0) {
      setError('特定領域モードではキーワードを1つ以上入力してください。');
      return;
    }

    try {
      clearSpecificAreaProgressTimer();
      setIsSpecificAreaCountLoading(true);
      setSpecificAreaCount(null);
      setSpecificAreaCountError('');
      setSpecificAreaProgressStep(0);
      setError('');

      specificAreaProgressTimerRef.current = window.setInterval(() => {
        setSpecificAreaProgressStep((prev) => Math.min(prev + 1, SPECIFIC_AREA_PROGRESS_STEPS.length - 1));
      }, 700);

      const params = new URLSearchParams();
      selectedSubjectNames.forEach((name) => params.append('subjects', name));
      normalizedSpecificAreaKeywords.forEach((keyword) => params.append('keywords', keyword));
      params.append('history_scope', specificAreaHistoryScope);
      const response = await fetch(`${API_BASE_URL}/quiz/specific-area-count?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '対象問題の調査に失敗しました。');
      }
      const data = await response.json();
      clearSpecificAreaProgressTimer();
      setSpecificAreaProgressStep(SPECIFIC_AREA_PROGRESS_STEPS.length - 1);
      setSpecificAreaCount(data.specific_area_count);
      setLastSpecificAreaInvestigationSignature(specificAreaInvestigationSignature);
    } catch (countError) {
      console.error(countError);
      clearSpecificAreaProgressTimer();
      const message = countError instanceof Error ? countError.message : '対象問題の調査に失敗しました。';
      setSpecificAreaCountError(message);
      setSpecificAreaCount(null);
      setLastSpecificAreaInvestigationSignature(null);
      setError(message);
    } finally {
      setIsSpecificAreaCountLoading(false);
    }
  };

  const startQuiz = async (forcedSession = false) => {
    if (selectedSubjectNames.length === 0) {
      setError('科目を1つ以上選択してください。');
      return;
    }

    let questionsToFetch = numQuestions;
    if (quizMode === 'today_remaining') {
      if (todayRemaining.count === 0) {
        setError('今日の予定は完了しています！');
        return;
      }
      questionsToFetch = Math.min(numQuestions, todayRemaining.count);
    } else if (quizMode === 'unanswered') {
      if (unansweredCount === null || unansweredCount === 0) {
        setError('未解答の問題はありません。');
        return;
      }
      questionsToFetch = Math.min(numQuestions, unansweredCount);
    } else if (quizMode === 'specific_area') {
      if (normalizedSpecificAreaKeywords.length === 0) {
        setError('特定領域モードではキーワードを1つ以上入力してください。');
        return;
      }
      if (isSpecificAreaCountLoading) {
        setError('対象問題を調査中です。完了してから開始してください。');
        return;
      }
      if (!hasSpecificAreaInvestigationResult) {
        setError('対象問題を調査してから開始してください。条件を変えた場合は再調査が必要です。');
        return;
      }
      if (specificAreaCount === null || specificAreaCount === 0) {
        setError('該当する問題はありません。');
        return;
      }
      questionsToFetch = Math.min(numQuestions, specificAreaCount);
    }
    
    if (questionsToFetch <= 0) {
      setError('出題する問題数が0以下です。');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const apiMode = quizMode === 'today_remaining' ? 'unanswered' : quizMode;
      
      const response = await fetch(`${API_BASE_URL}/quiz/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subjects: selectedSubjectNames,
          mode: apiMode,
          count: questionsToFetch,
          weights: quizMode === 'random' ? subjectWeights : undefined,
          keywords: quizMode === 'specific_area' ? normalizedSpecificAreaKeywords : undefined,
          specific_area_history_scope: quizMode === 'specific_area' ? specificAreaHistoryScope : undefined,
        }),
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'クイズの開始に失敗しました。');
      }

      if (data.quiz_set.length === 0) {
        if (quizMode === 'unanswered') {
          setError('未解答の問題はありません。設定画面に戻ります。');
          setTimeout(() => {
            setQuizState('setup');
            setError('');
          }, 2000);
        } else {
          setError('出題できる問題がありません。');
        }
        setIsLoading(false);
        return;
      }

      setQuestions(data.quiz_set);
      shuffledChoicesByQuestionRef.current = {};
      prefetchedImageUrlsRef.current = new Set();
      setAdhocQuizLabel('');
      setCurrentQuestionIndex(0);
      setScore(0);
      setIsForcedSession(forcedSession);
      setQuizState('active');
      resetQuestionState();

    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const openIpadMode = (profile: IpadProfile) => {
    if (selectedSubjectNames.length === 0) {
      setError('科目を1つ以上選択してください。');
      return;
    }

    let questionsToFetch = numQuestions;
    if (quizMode === 'today_remaining') {
      if (todayRemaining.count === 0) {
        setError('今日の予定は完了しています！');
        return;
      }
      questionsToFetch = Math.min(numQuestions, todayRemaining.count);
    } else if (quizMode === 'unanswered') {
      if (unansweredCount === null || unansweredCount === 0) {
        setError('未解答の問題はありません。');
        return;
      }
      questionsToFetch = Math.min(numQuestions, unansweredCount);
    } else if (quizMode === 'weak_area') {
      if (weakAreaCount === null || weakAreaCount === 0) {
        setError('苦手問題はありません。');
        return;
      }
      questionsToFetch = Math.min(numQuestions, weakAreaCount);
    } else if (quizMode === 'specific_area') {
      setError('特定領域モードはiPadモード未対応です。Web画面から開始してください。');
      return;
    }

    const subjectQuery = selectedSubjectNames
      .map((s) => `subject=${encodeURIComponent(s)}`)
      .join('&');
    const deepLink =
      `quizapp://quiz?base=${encodeURIComponent(window.location.origin)}` +
      `&${subjectQuery}` +
      `&mode=${encodeURIComponent(quizMode)}` +
      `&count=${encodeURIComponent(String(Math.max(1, questionsToFetch)))}` +
      `&profile=${encodeURIComponent(profile)}`;
    window.location.href = deepLink;
  };

  const resetQuestionState = () => {
    setSelectedAnswer(null);
    setIsAnswered(false);
    setFeedback(null);
    setScratchpadText('');
    setCustomExplanationText('');
    setIsScratchpadOpen(false);
    setIsOralVivaActive(false);
    setOralVivaStepIndex(0);
    setOralVivaMessages([]);
    setOralVivaInput('');
    setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
    setOralVivaResult(null);
    setIsOralVivaLoading(false);
    setIsQuestionHelpActive(false);
    setQuestionHelpMessages([]);
    setQuestionHelpInput('');
    setQuestionHelpSuggestedFollowups([]);
    setIsQuestionHelpLoading(false);
    setIsListeningSpeech(false);
    setQuestionStartedAt(Date.now());
  };

  const estimatedCompletionText = useMemo(() => {
    const remainingQuestions = Math.max(0, todayRemaining.count);
    const totalMinutes = remainingQuestions * 2;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}時間${minutes}分`;
    }
    return `${minutes}分`;
  }, [todayRemaining.count]);

  const todayRemainingPaceHint = useMemo(() => {
    const { hour } = getNowJstParts();
    if (hour < 7 || hour >= 21) return null;

    const remainingQuestions = Math.max(0, todayRemaining.count);
    if (remainingQuestions === 0) return '今日の予定は完了しています。';

    const remainingHoursRaw = getMinutesUntilJstHour(21) / 60;
    const remainingHoursFloor = Math.max(1, Math.floor(remainingHoursRaw));
    const targetPerHour = Math.max(1, Math.ceil(remainingQuestions / remainingHoursFloor));
    const nextHour = Math.min(hour + 1, 21);

    return `${nextHour}時までにあと${targetPerHour}問で順調ペース`;
  }, [todayRemaining.count]);

  const handleAnswerSubmit = async (forcedSubmission = false, forceIncorrect = false) => {
    if (isSubmittingAnswer) return;
    if (selectedAnswer === null && !forcedSubmission) return;

    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    const submittedAnswer = selectedAnswer ?? '';
    const isCorrect = forceIncorrect ? false : submittedAnswer === currentQuestion.answer;

    try {
      setIsSubmittingAnswer(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_id: currentQuestion.id,
          subject: currentQuestion.subject,
          selected_answer: submittedAnswer,
          is_correct: isCorrect,
          category: currentQuestion.category,
          mode: quizMode,
        }),
      });
      if (!response.ok) {
        let detail = '実績の保存に失敗しました。';
        try {
          const payload = await response.json();
          detail = payload.detail || detail;
        } catch {
          // no-op
        }
        throw new Error(detail);
      }

      setEffectStatus(isCorrect ? 'correct' : 'incorrect');
      setTimeout(() => setEffectStatus(null), 1000);

      if (isCorrect) {
        setScore(prev => prev + 1);
      }

      const explanation = currentQuestion.explanation || { text: "この問題の解説はありません。" };
      setFeedback({ correct: isCorrect, explanation });
      setIsAnswered(true);
    } catch (e) {
      console.error("Failed to submit history:", e);
      const message = e instanceof Error ? e.message : '実績の保存に失敗しました。再試行してください。';
      setError(message);
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const handleNextQuestion = async () => {
    // メモが変更されていたら保存する
    const originalText = currentQuestion?.custom_explanation || '';
    if (customExplanationText.trim() !== originalText.trim()) {
      try {
        await handleSaveCustomExplanation();
      } catch (e) {
        const message = e instanceof Error ? e.message : 'My Memo の保存に失敗しました。';
        setError(message);
        return;
      }
    }

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      resetQuestionState();
    } else {
      setIsForcedSession(false);
      resetQuestionState();
      setQuizState('setup');
    }
  };

  const handleTryAgain = () => {
    if (quizMode === 'unanswered') {
      setQuizState('setup');
    } else {
      startQuiz(isForcedSession);
    }
  };

  const handleSaveCustomExplanation = async (overrideText?: string) => {
    if (!currentQuestion) return;
    const textToSave = overrideText ?? customExplanationText;
    try {
      setIsSavingCustomExplanation(true);
      const response = await fetch(`${API_BASE_URL}/problems/${currentQuestion.id}/custom-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSave,
          explanation_image_data_urls: currentExplanationImageDataUrls,
          question_image_data_urls: currentQuestionImageDataUrls,
        }),
      });

      if (!response.ok) {
        let detail = 'My Memo の保存に失敗しました。';
        try {
          const payload = await response.json();
          detail = payload.detail || detail;
        } catch {
          // no-op
        }
        throw new Error(detail);
      }

      // Update the question in the main questions array to persist state during the session
      const updatedQuestions = questions.map((q) =>
        q.id === currentQuestion.id
          ? {
              ...q,
              custom_explanation: textToSave,
              custom_explanation_image_data_urls: currentExplanationImageDataUrls,
              custom_question_image_data_urls: currentQuestionImageDataUrls,
              custom_explanation_image_data_url: currentExplanationImageDataUrls[0],
              custom_question_image_data_url: currentQuestionImageDataUrls[0],
            }
          : q
      );
      setQuestions(updatedQuestions);
    } catch (error) {
      console.error("Failed to save custom explanation:", error);
      throw error;
    } finally {
      setIsSavingCustomExplanation(false);
    }
  };

  const callOralVivaStep = useCallback(async (step: OralVivaStep, userMessage: string): Promise<OralVivaResponse> => {
    if (!currentQuestion) {
      throw new Error('問題情報が見つかりません。');
    }
    const response = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step,
        question: {
          problem_id: currentQuestion.id,
          question_text: currentQuestion.question_text,
          explanation_text: feedback?.explanation?.text ?? currentQuestion.explanation?.text ?? '',
          correct_answer: currentQuestion.answer,
          selected_answer: selectedAnswer,
          was_correct: feedback?.correct ?? false,
        },
        conversation: oralVivaMessages,
        user_message: userMessage,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail || '口頭試問の生成に失敗しました。');
    }
    return response.json();
  }, [currentQuestion, feedback, selectedAnswer, oralVivaMessages]);

  const startOralViva = useCallback(async () => {
    if (!currentQuestion || !isAnswered || isOralVivaLoading) return;
    setIsOralVivaLoading(true);
    setError('');
    setIsOralVivaActive(true);
    setOralVivaStepIndex(0);
    setOralVivaMessages([]);
    setOralVivaResult(null);
    setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
    try {
      const step = oralVivaSteps[0] as OralVivaStep;
      const result = await callOralVivaStep(step, '');
      setOralVivaMessages([{ role: 'assistant', content: result.assistant_message }]);
      setOralVivaScores(result.scores);
    } catch (e) {
      const message = e instanceof Error ? e.message : '口頭試問の開始に失敗しました。';
      setError(message);
      setIsOralVivaActive(false);
    } finally {
      setIsOralVivaLoading(false);
    }
  }, [currentQuestion, isAnswered, isOralVivaLoading, callOralVivaStep, oralVivaSteps]);

  const submitOralVivaAnswer = useCallback(async () => {
    if (!isOralVivaActive || isOralVivaLoading) return;
    const message = oralVivaInput.trim();
    if (!message) return;
    const step = oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)] as OralVivaStep;
    setIsOralVivaLoading(true);
    setError('');
    const userTurn: OralVivaMessage = { role: 'user', content: message };
    setOralVivaMessages((prev) => [...prev, userTurn]);
    setOralVivaInput('');

    try {
      const result = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          question: {
            problem_id: currentQuestion?.id,
            question_text: currentQuestion?.question_text,
            explanation_text: feedback?.explanation?.text ?? currentQuestion?.explanation?.text ?? '',
            correct_answer: currentQuestion?.answer,
            selected_answer: selectedAnswer,
            was_correct: feedback?.correct ?? false,
          },
          conversation: [...oralVivaMessages, userTurn],
          user_message: message,
        }),
      });
      if (!result.ok) {
        const payload = await result.json().catch(() => null);
        throw new Error(payload?.detail || '口頭試問の送信に失敗しました。');
      }
      const payload: OralVivaResponse = await result.json();
      setOralVivaMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
      setOralVivaScores(payload.scores);
      if (payload.is_final_step) {
        setOralVivaResult({
          improvementPoints: payload.improvement_points ?? [],
          miniQuizQuestion: payload.mini_quiz_question ?? '',
          miniQuizAnswer: payload.mini_quiz_answer ?? '',
        });
        if (payload.memo_summary && payload.memo_summary.trim()) {
          const appended = customExplanationText.trim()
            ? `${customExplanationText.trim()}\n\n---\n\n【口頭試問まとめ】\n${payload.memo_summary.trim()}`
            : `【口頭試問まとめ】\n${payload.memo_summary.trim()}`;
          setCustomExplanationText(appended);
          await handleSaveCustomExplanation(appended);
        }
      } else {
        setOralVivaStepIndex((prev) => Math.min(prev + 1, oralVivaSteps.length - 1));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '口頭試問の送信に失敗しました。';
      setError(errMsg);
    } finally {
      setIsOralVivaLoading(false);
    }
  }, [
    isOralVivaActive,
    isOralVivaLoading,
    oralVivaInput,
    oralVivaSteps,
    oralVivaStepIndex,
    currentQuestion,
    feedback,
    selectedAnswer,
    oralVivaMessages,
    customExplanationText,
    handleSaveCustomExplanation,
  ]);

  const toggleSpeechInput = useCallback(() => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    if (isListeningSpeech) {
      recognition.stop();
      setIsListeningSpeech(false);
    } else {
      recognition.start();
      setIsListeningSpeech(true);
    }
  }, [isListeningSpeech]);

  const skipOralVivaToSummary = useCallback(async () => {
    if (!isOralVivaActive || isOralVivaLoading) return;
    setOralVivaStepIndex(oralVivaSteps.length - 1);
    setIsOralVivaLoading(true);
    try {
      const userTurn: OralVivaMessage = { role: 'user', content: 'ここまでの内容を要約して終了してください。' };
      const result = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'summary',
          question: {
            problem_id: currentQuestion?.id,
            question_text: currentQuestion?.question_text,
            explanation_text: feedback?.explanation?.text ?? currentQuestion?.explanation?.text ?? '',
            correct_answer: currentQuestion?.answer,
            selected_answer: selectedAnswer,
            was_correct: feedback?.correct ?? false,
          },
          conversation: [...oralVivaMessages, userTurn],
          user_message: userTurn.content,
        }),
      });
      if (!result.ok) {
        const payload = await result.json().catch(() => null);
        throw new Error(payload?.detail || '要約生成に失敗しました。');
      }
      const payload: OralVivaResponse = await result.json();
      setOralVivaMessages((prev) => [...prev, userTurn, { role: 'assistant', content: payload.assistant_message }]);
      setOralVivaScores(payload.scores);
      setOralVivaResult({
        improvementPoints: payload.improvement_points ?? [],
        miniQuizQuestion: payload.mini_quiz_question ?? '',
        miniQuizAnswer: payload.mini_quiz_answer ?? '',
      });
      if (payload.memo_summary && payload.memo_summary.trim()) {
        const appended = customExplanationText.trim()
          ? `${customExplanationText.trim()}\n\n---\n\n【口頭試問まとめ】\n${payload.memo_summary.trim()}`
          : `【口頭試問まとめ】\n${payload.memo_summary.trim()}`;
        setCustomExplanationText(appended);
        await handleSaveCustomExplanation(appended);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '要約生成に失敗しました。';
      setError(message);
    } finally {
      setIsOralVivaLoading(false);
    }
  }, [
    isOralVivaActive,
    isOralVivaLoading,
    oralVivaSteps.length,
    currentQuestion,
    feedback,
    selectedAnswer,
    oralVivaMessages,
    customExplanationText,
    handleSaveCustomExplanation,
  ]);

  const submitQuestionHelp = useCallback(async (prefilledQuestion?: string) => {
    if (!currentQuestion || !isAnswered || isQuestionHelpLoading) return;
    const message = (prefilledQuestion ?? questionHelpInput).trim();
    if (!message) return;

    const userTurn: OralVivaMessage = { role: 'user', content: message };
    const nextConversation = [...questionHelpMessages, userTurn];
    setIsQuestionHelpActive(true);
    setQuestionHelpMessages(nextConversation);
    setQuestionHelpInput('');
    setIsQuestionHelpLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/quiz/question-help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: {
            problem_id: currentQuestion.id,
            question_text: currentQuestion.question_text,
            explanation_text: feedback?.explanation?.text ?? currentQuestion.explanation?.text ?? '',
            correct_answer: currentQuestion.answer,
            selected_answer: selectedAnswer,
            was_correct: feedback?.correct ?? false,
          },
          conversation: questionHelpMessages,
          user_message: message,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '質問相談の送信に失敗しました。');
      }
      const payload: QuestionHelpResponse = await response.json();
      setQuestionHelpMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
      setQuestionHelpSuggestedFollowups(payload.suggested_followups ?? []);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '質問相談の送信に失敗しました。';
      setError(errMsg);
      setQuestionHelpMessages((prev) => prev.slice(0, -1));
      setQuestionHelpInput(message);
    } finally {
      setIsQuestionHelpLoading(false);
    }
  }, [
    currentQuestion,
    isAnswered,
    isQuestionHelpLoading,
    questionHelpInput,
    questionHelpMessages,
    feedback,
    selectedAnswer,
  ]);

    const currentReviewKey = currentQuestion ? buildReviewKey(currentQuestion.subject, currentQuestion.id) : null;
    const isCurrentQuestionReviewLater = currentReviewKey ? reviewLaterKeys.includes(currentReviewKey) : false;
    const displayedChoices = useMemo(
      () => (currentQuestion ? ensureShuffledChoicesForQuestion(currentQuestion) : []),
      [currentQuestion, ensureShuffledChoicesForQuestion]
    );

    useEffect(() => {
      fetchReviewLaterItems();
    }, [fetchReviewLaterItems]);

  

    useEffect(() => {

      if (currentQuestion) {

        setCustomExplanationText(currentQuestion.custom_explanation || '');

      }

    }, [currentQuestion]);

    useEffect(() => {
      const SpeechRecognitionCtor =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        setIsSpeechSupported(false);
        speechRecognitionRef.current = null;
        return;
      }
      setIsSpeechSupported(true);
      const recognition: SpeechRecognitionLike = new SpeechRecognitionCtor();
      recognition.lang = 'ja-JP';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript ?? '';
        if (typeof transcript === 'string' && transcript.trim()) {
          setOralVivaInput((prev) => (prev ? `${prev}\n${transcript.trim()}` : transcript.trim()));
        }
      };
      recognition.onerror = () => {
        setIsListeningSpeech(false);
      };
      recognition.onend = () => {
        setIsListeningSpeech(false);
      };
      speechRecognitionRef.current = recognition;
      return () => {
        recognition.stop();
        speechRecognitionRef.current = null;
      };
    }, []);

    useEffect(() => {
      oralVivaMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [oralVivaMessages]);

    useEffect(() => {
      questionHelpMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [questionHelpMessages]);

    useEffect(() => {
      if (isOralVivaActive) return;
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsListeningSpeech(false);
    }, [isOralVivaActive]);

  

    useEffect(() => {

      const handleKeyPress = (event: KeyboardEvent) => {

        if (
          quizState !== 'active' ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          (event.target instanceof HTMLElement && event.target.isContentEditable)
        ) {

          return;

        }

  

        if (event.key >= '1' && event.key <= '9') {

          if (!isAnswered) {

            const choiceIndex = parseInt(event.key) - 1;

            if (displayedChoices[choiceIndex]) {

              setSelectedAnswer(displayedChoices[choiceIndex].label);

            }

          }

        }

  

        if (event.key === 'Enter') {

          const submitButton = document.getElementById('submit-answer-button');

  

          if (!isAnswered && !isSubmittingAnswer && submitButton) {

            submitButton.click();

          } else if (isAnswered && !isSavingCustomExplanation) {

            handleNextQuestion();

          }

        }

      };

  

      window.addEventListener('keydown', handleKeyPress);

  

      return () => {

        window.removeEventListener('keydown', handleKeyPress);

      };

    }, [quizState, isAnswered, currentQuestion, displayedChoices, handleAnswerSubmit, handleNextQuestion, isSubmittingAnswer, isSavingCustomExplanation]);

    useEffect(() => {
      if (quizState !== 'active') return;
      const target = questionTopRef.current;
      if (!target) return;
      window.requestAnimationFrame(() => {
        const top = target.getBoundingClientRect().top + window.scrollY - 12;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    }, [quizState, currentQuestionIndex, isAnswered]);

    useEffect(() => {
      if (quizState !== 'active' || questions.length === 0) return;
      const prefetchCount = 3;
      const start = currentQuestionIndex + 1;
      const end = Math.min(questions.length, start + prefetchCount);
      for (let i = start; i < end; i += 1) {
        const q = questions[i];
        if (!q) continue;
        const urls = [...(q.image_urls ?? []), ...(q.explanation_image_urls ?? [])];
        for (const url of urls) {
          if (!url || prefetchedImageUrlsRef.current.has(url)) continue;
          prefetchedImageUrlsRef.current.add(url);
          const img = new Image();
          img.src = url;
        }
      }
    }, [quizState, questions, currentQuestionIndex]);

  

    // --- Render logic for active quiz ---

    const renderActiveQuiz = () => {
      if (!currentQuestion) return null;
  
      const hasQuestionImages = (currentQuestion.image_urls && currentQuestion.image_urls.length > 0)
        || currentQuestionImageDataUrls.length > 0;
  
      // レイアウトの決定ロジック
      let layoutType: 'image' | 'answered' | 'default' = 'default';
      if (hasQuestionImages) {
        layoutType = 'image';
      } else if (isAnswered) {
        layoutType = 'answered';
      }
  
      const imagesComponent = hasQuestionImages ? (
        <div className="space-y-4">
          {(currentQuestion.image_urls || []).map((url: string, index: number) => (
            <img key={index} src={url} alt={`Question image ${index + 1}`} className="max-w-full w-full h-auto mx-auto rounded-lg shadow-md" />
          ))}
          {currentQuestionImageDataUrls.map((url, index) => (
            <button
              key={`custom-question-${index}`}
              type="button"
              onClick={() => setPreviewImageUrl(url)}
              className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
            >
              <img
                src={url}
                alt={`My Memo question supplement ${index + 1}`}
                className="max-h-64 w-full object-contain"
              />
            </button>
          ))}
        </div>
      ) : null;
  
      const explanationComponent = isAnswered ? (
        <div className="bg-white rounded-xl shadow p-6 md:p-8 fade-in">
          <div className="flex items-center gap-3 mb-4">
            {feedback?.correct ? <CheckCircleIcon className="w-8 h-8 text-green-600" /> : <XCircleIcon className="w-8 h-8 text-red-600" />}
            <h3 className="text-xl md:text-2xl font-bold">{feedback?.correct ? '正解！' : '不正解'}</h3>
          </div>
          <h4 className="text-base md:text-lg font-semibold text-primary-new mb-2">解説</h4>
          {(currentQuestion.explanation_image_urls && currentQuestion.explanation_image_urls.length > 0) && (
            <div className="my-4 grid grid-cols-1 gap-4">
              {currentQuestion.explanation_image_urls.map((url: string, index: number) => (
                <img key={index} src={url} alt={`Explanation image ${index + 1}`} className="max-w-full h-auto mx-auto rounded-lg shadow-md" />
              ))}
            </div>
          )}
          <div className="prose prose-sm md:prose-base max-w-none text-gray-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback?.explanation?.text || ''}</ReactMarkdown>
          </div>
          {currentExplanationImageDataUrls.length > 0 && (
            <div className="mt-6">
              <h4 className="text-base md:text-lg font-semibold text-primary-new mb-2">My Memo 解説補足画像</h4>
              <div className="space-y-3">
                {currentExplanationImageDataUrls.map((url, index) => (
                  <button
                    key={`custom-explanation-${index}`}
                    type="button"
                    onClick={() => setPreviewImageUrl(url)}
                    className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                  >
                    <img
                      src={url}
                      alt={`My Memo handwrite ${index + 1}`}
                      className="max-h-48 w-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-base md:text-lg font-semibold text-primary-new">My Memo</h4>
              <button onClick={() => openMemoModal('customExplanation')} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="拡大表示">
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4"/></svg>
              </button>
            </div>
            <textarea
              value={customExplanationText}
              onChange={(e) => setCustomExplanationText(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new"
              rows={4}
            />
          </div>
          <div className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-base md:text-lg font-semibold text-sky-900">口頭試問モード</h4>
              {!isOralVivaActive ? (
                <button
                  type="button"
                  onClick={() => void startOralViva()}
                  disabled={isOralVivaLoading}
                  className="px-4 py-2 rounded-md bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:bg-gray-300"
                >
                  {isOralVivaLoading ? '開始中...' : '口頭試問を開始'}
                </button>
              ) : (
                <div className="text-right">
                  <div className="text-xs font-semibold text-sky-800">
                    ステップ: {oralVivaStepLabels[oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)] as OralVivaStep]} ({Math.min(oralVivaStepIndex + 1, oralVivaSteps.length)}/{oralVivaSteps.length})
                  </div>
                  <div className="text-[11px] text-sky-700">終了条件: 4ステップ完了 or 要約へスキップ</div>
                </div>
              )}
            </div>

            {isOralVivaActive && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    ['論理性', oralVivaScores.logicality],
                    ['具体性', oralVivaScores.specificity],
                    ['再現性', oralVivaScores.reproducibility],
                  ] as Array<[string, number]>).map(([label, value]) => (
                    <div key={label} className="rounded-md bg-white border border-sky-200 px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-sky-900 mb-1">
                        <span>{label}</span>
                        <span>{value}</span>
                      </div>
                      <div className="h-2 rounded bg-sky-100 overflow-hidden">
                        <div className="h-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="max-h-72 overflow-y-auto rounded-md border border-sky-200 bg-white p-3 space-y-2">
                  {oralVivaMessages.length === 0 && (
                    <p className="text-sm text-gray-500">開始すると、AI面接官が質問します。</p>
                  )}
                  {oralVivaMessages.map((msg, idx) => (
                    <div key={`${msg.role}-${idx}`} className={`rounded-lg px-3 py-2 text-sm ${msg.role === 'assistant' ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-800'}`}>
                      <p className="text-[11px] font-semibold mb-1">{msg.role === 'assistant' ? 'AI面接官' : 'あなた'}</p>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ))}
                  <div ref={oralVivaMessagesEndRef} />
                </div>

                {!oralVivaResult && (
                  <div className="space-y-2">
                    <textarea
                      value={oralVivaInput}
                      onChange={(e) => setOralVivaInput(e.target.value)}
                      className="w-full p-2 border border-sky-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 bg-white"
                      rows={3}
                      placeholder="回答を入力してください（任意で音声入力も可）"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void submitOralVivaAnswer()}
                        disabled={isOralVivaLoading || !oralVivaInput.trim()}
                        className="px-4 py-2 rounded-md bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:bg-gray-300"
                      >
                        {isOralVivaLoading ? '送信中...' : '送信'}
                      </button>
                      {isSpeechSupported && (
                        <button
                          type="button"
                          onClick={toggleSpeechInput}
                          className={`px-4 py-2 rounded-md text-sm font-medium border ${isListeningSpeech ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-sky-300 bg-white text-sky-800'}`}
                        >
                          {isListeningSpeech ? '音声入力停止' : '音声入力開始'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void skipOralVivaToSummary()}
                        disabled={isOralVivaLoading}
                        className="px-4 py-2 rounded-md text-sm font-medium border border-sky-300 bg-white text-sky-800 hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        要約へスキップ
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsOralVivaActive(false)}
                        disabled={isOralVivaLoading}
                        className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        口頭試問を閉じる
                      </button>
                    </div>
                  </div>
                )}

                {oralVivaResult && (
                  <div className="rounded-md border border-sky-200 bg-white p-3 space-y-2">
                    <h5 className="text-sm font-semibold text-sky-900">最終フィードバック</h5>
                    <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                      {oralVivaResult.improvementPoints.map((point, idx) => (
                        <li key={`${point}-${idx}`}>{point}</li>
                      ))}
                    </ul>
                    {oralVivaResult.miniQuizQuestion && (
                      <div className="text-sm text-gray-800">
                        <p className="font-semibold">次回確認ミニ問題</p>
                        <p className="whitespace-pre-wrap">{oralVivaResult.miniQuizQuestion}</p>
                      </div>
                    )}
                    {oralVivaResult.miniQuizAnswer && (
                      <div className="text-sm text-gray-700">
                        <p className="font-semibold">想定解答</p>
                        <p className="whitespace-pre-wrap">{oralVivaResult.miniQuizAnswer}</p>
                      </div>
                    )}
                    <p className="text-xs text-gray-500">最終要約は My Memo に自動追記・保存されます。</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-base md:text-lg font-semibold text-emerald-900">質問相談モード</h4>
                <p className="mt-1 text-xs text-emerald-800">この問題で引っかかった点を自由に聞けます。理解できたところでそのまま閉じてOKです。</p>
              </div>
              {!isQuestionHelpActive ? (
                <button
                  type="button"
                  onClick={() => setIsQuestionHelpActive(true)}
                  className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800"
                >
                  質問相談を開く
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsQuestionHelpActive(false)}
                  disabled={isQuestionHelpLoading}
                  className="px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  質問相談を閉じる
                </button>
              )}
            </div>

            {isQuestionHelpActive && (
              <div className="mt-4 space-y-3">
                <div className="max-h-72 overflow-y-auto rounded-md border border-emerald-200 bg-white p-3 space-y-2">
                  {questionHelpMessages.length === 0 && (
                    <p className="text-sm text-gray-500">例: 「なぜこれが正解？」「他の選択肢はどこが違う？」</p>
                  )}
                  {questionHelpMessages.map((msg, idx) => (
                    <div key={`${msg.role}-${idx}`} className={`rounded-lg px-3 py-2 text-sm ${msg.role === 'assistant' ? 'bg-emerald-100 text-emerald-950' : 'bg-gray-100 text-gray-800'}`}>
                      <p className="text-[11px] font-semibold mb-1">{msg.role === 'assistant' ? 'AI講師' : 'あなた'}</p>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ))}
                  <div ref={questionHelpMessagesEndRef} />
                </div>

                {questionHelpSuggestedFollowups.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {questionHelpSuggestedFollowups.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => void submitQuestionHelp(item)}
                        disabled={isQuestionHelpLoading}
                        className="px-3 py-1.5 rounded-full border border-emerald-200 bg-white text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <textarea
                    value={questionHelpInput}
                    onChange={(e) => setQuestionHelpInput(e.target.value)}
                    className="w-full p-2 border border-emerald-300 rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                    rows={3}
                    placeholder="この問題で気になる点を入力してください"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void submitQuestionHelp()}
                      disabled={isQuestionHelpLoading || !questionHelpInput.trim()}
                      className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:bg-gray-300"
                    >
                      {isQuestionHelpLoading ? '回答中...' : '質問する'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsQuestionHelpActive(false)}
                      disabled={isQuestionHelpLoading}
                      className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between items-center">
            <button
              onClick={openProblemEditor}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              この問題を編集する
            </button>
            <button id="next-question-button-bottom" type="button" onClick={handleNextQuestion} disabled={isSavingCustomExplanation} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed">
              {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了'}
            </button>
          </div>
        </div>
      ) : null;
  
      const questionColumn = (
        <div className="bg-white rounded-xl shadow p-6 md:p-8 h-full flex flex-col">
          <p className="text-base md:text-lg font-semibold text-gray-700 mb-6">{currentQuestion.question_text}</p>
          <TimerProgressBar
            durationMs={isForcedSession ? FORCED_ANSWER_TIMER_MS : QUESTION_TIMER_MS}
            isActive={quizState === 'active' && !isAnswered && !isSubmittingAnswer}
            resetToken={`${currentQuestion.id}-${questionStartedAt}-${isForcedSession ? 'forced' : 'normal'}`}
            onExpire={isForcedSession ? () => void handleAnswerSubmit(true) : undefined}
          />
          
          {/* 画像がある場合、スマホでは問題文の下に表示 */}
          <div className="md:hidden my-4">
            {layoutType === 'image' && imagesComponent}
          </div>

          <div className="space-y-3">
            {displayedChoices.map((option: Choice, index: number) => {
              const isCorrectAnswer = option.label === currentQuestion.answer;
              const isSelectedAnswer = option.label === selectedAnswer;
              let buttonClass = 'bg-gray-100 hover:bg-gray-200';
              if (isAnswered) {
                if (isCorrectAnswer) buttonClass = 'bg-success/50 border-success';
                else if (isSelectedAnswer) buttonClass = 'bg-danger/50 border-danger';
                else buttonClass = 'bg-gray-100 opacity-60';
              } else if (isSelectedAnswer) {
                buttonClass = 'bg-primary-new';
              }
              return (
                <button
                  type="button"
                  key={index}
                  onClick={() => !isAnswered && setSelectedAnswer(option.label)}
                  disabled={isAnswered}
                  className={`w-full text-left p-4 rounded-lg border border-transparent transition-all duration-200 text-sm md:text-base ${buttonClass}`}
                >
                  <span className="font-bold mr-2">{option.label}.</span>
                  <span>{option.text}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <button
                type="button"
                onClick={() => setIsScratchpadOpen((prev) => !prev)}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-gray-50 hover:bg-gray-100"
              >
                {isScratchpadOpen ? 'メモ帳を閉じる' : 'メモ帳を開く'}
              </button>
              {isScratchpadOpen && (
                <button onClick={() => openMemoModal('scratchpad')} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="拡大表示">
                  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4"/></svg>
                </button>
              )}
            </div>
            {isScratchpadOpen && (
              <textarea
                id="scratchpad"
                value={scratchpadText}
                onChange={(e) => setScratchpadText(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new"
                rows={3}
              />
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void toggleReviewLater()}
                disabled={isUpdatingReviewLater}
                className={`px-4 py-2 rounded-md text-sm font-medium border shadow-sm transition-colors ${
                  isCurrentQuestionReviewLater
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                } disabled:bg-gray-200 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed`}
              >
                {isUpdatingReviewLater ? '更新中...' : isCurrentQuestionReviewLater ? '登録済み' : '後で確認'}
              </button>
            </div>
            {!isAnswered && ( // Moved "解答する" button here
              <div className="mt-6 text-center">
                <div className="flex flex-col justify-center gap-3 sm:flex-row">
                  <button id="submit-answer-button" type="button" onClick={() => void handleAnswerSubmit()} disabled={selectedAnswer === null || isSubmittingAnswer} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                    {isSubmittingAnswer ? '保存中...' : '解答する'}
                  </button>
                  <button type="button" onClick={() => void handleAnswerSubmit(true, true)} disabled={isSubmittingAnswer} className="px-8 py-3 border border-amber-300 rounded-md shadow-sm text-sm md:text-base font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed">
                    {isSubmittingAnswer ? '保存中...' : 'わからない'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {isAnswered && ( // This div now only contains "次の問題へ" button, and retains mt-auto
            <div className="mt-auto pt-6 text-center">
              <button id="next-question-button" type="button" onClick={handleNextQuestion} disabled={isSavingCustomExplanation} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed">
                {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了'}
              </button>
            </div>
          )}
        </div>
      );
  
      // 右カラム（画像・解説）
      const rightColumn = (
        <div className="space-y-8">
          {layoutType === 'image' && (
             <div className="bg-white rounded-xl shadow p-6 md:p-8">
                {imagesComponent}
             </div>
          )}
          {explanationComponent}
        </div>
      );
      
      const timelineItems = buildQuizTimelineItems(questions.length, currentQuestionIndex);

      return (
        <div className="md:h-screen md:overflow-hidden text-sm md:text-base">
            <div ref={questionTopRef} className="p-4 md:p-6">
                <div className="flex flex-col gap-4 mb-4">
                    <div className="flex flex-wrap justify-end items-center gap-4">
                        {isForcedSession && (
                            <div className="text-sm font-semibold text-[#e8383d] whitespace-nowrap">
                                強制モード: 80秒
                            </div>
                        )}
                        {(() => {
                        const stats = historyStats[currentQuestion.id];
                        if (stats && stats.total > 0) {
                            return (
                            <div className="text-sm text-gray-500 whitespace-nowrap">
                                直近{stats.total}回 正答率: {Math.round((stats.correct / stats.total) * 100)}% ({stats.correct}/{stats.total})
                            </div>
                            );
                        }
                        if (Object.keys(historyStats).length > 0) {
                            return <div className="text-sm text-gray-500 whitespace-nowrap">初挑戦</div>;
                        }
                        return null;
                        })()}
                        {adhocQuizLabel && (
                          <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap">
                            {adhocQuizLabel}
                          </span>
                        )}
                        <p className="text-sm font-semibold text-slate-600">問題 {currentQuestionIndex + 1} / {questions.length}</p>
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <ol className="quiz-progress-timeline" aria-label={`問題進捗 ${currentQuestionIndex + 1} / ${questions.length}`}>
                        {timelineItems.map((item) => (
                          <li
                            key={item.key}
                            className={item.state === 'gap' ? 'gap' : item.state}
                            aria-current={item.state === 'current' ? 'step' : undefined}
                          >
                            {item.label}
                          </li>
                        ))}
                      </ol>
                    </div>
                </div>
            </div>
            
            <div className={`
                md:grid md:gap-8 md:h-[calc(100vh-120px)] // Adjusted height for progress bar
                ${layoutType === 'image' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'answered' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'default' ? 'md:grid-cols-1' : ''}
            `}>
              {/* --- Left Column --- */}
              <div className={`
                px-4 md:px-0 md:pl-6
                ${layoutType === 'image' ? 'md:col-span-1' : ''}
                ${layoutType === 'answered' ? 'md:col-span-1' : ''}
                ${layoutType !== 'default' ? 'md:h-full md:overflow-y-auto' : ''}
              `}>
                {questionColumn}
              </div>

              {/* --- Right Column (PC only) --- */}
              {layoutType !== 'default' && (
                <div className={`
                  hidden md:block md:pr-6
                  ${layoutType === 'image' ? 'md:col-span-2' : ''}
                  ${layoutType === 'answered' ? 'md:col-span-2' : ''}
                  md:h-full md:overflow-y-auto
                `}>
                  {rightColumn}
                </div>
              )}
              
              {/* --- Mobile-only Explanation --- */}
              <div className="md:hidden mt-8 px-4">
                {explanationComponent}
              </div>
            </div>
        </div>
      );
    }

  

    return (

      <>

        <SubjectVisibilityModal

          isOpen={isVisibilityModalOpen}

          onClose={() => setIsVisibilityModalOpen(false)}

          subjects={allSubjects}

          hiddenSubjects={hiddenSubjects}

          onHiddenSubjectsChange={handleHiddenSubjectsChange}

          quizMode={quizMode}

          subjectWeights={subjectWeights}

          onSubjectWeightsChange={setSubjectWeights}

        />

        {effectStatus && (

          <div className="feedback-overlay">

            <div className={`feedback-icon ${effectStatus} feedback-effect-animation`}>

              {effectStatus === 'correct' ? '○' : '×'}

            </div>

          </div>

        )}

              <div className={quizState === 'active' ? "w-full" : "max-w-3xl mx-auto"}>

                {quizState === 'setup' && (

                  (isLoading || isPlansLoading) ? (

                    <LoadingSpinner />

                  ) : (

                    <div className="max-w-2xl mx-auto">

                      <div className="bg-white rounded-xl shadow p-8">

                        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">

                          <div>

                            <div className="flex items-center justify-between mb-2">

                              <label className="heading-2 block text-sm font-medium text-gray-700">科目 (複数選択可)</label>

                              <button onClick={() => setIsVisibilityModalOpen(true)} className="p-1 rounded-md hover:bg-gray-200" title="表示科目の制御">

                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" />

                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />

                                </svg>

                              </button>

                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">

                              {visibleSubjects.map((s: Subject) => {

                                const isSelected = selectedSubjectNames.includes(s.name);

                                const isTodayMode = quizMode === 'today_remaining';

                                

                                let buttonClass = 'px-3 py-2 rounded-md text-sm font-medium text-left truncate transition-colors ';

        

                                if (isTodayMode) {

                                  if (isSelected) {

                                    // 予定に含まれる科目: 少し薄く

                                    buttonClass += 'bg-primary-new text-white shadow-sm opacity-75 cursor-not-allowed';

                                  } else {

                                    // 予定に含まれない科目: グレーアウト

                                    buttonClass += 'bg-gray-100 text-gray-400 cursor-not-allowed';

                                  }

                                } else {

                                  if (isSelected) {

                                    // 通常選択時のスタイル

                                    buttonClass += 'bg-primary-new text-white shadow-sm';

                                  } else {

                                    // 通常非選択時のスタイル

                                    buttonClass += 'bg-gray-200 text-gray-700 hover:bg-gray-300';

                                  }

                                }

        

                                return (

                                  <button

                                    key={s.name}

                                    type="button"

                                    onClick={() => handleSubjectSelection(s.name)}

                                    disabled={isTodayMode}

                                    className={buttonClass}

                                  >

                                    {s.name}

                                  </button>

                                );

                              })}

                            </div>

                          </div>

                          <div>

                            <label className="heading-2 block text-sm font-medium text-gray-700">モード</label>

                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3">

                              <button type="button" onClick={() => setQuizMode('today_remaining')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'today_remaining' ? 'bg-[#e8383d] text-white' : 'bg-red-100 text-gray-700 hover:bg-red-200'}`}>今日の残り</button>

                              <button type="button" onClick={() => setQuizMode('random')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>ランダム</button>

                              <button type="button" onClick={() => setQuizMode('weak_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>苦手克服</button>

                              <button type="button" onClick={() => setQuizMode('unanswered')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>未解答問題</button>

                              <button type="button" onClick={() => setQuizMode('specific_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'specific_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>特定領域</button>

                            </div>

                          </div>

                          {quizMode === 'specific_area' && (
                            <div>
                              <div className="flex items-center justify-between gap-3">
                                <label className="heading-2 block text-sm font-medium text-gray-700">検索キーワード</label>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void fetchSpecificAreaCount()}
                                    disabled={isSpecificAreaCountLoading || !isSpecificAreaInvestigationReady}
                                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isSpecificAreaCountLoading ? '対象問題を調査中...' : hasSpecificAreaInvestigationResult ? '対象問題を再調査' : '対象問題を調査'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void fetchSpecificAreaSuggestions()}
                                    disabled={isSpecificAreaSuggestionsLoading || normalizedSpecificAreaKeywords.length === 0}
                                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isSpecificAreaSuggestionsLoading ? '関連語を提案中...' : '関連語を提案'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={addSpecificAreaKeywordField}
                                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
                                  >
                                    入力欄を追加
                                  </button>
                                </div>
                              </div>
                              <p className="mt-2 text-xs text-gray-500">1つの入力欄を1ワードとして扱います。いずれか1つでも一致すれば対象になります。</p>
                              <div className="mt-3 space-y-3">
                                {specificAreaKeywords.map((keyword, index) => (
                                  <div key={`specific-area-keyword-${index}`} className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={keyword}
                                      onChange={(event) => updateSpecificAreaKeyword(index, event.target.value)}
                                      placeholder={index === 0 ? '例: NPV' : `キーワード ${index + 1}`}
                                      className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeSpecificAreaKeywordField(index)}
                                      disabled={specificAreaKeywords.length === 1}
                                      className="px-3 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      削除
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="font-medium text-slate-700">調査ステータス</span>
                                  {!isSpecificAreaInvestigationReady && (
                                    <span className="text-slate-500">科目とキーワードを入力すると調査できます</span>
                                  )}
                                  {isSpecificAreaInvestigationReady && isSpecificAreaCountLoading && (
                                    <span className="text-blue-700">{SPECIFIC_AREA_PROGRESS_STEPS[specificAreaProgressStep]}</span>
                                  )}
                                  {isSpecificAreaInvestigationReady && !isSpecificAreaCountLoading && hasSpecificAreaInvestigationResult && (
                                    <span className="text-emerald-700">調査完了</span>
                                  )}
                                  {isSpecificAreaInvestigationReady && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && (
                                    <span className="text-amber-700">未調査</span>
                                  )}
                                  {specificAreaCountError && !isSpecificAreaCountLoading && (
                                    <span className="text-red-700">調査失敗</span>
                                  )}
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${specificAreaCountError ? 'bg-red-400' : hasSpecificAreaInvestigationResult ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                    style={{
                                      width: !isSpecificAreaInvestigationReady
                                        ? '0%'
                                        : `${((specificAreaCountError ? 1 : specificAreaProgressStep + (hasSpecificAreaInvestigationResult ? 1 : 0)) / SPECIFIC_AREA_PROGRESS_STEPS.length) * 100}%`,
                                    }}
                                  />
                                </div>
                                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  {SPECIFIC_AREA_PROGRESS_STEPS.map((stepLabel, index) => {
                                    const isCompleted = hasSpecificAreaInvestigationResult && index <= specificAreaProgressStep;
                                    const isCurrent = isSpecificAreaCountLoading && index === specificAreaProgressStep;
                                    return (
                                      <div
                                        key={stepLabel}
                                        className={`rounded-md border px-3 py-2 text-xs ${
                                          isCompleted
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                            : isCurrent
                                              ? 'border-blue-200 bg-blue-50 text-blue-700'
                                              : 'border-slate-200 bg-white text-slate-500'
                                        }`}
                                      >
                                        {index + 1}. {stepLabel}
                                      </div>
                                    );
                                  })}
                                </div>
                                {isSpecificAreaInvestigationReady && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && (
                                  <p className="mt-3 text-xs text-amber-700">キーワード・科目・対象条件を変更した場合は、もう一度「対象問題を調査」を押してください。</p>
                                )}
                                {specificAreaCountError && !isSpecificAreaCountLoading && (
                                  <p className="mt-3 text-xs text-red-700">{specificAreaCountError}</p>
                                )}
                              </div>
                              <div className="mt-4">
                                <label className="heading-2 block text-sm font-medium text-gray-700">対象条件</label>
                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <button
                                    type="button"
                                    onClick={() => setSpecificAreaHistoryScope('all')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium ${specificAreaHistoryScope === 'all' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                  >
                                    全問題
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSpecificAreaHistoryScope('unanswered')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium ${specificAreaHistoryScope === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                  >
                                    未回答のみ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSpecificAreaHistoryScope('answered')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium ${specificAreaHistoryScope === 'answered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                  >
                                    既回答のみ
                                  </button>
                                </div>
                              </div>
                              <div className="mt-4">
                                <label className="heading-2 block text-sm font-medium text-gray-700">関連語候補</label>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {specificAreaSuggestions.map((suggestion) => (
                                    <button
                                      key={suggestion}
                                      type="button"
                                      onClick={() => applySpecificAreaSuggestion(suggestion)}
                                      className="px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                                    >
                                      {suggestion}
                                    </button>
                                  ))}
                                  {!isSpecificAreaSuggestionsLoading && specificAreaSuggestions.length === 0 && (
                                    <p className="text-xs text-gray-500">必要なら関連語を提案で候補を出し、使いたいものだけ追加できます。</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          <div>

                            <label className="heading-2 block text-sm font-medium text-gray-700">問題数</label>

                            <div className="mt-2 text-sm text-gray-500 mb-2">

                              {quizMode === 'today_remaining' && `(今日の残り: ${todayRemaining.count} 問 (予定:${todayRemaining.plan} / 実績:${todayRemaining.actual}) / 2分/問で約${estimatedCompletionText})`}
                              {quizMode === 'today_remaining' && todayRemainingPaceHint && (
                                <div className="mt-1 text-xs font-medium text-[#e8383d]">{todayRemainingPaceHint}</div>
                              )}

                              {quizMode === 'unanswered' && unansweredCount !== null && `(未解答: ${unansweredCount} 問)`}

                              {quizMode === 'weak_area' && weakAreaCount !== null && `(苦手問題: ${weakAreaCount} 問)`}

                              {quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length === 0 && '(キーワードを1つ以上入力してください)'}

                              {quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length > 0 && !isSpecificAreaCountLoading && hasSpecificAreaInvestigationResult && specificAreaCount !== null && `(対象問題数: ${specificAreaCount} 問)`}

                              {quizMode === 'specific_area' && isSpecificAreaCountLoading && '(対象選定中...)'}

                              {quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length > 0 && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && '(対象問題を調査してください)'}

                            </div>

                            <div className="mt-2 grid grid-cols-5 gap-3">

                              {[

                                { label: '1', value: 1 },

                                { label: '10', value: 10 },

                                { label: '20', value: 20 },

                                { label: 'MAX', value: 1000 }, // Default MAX is 1000

                              ].map((option) => {

                                let actualButtonValue = option.value;

                                let displayButtonLabel = option.label;

        

                                if (option.label === 'MAX') {

                                  if (quizMode === 'today_remaining') {

                                    actualButtonValue = todayRemaining.count;

                                    displayButtonLabel = `MAX (${todayRemaining.count})`;

                                  } else if (quizMode === 'unanswered' && unansweredCount !== null) {

                                    actualButtonValue = unansweredCount;

                                    displayButtonLabel = `MAX (${unansweredCount})`;

                                  } else if (quizMode === 'weak_area' && weakAreaCount !== null) {

                                    actualButtonValue = weakAreaCount;

                                    displayButtonLabel = `MAX (${weakAreaCount})`;

                                  } else if (quizMode === 'specific_area' && specificAreaCount !== null) {

                                    actualButtonValue = specificAreaCount;

                                    displayButtonLabel = `MAX (${specificAreaCount})`;

                                  }

                                }

        

                                const isDisabled = (quizMode === 'today_remaining' && actualButtonValue > todayRemaining.count) ||

                                                   (quizMode === 'unanswered' && unansweredCount !== null && actualButtonValue > unansweredCount) ||

                                                   (quizMode === 'weak_area' && weakAreaCount !== null && actualButtonValue > weakAreaCount) ||

                                                   (quizMode === 'specific_area' && specificAreaCount !== null && actualButtonValue > specificAreaCount) ||

                                                   actualButtonValue <= 0; // Disable if value is 0 or less

        

                                return (

                                  <button

                                    key={option.label}

                                    type="button"

                                    onClick={() => setNumQuestions(actualButtonValue)}

                                    disabled={isDisabled}

                                    className={`px-2 py-2 rounded-md text-sm font-medium transition-colors ${

                                      numQuestions === actualButtonValue && !isDisabled

                                        ? 'bg-primary-new text-white'

                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'

                                    }`}

                                  >

                                    {displayButtonLabel}

                                  </button>

                                );

                              })}

                            </div>

                          </div>

                        </form>

                        <div className="mt-6">

                          <button type="button" onClick={() => void startQuiz()} disabled={isLoading || selectedSubjectNames.length === 0} className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-new">

                            {isLoading ? <LoaderIcon className="w-5 h-5" /> : null}

                            {isLoading ? 'クイズ準備中...' : 'Start'}

                          </button>
                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => openIpadMode('air')}
                              disabled={isLoading || selectedSubjectNames.length === 0 || quizMode === 'specific_area'}
                              className="w-full py-3 px-4 border border-cyan-600 rounded-md shadow-sm text-base font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              iPad Airモード
                            </button>
                            <button
                              type="button"
                              onClick={() => openIpadMode('mini')}
                              disabled={isLoading || selectedSubjectNames.length === 0 || quizMode === 'specific_area'}
                              className="w-full py-3 px-4 border border-sky-600 rounded-md shadow-sm text-base font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              iPad miniモード
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => void startQuiz(true)}
                            disabled={isLoading || selectedSubjectNames.length === 0}
                            className="mt-3 w-full py-3 px-4 border border-[#e8383d] rounded-md shadow-sm text-base font-medium text-[#e8383d] bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            強制モード
                          </button>

                        </div>

                        {(error || plansError) && <p className="text-danger text-sm mt-2 text-center">{error || plansError}</p>}

                      </div>

                      <SubjectProgress selectedSubjectNames={selectedSubjectNames} quizMode={quizMode} />

                    </div>

                  )

                )}

                

                {quizState === 'finished' && (

                  <div className="text-center max-w-lg mx-auto">

                    <h2 className="text-3xl font-bold text-dark mb-4">完了！</h2>

                    <div className="bg-white rounded-xl shadow p-8">
                      <div className="flex justify-center mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsForcedSession(false);
                            setQuizState('setup');
                          }}
                          className="px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700"
                        >
                          科目選択に遷移
                        </button>
                      </div>

                    </div>

                  </div>

                )}

                

                {quizState === 'active' && renderActiveQuiz()}

              </div>

        {editingMemo && (

          <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex justify-center items-center p-4">

            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-3/4 flex flex-col">

              <h3 className="text-lg font-bold p-4 border-b">

                {editingMemo.type === 'scratchpad' ? 'メモ帳' : 'My Memo'}

              </h3>

              <textarea

                value={editingMemo.content}

                onChange={(e) => setEditingMemo({ ...editingMemo, content: e.target.value })}

                className="flex-grow w-full p-4 border-0 focus:ring-0 text-base"

              />

              <div className="p-4 border-t flex justify-end">

                <button

                  onClick={handleSaveAndCloseModal}

                  className="px-6 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700"

                >

                  保存して閉じる

                </button>

              </div>

            </div>

          </div>

        )}

        {previewImageUrl && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setPreviewImageUrl(null)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white"
              onClick={() => setPreviewImageUrl(null)}
            >
              閉じる
            </button>
            <img
              src={previewImageUrl}
              alt="My Memo preview"
              className="max-h-full max-w-full rounded-lg bg-white object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

  

        {editingProblem && (

          <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">

            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">

              <h3 className="text-xl font-bold p-4 border-b">問題の編集</h3>

              <div className="flex-grow overflow-y-auto p-6 space-y-4">

                {/* 問題文 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">問題文</label>

                  <textarea name="question_text" value={editingProblem.question_text} onChange={handleProblemFormChange} rows={4} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

                {/* 選択肢 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">選択肢</label>

                  <div className="space-y-2 mt-1">

                    {editingProblem.choices.map((choice, index) => (

                      <div key={index} className="flex items-center gap-2">

                        <input type="text" value={choice.label} onChange={(e) => handleProblemChoiceChange(index, 'label', e.target.value)} className="w-16 shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                        <input type="text" value={choice.text} onChange={(e) => handleProblemChoiceChange(index, 'text', e.target.value)} className="flex-grow shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                      </div>

                    ))}

                  </div>

                </div>

                {/* 正解 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">正解の選択肢ラベル</label>

                  <input type="text" name="answer" value={editingProblem.answer} onChange={handleProblemFormChange} className="mt-1 w-32 block shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

                {/* カテゴリ */}

                <div>

                  <label className="heading-2 block text-sm font-medium text-gray-700">カテゴリ</label>

                  <input type="text" name="category" value={editingProblem.category || ''} onChange={handleProblemFormChange} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

                {/* 解説 */}

                <div>

                  <label className="heading-2 block text-sm font-medium text-gray-700">解説</label>

                  <textarea name="explanation.text" value={editingProblem.explanation.text} onChange={handleProblemFormChange} rows={6} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

              </div>

              <div className="p-4 border-t flex justify-end gap-4">

                <button onClick={() => setEditingProblem(null)} className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">

                  キャンセル

                </button>

                <button onClick={handleSaveChanges} className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">

                  変更を保存

                </button>

              </div>

            </div>

          </div>

        )}

      </>

    );

  }

  
