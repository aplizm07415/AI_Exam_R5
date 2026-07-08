import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import LoadingSpinner from './components/LoadingSpinner';
import { markdownComponents, markdownRehypePlugins } from './components/markdownComponents';
import SubjectVisibilityModal from './components/SubjectVisibilityModal';
import SubjectProgress from './components/SubjectProgress';
import { usePlans } from './hooks/usePlans';
import type { Plan } from './types/plan.d';
import { getMinutesUntilJstHour, getNowJstParts, getTodayYmdJst } from './utils/date';
import { buildPlanSchedule } from './utils/planSchedule';

const API_BASE_URL = "/api";
const QUESTION_TIMER_MS = 2 * 60 * 1000;
const FORCED_ANSWER_TIMER_MS = 80 * 1000;
const SUBJECT_SELECTION_PATTERNS_STORAGE_KEY = 'subjectSelectionPatterns';
const STUDY_ACTION_MODE_VISIBILITY_STORAGE_KEY = 'hiddenStudyActionModes';
const PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY = 'paperPracticePendingRequest';
const ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY = 'adhocQuizHistoryMode';
const SIMILAR_PRACTICE_HISTORY_MODE = 'similar_practice';
const WORRY_PRACTICE_INPUT_STORAGE_KEY = 'worryPracticeInput';
const WORRY_PRACTICE_SUBJECT_NAME = '心配事演習.json';
const SPECIFIC_AREA_PROGRESS_STEPS = [
  '条件を確認中',
  '問題文・解説を照合中',
  '対象件数を集計中',
] as const;
const WORRY_PRACTICE_GENERATION_STEPS = [
  '診断士試験の論点へ変換中',
  '4択問題を生成中',
  '選択肢と正解根拠を点検中',
  '保存版を作成中',
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
  question_text_md?: string;
  question_text_mermaid?: string;
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

interface SubjectSelectionPattern {
  id: string;
  name: string;
  subjectNames: string[];
  createdAt: string;
}

interface StudySettingsPayload {
  subject_selection_patterns: SubjectSelectionPattern[];
  default_subject_pattern_id: string | null;
  default_quiz_mode: QuizMode;
  hidden_study_action_modes: StudyActionMode[];
}

interface WorryPracticeVersionSummary {
  id: string;
  input_hash: string;
  version: number;
  title: string;
  concern_text: string;
  count: number;
  question_count: number;
  created_at: string;
  updated_at: string;
}

interface WorryPracticeVersion extends WorryPracticeVersionSummary {
  quiz_set: QuizQuestion[];
}

interface MermaidDiagramProps {
  chart: string;
}

function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const idBaseRef = useRef(`question-mermaid-${Math.random().toString(36).slice(2)}`);
  const renderCountRef = useRef(0);
  const [svg, setSvg] = useState('');
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    const source = chart.trim();
    if (!source) {
      setSvg('');
      setRenderError('');
      return;
    }

    let isCancelled = false;

    const renderDiagram = async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default',
        });
        renderCountRef.current += 1;
        const renderId = `${idBaseRef.current}-${renderCountRef.current}`;
        const result = await mermaid.render(renderId, source);
        if (!isCancelled) {
          setSvg(result.svg);
          setRenderError('');
        }
      } catch (error) {
        if (!isCancelled) {
          setSvg('');
          setRenderError(error instanceof Error ? error.message : 'Mermaid図の描画に失敗しました。');
        }
      }
    };

    void renderDiagram();

    return () => {
      isCancelled = true;
    };
  }, [chart]);

  if (renderError) {
    return (
      <div className="question-mermaid question-mermaid--error">
        <p className="text-xs font-semibold text-red-700">Mermaid図を描画できませんでした。</p>
        <pre>{chart}</pre>
      </div>
    );
  }

  return (
    <div className="question-mermaid" aria-label="問題文の図">
      {svg ? (
        <div className="question-mermaid__svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="text-sm text-gray-500">図を描画中...</div>
      )}
    </div>
  );
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

interface TodayPlanProgress {
  planId: string;
  title: string;
  subjectNames: string[];
  planDaily: number;
  actualDaily: number;
  remaining: number;
  planCumulative: number;
  actualCumulative: number;
  isScheduledToday: boolean;
}

interface HistoryStat {
  total: number;
  correct: number;
}

type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining' | 'specific_area' | 'worry_practice';
type OralVivaStep = 'root' | 'refute' | 'apply' | 'summary';
type QuestionTagFilter = 'all' | 'calculation_only' | 'exclude_calculation';

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
type StudyActionMode = 'ipad_air' | 'ipad_mini' | 'paper_practice' | 'forced';

const STUDY_ACTION_MODE_OPTIONS: Array<{ id: StudyActionMode; label: string }> = [
  { id: 'ipad_air', label: 'iPad Airモード' },
  { id: 'ipad_mini', label: 'iPad miniモード' },
  { id: 'paper_practice', label: '紙演習モード' },
  { id: 'forced', label: '強制モード' },
];
const STUDY_ACTION_MODE_ID_SET = new Set<StudyActionMode>(STUDY_ACTION_MODE_OPTIONS.map((option) => option.id));

function normalizeSubjectSelectionPatterns(value: unknown): SubjectSelectionPattern[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  return value
    .filter((item): item is SubjectSelectionPattern => (
      item &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      Array.isArray(item.subjectNames) &&
      item.subjectNames.every((subject: unknown) => typeof subject === 'string') &&
      typeof item.createdAt === 'string'
    ))
    .map((item) => ({
      ...item,
      id: item.id.trim(),
      name: item.name.trim(),
      subjectNames: Array.from(new Set(item.subjectNames.map((subject) => subject.trim()).filter(Boolean))),
    }))
    .filter((item) => {
      if (!item.id || !item.name || seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadCachedSubjectSelectionPatterns(): SubjectSelectionPattern[] {
  try {
    const saved = localStorage.getItem(SUBJECT_SELECTION_PATTERNS_STORAGE_KEY);
    return normalizeSubjectSelectionPatterns(saved ? JSON.parse(saved) : []);
  } catch (error) {
    console.error('Failed to parse subject selection patterns from localStorage', error);
    return [];
  }
}

function normalizeHiddenStudyActionModes(value: unknown): StudyActionMode[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is StudyActionMode => (
    typeof item === 'string' && STUDY_ACTION_MODE_ID_SET.has(item as StudyActionMode)
  ))));
}

function loadCachedHiddenStudyActionModes(): StudyActionMode[] {
  try {
    const saved = localStorage.getItem(STUDY_ACTION_MODE_VISIBILITY_STORAGE_KEY);
    return normalizeHiddenStudyActionModes(saved ? JSON.parse(saved) : []);
  } catch (error) {
    console.error('Failed to parse hiddenStudyActionModes from localStorage', error);
    return [];
  }
}

function normalizeStudySettingsPayload(value: unknown): StudySettingsPayload {
  const payload = value && typeof value === 'object' ? value as Partial<StudySettingsPayload> : {};
  const subjectSelectionPatterns = normalizeSubjectSelectionPatterns(payload.subject_selection_patterns);
  const patternIds = new Set(subjectSelectionPatterns.map((pattern) => pattern.id));
  const defaultSubjectPatternId =
    typeof payload.default_subject_pattern_id === 'string' && patternIds.has(payload.default_subject_pattern_id)
      ? payload.default_subject_pattern_id
      : null;
  const defaultQuizMode: QuizMode =
    payload.default_quiz_mode === 'random' ||
      payload.default_quiz_mode === 'weak_area' ||
      payload.default_quiz_mode === 'unanswered' ||
      payload.default_quiz_mode === 'specific_area' ||
      payload.default_quiz_mode === 'worry_practice' ||
      payload.default_quiz_mode === 'today_remaining'
      ? payload.default_quiz_mode
      : 'today_remaining';

  return {
    subject_selection_patterns: subjectSelectionPatterns,
    default_subject_pattern_id: defaultSubjectPatternId,
    default_quiz_mode: defaultQuizMode,
    hidden_study_action_modes: normalizeHiddenStudyActionModes(payload.hidden_study_action_modes),
  };
}

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
  const navigate = useNavigate();
  const { plans, isLoading: isPlansLoading, error: plansError } = usePlans();
  const [dailySummaryByPlanId, setDailySummaryByPlanId] = useState<Record<string, DailySummaryItem[]>>({});
  const [isTodayProgressLoading, setIsTodayProgressLoading] = useState(false);
  const [selectedSubjectNames, setSelectedSubjectNames] = useState<string[]>([]);
  const [quizMode, setQuizMode] = useState<QuizMode>('today_remaining');
  const [questionTagFilter, setQuestionTagFilter] = useState<QuestionTagFilter>('exclude_calculation');
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const [quizState, setQuizState] = useState<'setup' | 'active' | 'finished'>('setup');
  const [isForcedSession, setIsForcedSession] = useState(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [historyStats, setHistoryStats] = useState<Record<string, HistoryStat>>({});

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [excludedChoiceLabels, setExcludedChoiceLabels] = useState<string[]>([]);
  const [isAnswered, setIsAnswered] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: Explanation } | null>(null);
  const [score, setScore] = useState(0);
  const [scratchpadText, setScratchpadText] = useState('');
  const [customExplanationText, setCustomExplanationText] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [editingMemo, setEditingMemo] = useState<{ type: 'scratchpad' | 'customExplanation', content: string } | null>(null);
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
  const [adhocHistoryMode, setAdhocHistoryMode] = useState('');
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
  const isDisposablePracticeQuestion = currentQuestion?.subject === WORRY_PRACTICE_SUBJECT_NAME;

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
  const [worryPracticeInput, setWorryPracticeInput] = useState(() => {
    try {
      return localStorage.getItem(WORRY_PRACTICE_INPUT_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [worryPracticeVersions, setWorryPracticeVersions] = useState<WorryPracticeVersionSummary[]>([]);
  const [isWorryPracticeVersionsLoading, setIsWorryPracticeVersionsLoading] = useState(false);
  const [isWorryPracticeVersionStarting, setIsWorryPracticeVersionStarting] = useState(false);
  const [deletingWorryPracticeVersionId, setDeletingWorryPracticeVersionId] = useState('');
  const [worryPracticeGenerationStep, setWorryPracticeGenerationStep] = useState(0);
  const [hiddenStudyActionModes, setHiddenStudyActionModes] = useState<StudyActionMode[]>(loadCachedHiddenStudyActionModes);
  const [subjectSelectionPatterns, setSubjectSelectionPatterns] = useState<SubjectSelectionPattern[]>(loadCachedSubjectSelectionPatterns);
  const [defaultSubjectPatternId, setDefaultSubjectPatternId] = useState<string | null>(null);
  const [defaultQuizMode, setDefaultQuizMode] = useState<QuizMode>('today_remaining');
  const [isStudySettingsLoading, setIsStudySettingsLoading] = useState(true);
  const [isStudySettingsSaving, setIsStudySettingsSaving] = useState(false);
  const [studySettingsError, setStudySettingsError] = useState('');
  const [subjectPatternName, setSubjectPatternName] = useState('');
  const [selectedSubjectPatternId, setSelectedSubjectPatternId] = useState('');
  const specificAreaProgressTimerRef = useRef<number | null>(null);
  const worryPracticeProgressTimerRef = useRef<number | null>(null);
  const didApplyDefaultStudySettingsRef = useRef(false);
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
        tagFilter: questionTagFilter,
      }),
    [selectedSubjectNames, normalizedSpecificAreaKeywords, specificAreaHistoryScope, questionTagFilter],
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

  const clearWorryPracticeProgressTimer = useCallback(() => {
    if (worryPracticeProgressTimerRef.current !== null) {
      window.clearInterval(worryPracticeProgressTimerRef.current);
      worryPracticeProgressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('subjectWeights', JSON.stringify(subjectWeights));
  }, [subjectWeights]);

  useEffect(() => {
    localStorage.setItem(SUBJECT_SELECTION_PATTERNS_STORAGE_KEY, JSON.stringify(subjectSelectionPatterns));
  }, [subjectSelectionPatterns]);

  useEffect(() => {
    localStorage.setItem(STUDY_ACTION_MODE_VISIBILITY_STORAGE_KEY, JSON.stringify(hiddenStudyActionModes));
  }, [hiddenStudyActionModes]);

  useEffect(() => {
    try {
      localStorage.setItem(WORRY_PRACTICE_INPUT_STORAGE_KEY, worryPracticeInput);
    } catch {
      // no-op
    }
  }, [worryPracticeInput]);

  const fetchWorryPracticeVersions = useCallback(async () => {
    setIsWorryPracticeVersionsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/quiz/worry-practice/versions`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || '心配事演習の保存版を取得できませんでした。');
      }
      setWorryPracticeVersions(Array.isArray(payload) ? payload : []);
    } catch (versionError) {
      console.error(versionError);
      setError(versionError instanceof Error ? versionError.message : '心配事演習の保存版を取得できませんでした。');
      setWorryPracticeVersions([]);
    } finally {
      setIsWorryPracticeVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (quizMode !== 'worry_practice') return;
    void fetchWorryPracticeVersions();
  }, [fetchWorryPracticeVersions, quizMode]);

  const applyStudySettingsPayload = useCallback((payload: StudySettingsPayload) => {
    const normalized = normalizeStudySettingsPayload(payload);
    setSubjectSelectionPatterns(normalized.subject_selection_patterns);
    setDefaultSubjectPatternId(normalized.default_subject_pattern_id);
    setDefaultQuizMode(normalized.default_quiz_mode);
    setHiddenStudyActionModes(normalized.hidden_study_action_modes);
  }, []);

  const buildStudySettingsPayload = useCallback((overrides: Partial<{
    subjectSelectionPatterns: SubjectSelectionPattern[];
    defaultSubjectPatternId: string | null;
    defaultQuizMode: QuizMode;
    hiddenStudyActionModes: StudyActionMode[];
  }> = {}): StudySettingsPayload => ({
    subject_selection_patterns: normalizeSubjectSelectionPatterns(overrides.subjectSelectionPatterns ?? subjectSelectionPatterns),
    default_subject_pattern_id: overrides.defaultSubjectPatternId !== undefined ? overrides.defaultSubjectPatternId : defaultSubjectPatternId,
    default_quiz_mode: overrides.defaultQuizMode ?? defaultQuizMode,
    hidden_study_action_modes: normalizeHiddenStudyActionModes(overrides.hiddenStudyActionModes ?? hiddenStudyActionModes),
  }), [defaultQuizMode, defaultSubjectPatternId, hiddenStudyActionModes, subjectSelectionPatterns]);

  const saveStudySettings = useCallback(async (payload: StudySettingsPayload) => {
    setIsStudySettingsSaving(true);
    setStudySettingsError('');
    try {
      const response = await fetch(`${API_BASE_URL}/study-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Study設定の保存に失敗しました。');
      }
      const normalized = normalizeStudySettingsPayload(data);
      applyStudySettingsPayload(normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Study設定の保存に失敗しました。';
      setStudySettingsError(message);
      return null;
    } finally {
      setIsStudySettingsSaving(false);
    }
  }, [applyStudySettingsPayload]);

  useEffect(() => {
    let isCancelled = false;

    const fetchStudySettings = async () => {
      setIsStudySettingsLoading(true);
      setStudySettingsError('');
      try {
        const response = await fetch(`${API_BASE_URL}/study-settings`);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || 'Study設定の読み込みに失敗しました。');
        }

        const serverSettings = normalizeStudySettingsPayload(data);
        const cachedPatterns = loadCachedSubjectSelectionPatterns();
        const cachedHiddenModes = loadCachedHiddenStudyActionModes();
        const shouldMigratePatterns = serverSettings.subject_selection_patterns.length === 0 && cachedPatterns.length > 0;
        const shouldMigrateHiddenModes = serverSettings.hidden_study_action_modes.length === 0 && cachedHiddenModes.length > 0;

        let nextSettings = serverSettings;
        if (shouldMigratePatterns || shouldMigrateHiddenModes) {
          const migrationPayload: StudySettingsPayload = {
            ...serverSettings,
            subject_selection_patterns: shouldMigratePatterns ? cachedPatterns : serverSettings.subject_selection_patterns,
            default_subject_pattern_id: shouldMigratePatterns ? null : serverSettings.default_subject_pattern_id,
            hidden_study_action_modes: shouldMigrateHiddenModes ? cachedHiddenModes : serverSettings.hidden_study_action_modes,
          };
          const saveResponse = await fetch(`${API_BASE_URL}/study-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(migrationPayload),
          });
          const savedData = await saveResponse.json().catch(() => null);
          if (saveResponse.ok) {
            nextSettings = normalizeStudySettingsPayload(savedData);
          }
        }

        if (!isCancelled) {
          applyStudySettingsPayload(nextSettings);
        }
      } catch (error) {
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : 'Study設定の読み込みに失敗しました。';
          setStudySettingsError(message);
        }
      } finally {
        if (!isCancelled) {
          setIsStudySettingsLoading(false);
        }
      }
    };

    void fetchStudySettings();

    return () => {
      isCancelled = true;
    };
  }, [applyStudySettingsPayload]);

  useEffect(() => {
    let isCancelled = false;

    const fetchDailySummaryByPlan = async () => {
      const activePlans = plans.filter((p: Plan) => p.enabled && !p.archived);
      if (activePlans.length === 0) {
        setDailySummaryByPlanId({});
        setIsTodayProgressLoading(false);
        return;
      }

      setIsTodayProgressLoading(true);
      try {
        const todayYmd = getTodayYmdJst();
        const entries = await Promise.all(activePlans.map(async (plan) => {
          if (!plan.period?.from || plan.subjectNames.length === 0) {
            return [plan.id, []] as const;
          }

          const params = new URLSearchParams();
          plan.subjectNames.forEach((subjectName) => params.append('subjects', subjectName));
          params.append('start_date', plan.period.from);
          params.append('end_date', todayYmd);

          const response = await fetch(`${API_BASE_URL}/history/daily-summary/all?${params.toString()}`);
          if (!response.ok) {
            const errorText = await response.text();
            console.error("Failed to fetch plan daily summary:", plan.id, response.status, errorText);
            return [plan.id, []] as const;
          }

          const data: DailySummaryItem[] = await response.json();
          return [plan.id, data] as const;
        }));

        if (!isCancelled) {
          setDailySummaryByPlanId(Object.fromEntries(entries));
        }
      } catch (error) {
        console.error("Failed to fetch plan daily summaries:", error);
        if (!isCancelled) {
          setDailySummaryByPlanId({});
        }
      } finally {
        if (!isCancelled) {
          setIsTodayProgressLoading(false);
        }
      }
    };

    if (!isPlansLoading) {
      void fetchDailySummaryByPlan();
    }

    return () => {
      isCancelled = true;
    };
  }, [plans, isPlansLoading]);

  const todayRemaining = useMemo(() => {
    if (isPlansLoading || isTodayProgressLoading) {
      return { count: 0, subjects: [], plan: 0, actual: 0, planDaily: 0, actualDaily: 0, planProgress: [] as TodayPlanProgress[] };
    }

    const todayYmd = getTodayYmdJst();
    const activePlans = plans.filter((p: Plan) => p.enabled && !p.archived);
    const targetSubjects = new Set<string>();
    const planProgress: TodayPlanProgress[] = activePlans.map((plan) => {
      const actualsMap = new Map(
        (dailySummaryByPlanId[plan.id] ?? [])
          .filter((item) => item.date)
          .map((item) => [item.date, item.total_questions])
      );
      const schedule = buildPlanSchedule([plan], actualsMap, todayYmd);
      const todayRow = schedule.rows.find((row) => row.date === todayYmd);
      const planDaily = todayRow?.planDaily ?? 0;
      const actualDaily = todayRow?.actualDaily ?? 0;
      const remaining = Math.max(0, planDaily - actualDaily);

      if (remaining > 0) {
        plan.subjectNames.forEach((name: string) => targetSubjects.add(name));
      }

      return {
        planId: plan.id,
        title: plan.title,
        subjectNames: plan.subjectNames,
        planDaily,
        actualDaily,
        remaining,
        planCumulative: todayRow?.planCumulative ?? 0,
        actualCumulative: todayRow?.actualCumulative ?? 0,
        isScheduledToday: planDaily > 0,
      };
    });

    const remaining = planProgress.reduce((sum, item) => sum + item.remaining, 0);
    const planDaily = planProgress.reduce((sum, item) => sum + item.planDaily, 0);
    const actualDaily = planProgress.reduce((sum, item) => sum + item.actualDaily, 0);
    const cumulativePlannedTotal = planProgress.reduce((sum, item) => sum + item.planCumulative, 0);
    const cumulativeActualTotal = planProgress.reduce((sum, item) => sum + item.actualCumulative, 0);

    return {
      count: remaining,
      subjects: Array.from(targetSubjects),
      planDaily,
      actualDaily,
      plan: cumulativePlannedTotal,
      actual: cumulativeActualTotal,
      planProgress,
    };
  }, [plans, dailySummaryByPlanId, isPlansLoading, isTodayProgressLoading]);

  useEffect(() => {
    if (quizMode === 'today_remaining') {
      setSelectedSubjectNames(todayRemaining.subjects);
      setSelectedSubjectPatternId('');
    } else if (quizMode === 'worry_practice') {
      setSelectedSubjectNames([]);
      setSelectedSubjectPatternId('');
    }
  }, [quizMode, todayRemaining]);

  // メモ化しないと worry_practice モードでレンダーごとに新しい配列が生成され、
  // この値を依存に持つ useEffect / 子コンポーネントが無限ループする。
  const effectiveSelectedSubjectNames = useMemo(
    () =>
      quizMode === 'worry_practice'
        ? [WORRY_PRACTICE_SUBJECT_NAME]
        : quizMode === 'today_remaining'
          ? todayRemaining.subjects
          : selectedSubjectNames,
    [quizMode, todayRemaining.subjects, selectedSubjectNames],
  );

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
      setAdhocHistoryMode(sessionStorage.getItem(ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY) || SIMILAR_PRACTICE_HISTORY_MODE);
      shuffledChoicesByQuestionRef.current = {};
      prefetchedImageUrlsRef.current = new Set();
      resetQuestionState();
      sessionStorage.removeItem('adhocQuizSet');
      sessionStorage.removeItem('adhocQuizLabel');
      sessionStorage.removeItem(ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY);
      params.delete('adhoc');
      const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : '類題セットの読み込みに失敗しました。';
      setError(message);
      sessionStorage.removeItem('adhocQuizSet');
      sessionStorage.removeItem('adhocQuizLabel');
      sessionStorage.removeItem(ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY);
      setAdhocHistoryMode('');
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

  const visibleSubjectNameSet = useMemo(() => {
    return new Set(visibleSubjects.map((subject) => subject.name));
  }, [visibleSubjects]);

  const subjectSelectionPatternOptions = useMemo(() => {
    return subjectSelectionPatterns.map((pattern) => ({
      ...pattern,
      availableSubjectNames: pattern.subjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName)),
    }));
  }, [subjectSelectionPatterns, visibleSubjectNameSet]);

  useEffect(() => {
    if (didApplyDefaultStudySettingsRef.current || isStudySettingsLoading || allSubjects.length === 0) {
      return;
    }

    didApplyDefaultStudySettingsRef.current = true;
    setQuizMode(defaultQuizMode);

    if (defaultQuizMode === 'today_remaining' || defaultQuizMode === 'worry_practice' || !defaultSubjectPatternId) {
      return;
    }

    const defaultPattern = subjectSelectionPatterns.find((pattern) => pattern.id === defaultSubjectPatternId);
    const subjectNames = defaultPattern?.subjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName)) ?? [];
    if (subjectNames.length > 0) {
      setSelectedSubjectNames(subjectNames);
      setSelectedSubjectPatternId(defaultSubjectPatternId);
    }
  }, [
    allSubjects.length,
    defaultQuizMode,
    defaultSubjectPatternId,
    isStudySettingsLoading,
    subjectSelectionPatterns,
    visibleSubjectNameSet,
  ]);

  const handleHiddenSubjectsChange = (newHiddenSubjects: string[]) => {
    setHiddenSubjects(newHiddenSubjects);
    localStorage.setItem('hiddenSubjects', JSON.stringify(newHiddenSubjects));
    setSelectedSubjectNames((prev: string[]) => prev.filter((name: string) => !newHiddenSubjects.includes(name)));
    setSelectedSubjectPatternId('');
  };

  const setStudyActionModeVisible = (mode: StudyActionMode, isVisible: boolean) => {
    const nextHiddenModes = isVisible
      ? hiddenStudyActionModes.filter((item) => item !== mode)
      : Array.from(new Set([...hiddenStudyActionModes, mode]));
    setHiddenStudyActionModes(nextHiddenModes);
    void saveStudySettings(buildStudySettingsPayload({ hiddenStudyActionModes: nextHiddenModes }));
  };

  const isStudyActionModeVisible = (mode: StudyActionMode) => !hiddenStudyActionModes.includes(mode);

  useEffect(() => {
    const fetchUnansweredCount = async () => {
      if (quizMode === 'unanswered' && selectedSubjectNames.length > 0) {
        setIsCountLoading(true);
        setUnansweredCount(null);
        try {
          const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
          const params = subjectParams
            ? `${subjectParams}&tag_filter=${encodeURIComponent(questionTagFilter)}`
            : `tag_filter=${encodeURIComponent(questionTagFilter)}`;
          const response = await fetch(`${API_BASE_URL}/quiz/unanswered-count?${params}`);
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
  }, [quizMode, selectedSubjectNames, questionTagFilter]);

  useEffect(() => {
    const fetchWeakAreaCount = async () => {
      if (quizMode === 'weak_area' && selectedSubjectNames.length > 0) {
        setIsWeakCountLoading(true);
        setWeakAreaCount(null);
        try {
          const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
          const queryParams = subjectParams
            ? `${subjectParams}&tag_filter=${encodeURIComponent(questionTagFilter)}`
            : `tag_filter=${encodeURIComponent(questionTagFilter)}`;
          const response = await fetch(`${API_BASE_URL}/quiz/missed-problems-count?${queryParams}`);
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
  }, [quizMode, selectedSubjectNames, questionTagFilter]);

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

  useEffect(() => () => {
    clearWorryPracticeProgressTimer();
  }, [clearWorryPracticeProgressTimer]);

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
          subjects: effectiveSelectedSubjectNames,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setHistoryStats(data);
      }
    } catch (fetchError) {
      console.error("Failed to fetch history stats:", fetchError);
    }
  }, [questions, effectiveSelectedSubjectNames]);

  useEffect(() => {
    fetchHistoryStats();
  }, [fetchHistoryStats]);

  const handleSubjectSelection = (subjectName: string) => {
    setSelectedSubjectPatternId('');
    setSelectedSubjectNames((prev: string[]) =>
      prev.includes(subjectName)
        ? prev.filter((s: string) => s !== subjectName)
        : [...prev, subjectName]
    );
  };

  const saveSubjectSelectionPattern = () => {
    if (quizMode === 'today_remaining') {
      alert('今日の残りモードでは、科目は学習計画から自動選択されます。');
      return;
    }
    if (quizMode === 'worry_practice') {
      alert('心配事演習では、科目は心配事演習として自動記録されます。');
      return;
    }

    const patternName = subjectPatternName.trim();
    if (!patternName) {
      alert('パターン名を入力してください。');
      return;
    }

    const subjectNames = selectedSubjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName));
    if (subjectNames.length === 0) {
      alert('登録する科目を1つ以上選択してください。');
      return;
    }

    const existingPattern = subjectSelectionPatterns.find((pattern) => pattern.name === patternName);
    const patternId = existingPattern?.id ?? `subject-pattern-${Date.now()}`;
    const nextPattern: SubjectSelectionPattern = {
      id: patternId,
      name: patternName,
      subjectNames,
      createdAt: existingPattern?.createdAt ?? new Date().toISOString(),
    };

    const nextPatterns = normalizeSubjectSelectionPatterns([
      ...subjectSelectionPatterns.filter((pattern) => pattern.name !== patternName),
      nextPattern,
    ]);
    setSubjectSelectionPatterns(nextPatterns);
    setSelectedSubjectPatternId(patternId);
    setSubjectPatternName('');
    void saveStudySettings(buildStudySettingsPayload({ subjectSelectionPatterns: nextPatterns }));
  };

  const applySubjectSelectionPattern = (patternId: string) => {
    if (!patternId) {
      setSelectedSubjectPatternId('');
      return;
    }

    if (quizMode === 'today_remaining') {
      alert('今日の残りモードでは、科目は学習計画から自動選択されます。');
      setSelectedSubjectPatternId('');
      return;
    }
    if (quizMode === 'worry_practice') {
      alert('心配事演習では、科目パターンは使いません。');
      setSelectedSubjectPatternId('');
      return;
    }

    const pattern = subjectSelectionPatterns.find((item) => item.id === patternId);
    if (!pattern) {
      setSelectedSubjectPatternId('');
      return;
    }

    const subjectNames = pattern.subjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName));
    if (subjectNames.length === 0) {
      alert('このパターンで選択できる表示中の科目がありません。');
      setSelectedSubjectPatternId('');
      return;
    }

    setSelectedSubjectNames(subjectNames);
    setSelectedSubjectPatternId(pattern.id);
  };

  const deleteSelectedSubjectSelectionPattern = () => {
    if (!selectedSubjectPatternId) return;
    const pattern = subjectSelectionPatterns.find((item) => item.id === selectedSubjectPatternId);
    if (!pattern) return;
    if (!window.confirm(`科目パターン「${pattern.name}」を削除しますか？`)) return;

    const nextPatterns = subjectSelectionPatterns.filter((item) => item.id !== selectedSubjectPatternId);
    const nextDefaultSubjectPatternId = defaultSubjectPatternId === selectedSubjectPatternId ? null : defaultSubjectPatternId;
    setSubjectSelectionPatterns(nextPatterns);
    setDefaultSubjectPatternId(nextDefaultSubjectPatternId);
    setSelectedSubjectPatternId('');
    void saveStudySettings(buildStudySettingsPayload({
      subjectSelectionPatterns: nextPatterns,
      defaultSubjectPatternId: nextDefaultSubjectPatternId,
    }));
  };

  const setDefaultSubjectPattern = (patternId: string) => {
    const nextDefaultSubjectPatternId = patternId || null;
    setDefaultSubjectPatternId(nextDefaultSubjectPatternId);
    void saveStudySettings(buildStudySettingsPayload({ defaultSubjectPatternId: nextDefaultSubjectPatternId }));
  };

  const setCurrentQuizModeAsDefault = () => {
    setDefaultQuizMode(quizMode);
    void saveStudySettings(buildStudySettingsPayload({ defaultQuizMode: quizMode }));
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
      params.append('tag_filter', questionTagFilter);
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

  const startWorryPracticeVersion = async (versionId: string) => {
    if (isWorryPracticeVersionStarting) return;
    setIsWorryPracticeVersionStarting(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/quiz/worry-practice/versions/${encodeURIComponent(versionId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || '心配事演習の保存版を取得できませんでした。');
      }
      const version = payload as WorryPracticeVersion;
      const quizSet = Array.isArray(version.quiz_set) ? version.quiz_set : [];
      if (quizSet.length === 0) {
        throw new Error('この保存版には再演習できる問題がありません。');
      }

      setWorryPracticeInput(version.concern_text || '');
      setQuestions(quizSet);
      shuffledChoicesByQuestionRef.current = {};
      prefetchedImageUrlsRef.current = new Set();
      setAdhocQuizLabel(`心配事演習 v${version.version}`);
      setAdhocHistoryMode('');
      setSelectedSubjectNames([WORRY_PRACTICE_SUBJECT_NAME]);
      setCurrentQuestionIndex(0);
      setScore(0);
      setIsForcedSession(false);
      setQuizState('active');
      resetQuestionState();
    } catch (versionError) {
      console.error(versionError);
      setError(versionError instanceof Error ? versionError.message : '心配事演習の保存版を開始できませんでした。');
    } finally {
      setIsWorryPracticeVersionStarting(false);
    }
  };

  const deleteWorryPracticeVersion = async (versionId: string) => {
    if (deletingWorryPracticeVersionId) return;
    const shouldDelete = window.confirm('この心配事演習の保存版を削除しますか？');
    if (!shouldDelete) return;

    setDeletingWorryPracticeVersionId(versionId);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/quiz/worry-practice/versions/${encodeURIComponent(versionId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '心配事演習の保存版を削除できませんでした。');
      }
      setWorryPracticeVersions((prev) => prev.filter((item) => item.id !== versionId));
    } catch (versionError) {
      console.error(versionError);
      setError(versionError instanceof Error ? versionError.message : '心配事演習の保存版を削除できませんでした。');
    } finally {
      setDeletingWorryPracticeVersionId('');
    }
  };

  const startQuiz = async (forcedSession = false) => {
    setAdhocHistoryMode('');
    let questionsToFetch = numQuestions;
    if (quizMode === 'worry_practice') {
      const concernText = worryPracticeInput.trim();
      if (!concernText) {
        setError('心配事演習では、苦手分野や出してほしい類題情報を入力してください。');
        return;
      }
      if (questionsToFetch <= 0) {
        setError('出題する問題数が0以下です。');
        return;
      }

      setIsLoading(true);
      setError('');
      clearWorryPracticeProgressTimer();
      setWorryPracticeGenerationStep(0);
      worryPracticeProgressTimerRef.current = window.setInterval(() => {
        setWorryPracticeGenerationStep((prev) => Math.min(prev + 1, WORRY_PRACTICE_GENERATION_STEPS.length - 1));
      }, 900);
      try {
        const response = await fetch(`${API_BASE_URL}/quiz/worry-practice/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            concern_text: concernText,
            count: questionsToFetch,
            reference_subjects: selectedSubjectNames,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || '心配事演習問題の生成に失敗しました。');
        }
        const quizSet = Array.isArray(data?.quiz_set) ? data.quiz_set : [];
        if (quizSet.length === 0) {
          throw new Error('出題できる問題がありません。');
        }
        const version = data?.version as WorryPracticeVersionSummary | undefined;
        if (version?.id) {
          setWorryPracticeVersions((prev) => [version, ...prev.filter((item) => item.id !== version.id)]);
        }
        setWorryPracticeGenerationStep(WORRY_PRACTICE_GENERATION_STEPS.length - 1);
        setQuestions(quizSet);
        shuffledChoicesByQuestionRef.current = {};
        prefetchedImageUrlsRef.current = new Set();
        setAdhocQuizLabel(version ? `心配事演習 v${version.version}` : '心配事演習');
        setCurrentQuestionIndex(0);
        setScore(0);
        setIsForcedSession(false);
        setQuizState('active');
        resetQuestionState();
      } catch (e: any) {
        setError(e.message);
      } finally {
        clearWorryPracticeProgressTimer();
        setIsLoading(false);
      }
      return;
    }

    if (quizMode === 'today_remaining') {
      if (isTodayProgressLoading) {
        setError('学習予定の実績を読み込み中です。少し待ってから開始してください。');
        return;
      }
      if (todayRemaining.count === 0) {
        setError('今日の予定は完了しています！');
        return;
      }
      questionsToFetch = Math.min(numQuestions, todayRemaining.count);
    }

    if (effectiveSelectedSubjectNames.length === 0) {
      setError(quizMode === 'today_remaining' ? '今日の予定に未完了の対象科目がありません。' : '科目を1つ以上選択してください。');
      return;
    }

    if (quizMode === 'unanswered') {
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
          subjects: effectiveSelectedSubjectNames,
          mode: apiMode,
          count: questionsToFetch,
          weights: quizMode === 'random' ? subjectWeights : undefined,
          keywords: quizMode === 'specific_area' ? normalizedSpecificAreaKeywords : undefined,
          specific_area_history_scope: quizMode === 'specific_area' ? specificAreaHistoryScope : undefined,
          tag_filter: questionTagFilter,
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
      setAdhocHistoryMode('');
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
    let questionsToFetch = numQuestions;
    if (quizMode === 'today_remaining') {
      if (isTodayProgressLoading) {
        setError('学習予定の実績を読み込み中です。少し待ってから開始してください。');
        return;
      }
      if (todayRemaining.count === 0) {
        setError('今日の予定は完了しています！');
        return;
      }
      questionsToFetch = Math.min(numQuestions, todayRemaining.count);
    }

    if (effectiveSelectedSubjectNames.length === 0) {
      setError(quizMode === 'today_remaining' ? '今日の予定に未完了の対象科目がありません。' : '科目を1つ以上選択してください。');
      return;
    }

    if (quizMode === 'unanswered') {
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

    const subjectQuery = effectiveSelectedSubjectNames
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

  const openPaperPracticeMode = () => {
    let questionsToFetch = numQuestions;
    if (quizMode === 'today_remaining') {
      if (isTodayProgressLoading) {
        setError('学習予定の実績を読み込み中です。少し待ってから開始してください。');
        return;
      }
      if (todayRemaining.count === 0) {
        setError('今日の予定は完了しています！');
        return;
      }
      questionsToFetch = Math.min(numQuestions, todayRemaining.count);
    }

    if (effectiveSelectedSubjectNames.length === 0) {
      setError(quizMode === 'today_remaining' ? '今日の予定に未完了の対象科目がありません。' : '科目を1つ以上選択してください。');
      return;
    }

    if (quizMode === 'unanswered') {
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
      setError('紙演習ロットにする問題数が0以下です。');
      return;
    }

    const shouldCreateLot = window.confirm(
      '現在の演習設定で新しい紙演習ロットを作成しますか？\n\nOK: ロットを作成して一覧へ移動\nキャンセル: ロットを作成せず一覧だけ表示'
    );
    if (!shouldCreateLot) {
      sessionStorage.removeItem(PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY);
      navigate('/paper-practice');
      return;
    }

    const apiMode = quizMode === 'today_remaining' ? 'unanswered' : quizMode;
    sessionStorage.setItem(PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY, JSON.stringify({
      subjects: effectiveSelectedSubjectNames,
      mode: apiMode,
      source_mode: quizMode,
      count: Math.max(1, questionsToFetch),
      weights: quizMode === 'random' ? subjectWeights : undefined,
      keywords: quizMode === 'specific_area' ? normalizedSpecificAreaKeywords : undefined,
      specific_area_history_scope: quizMode === 'specific_area' ? specificAreaHistoryScope : undefined,
      tag_filter: questionTagFilter,
    }));
    navigate('/paper-practice');
  };

  const resetQuestionState = () => {
    setSelectedAnswer(null);
    setExcludedChoiceLabels([]);
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
    setExcludedChoiceLabels([]);

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
          mode: adhocHistoryMode || quizMode,
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
    if (!isDisposablePracticeQuestion && customExplanationText.trim() !== originalText.trim()) {
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
    if (isDisposablePracticeQuestion) return;
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

  const toggleChoiceExclusion = (label: string) => {
    if (isAnswered) return;
    setExcludedChoiceLabels((prev) => {
      if (prev.includes(label)) {
        return prev.filter((item) => item !== label);
      }
      return [...prev, label];
    });
    if (selectedAnswer === label) {
      setSelectedAnswer(null);
    }
  };



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

    const questionTextMd = currentQuestion.question_text_md?.trim();
    const questionTextMermaid = currentQuestion.question_text_mermaid?.trim();

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
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={markdownRehypePlugins} components={markdownComponents}>{feedback?.explanation?.text || ''}</ReactMarkdown>
        </div>
        {!isDisposablePracticeQuestion && currentExplanationImageDataUrls.length > 0 && (
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
        {!isDisposablePracticeQuestion && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-base md:text-lg font-semibold text-primary-new">My Memo</h4>
            <button onClick={() => openMemoModal('customExplanation')} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="拡大表示">
              <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4" /></svg>
            </button>
          </div>
          <textarea
            value={customExplanationText}
            onChange={(e) => setCustomExplanationText(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new"
            rows={4}
          />
        </div>
        )}
        {!isDisposablePracticeQuestion && (
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
        )}
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
          {!isDisposablePracticeQuestion ? (
            <button
              onClick={openProblemEditor}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              この問題を編集する
            </button>
          ) : <span />}
          <button id="next-question-button-bottom" type="button" onClick={handleNextQuestion} disabled={isSavingCustomExplanation} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed">
            {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了'}
          </button>
        </div>
      </div>
    ) : null;

    const questionColumn = (
      <div className="bg-white rounded-xl shadow p-6 md:p-8 min-h-full flex flex-col">
        <div className="mb-6 space-y-4">
          <p className="text-base md:text-lg font-semibold text-gray-700 whitespace-pre-wrap">{currentQuestion.question_text}</p>
          {questionTextMd && (
            <div className="question-markdown text-sm md:text-base text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={markdownRehypePlugins} components={markdownComponents}>{questionTextMd}</ReactMarkdown>
            </div>
          )}
          {questionTextMermaid && (
            <MermaidDiagram chart={questionTextMermaid} />
          )}
          {/* 画像がある場合、スマホでは問題文・Markdown・Mermaidの下に表示 */}
          <div className="md:hidden">
            {layoutType === 'image' && imagesComponent}
          </div>
        </div>
        <TimerProgressBar
          durationMs={isForcedSession ? FORCED_ANSWER_TIMER_MS : QUESTION_TIMER_MS}
          isActive={quizState === 'active' && !isAnswered && !isSubmittingAnswer}
          resetToken={`${currentQuestion.id}-${questionStartedAt}-${isForcedSession ? 'forced' : 'normal'}`}
          onExpire={isForcedSession ? () => void handleAnswerSubmit(true) : undefined}
        />

        <div className="space-y-3">
          {displayedChoices.map((option: Choice, index: number) => {
            const isCorrectAnswer = option.label === currentQuestion.answer;
            const isSelectedAnswer = option.label === selectedAnswer;
            const isExcluded = excludedChoiceLabels.includes(option.label);
            let buttonClass = 'bg-gray-100 hover:bg-gray-200';
            if (isAnswered) {
              if (isCorrectAnswer) buttonClass = 'bg-success/50 border-success';
              else if (isSelectedAnswer) buttonClass = 'bg-danger/50 border-danger';
              else buttonClass = 'bg-gray-100 opacity-60';
            } else if (isExcluded) {
              buttonClass = 'bg-gray-200 text-gray-400 opacity-60';
            } else if (isSelectedAnswer) {
              buttonClass = 'bg-primary-new';
            }
            return (
              <div key={option.label} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => toggleChoiceExclusion(option.label)}
                  disabled={isAnswered}
                  aria-label={`${option.label}を除外`}
                  title={`${option.label}を除外`}
                  className={`w-6 shrink-0 rounded-md border transition-colors ${isExcluded
                    ? 'border-gray-400 bg-gray-400'
                    : 'border-gray-300 bg-white hover:bg-gray-100'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                />
                <button
                  type="button"
                  onClick={() => !isAnswered && !isExcluded && setSelectedAnswer(option.label)}
                  disabled={isAnswered || isExcluded}
                  className={`min-w-0 flex-1 text-left p-4 rounded-lg border border-transparent transition-all duration-200 text-sm md:text-base ${buttonClass}`}
                >
                  <span className="font-bold mr-2">{option.label}.</span>
                  <span className="whitespace-pre-wrap">{option.text}</span>
                </button>
              </div>
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
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4" /></svg>
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
          {!isDisposablePracticeQuestion && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void toggleReviewLater()}
                disabled={isUpdatingReviewLater}
                className={`px-4 py-2 rounded-md text-sm font-medium border shadow-sm transition-colors ${isCurrentQuestionReviewLater
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  } disabled:bg-gray-200 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed`}
              >
                {isUpdatingReviewLater ? '更新中...' : isCurrentQuestionReviewLater ? '登録済み' : '後で確認'}
              </button>
            </div>
          )}
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
      <div className="space-y-8 pb-4">
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
      <div className="md:flex md:h-screen md:flex-col md:overflow-hidden text-sm md:text-base">
        <div ref={questionTopRef} className="px-4 pb-2 pt-3 md:shrink-0 md:px-6 md:pb-2 md:pt-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap justify-end items-center gap-x-3 gap-y-1">
              {isForcedSession && (
                <div className="text-xs font-semibold text-[#e8383d] whitespace-nowrap">
                  強制モード: 80秒
                </div>
              )}
              {(() => {
                const stats = historyStats[currentQuestion.id];
                if (stats && stats.total > 0) {
                  return (
                    <div className="text-xs text-gray-500 whitespace-nowrap">
                      直近{stats.total}回 正答率: {Math.round((stats.correct / stats.total) * 100)}% ({stats.correct}/{stats.total})
                    </div>
                  );
                }
                if (Object.keys(historyStats).length > 0) {
                  return <div className="text-xs text-gray-500 whitespace-nowrap">初挑戦</div>;
                }
                return null;
              })()}
              {adhocQuizLabel && (
                <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap">
                  {adhocQuizLabel}
                </span>
              )}
              <p className="text-xs font-semibold text-slate-600">問題 {currentQuestionIndex + 1} / {questions.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm md:px-4">
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
                pb-6 md:grid md:min-h-0 md:flex-1 md:gap-6 md:pb-0
                ${layoutType === 'image' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'answered' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'default' ? 'md:grid-cols-1' : ''}
            `}>
          {/* --- Left Column --- */}
          <div className={`
                px-4 md:h-full md:min-h-0 md:overflow-y-auto md:px-0 md:pb-4 md:pl-6 md:pr-1
                ${layoutType === 'image' ? 'md:col-span-1' : ''}
                ${layoutType === 'answered' ? 'md:col-span-1' : ''}
              `}>
            {questionColumn}
          </div>

          {/* --- Right Column (PC only) --- */}
          {layoutType !== 'default' && (
            <div className={`
                  hidden md:block md:pr-6
                  ${layoutType === 'image' ? 'md:col-span-2' : ''}
                  ${layoutType === 'answered' ? 'md:col-span-2' : ''}
                  md:h-full md:min-h-0 md:overflow-y-auto
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

                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div>
                          <label className="heading-2 block text-xs font-medium text-gray-600">登録パターン</label>
                          <select
                            value={selectedSubjectPatternId}
                            onChange={(event) => applySubjectSelectionPattern(event.target.value)}
                            disabled={quizMode === 'today_remaining' || quizMode === 'worry_practice' || subjectSelectionPatterns.length === 0}
                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20 disabled:bg-gray-100 disabled:text-gray-400"
                          >
                            <option value="">パターンを選択</option>
                            {subjectSelectionPatternOptions.map((pattern) => (
                              <option key={pattern.id} value={pattern.id}>
                                {pattern.name} ({pattern.availableSubjectNames.length})
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={deleteSelectedSubjectSelectionPattern}
                          disabled={!selectedSubjectPatternId}
                          className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                        >
                          削除
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                        <input
                          type="text"
                          value={subjectPatternName}
                          onChange={(event) => setSubjectPatternName(event.target.value)}
                          disabled={quizMode === 'today_remaining' || quizMode === 'worry_practice'}
                          placeholder=""
                          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20 disabled:bg-gray-100 disabled:text-gray-400"
                        />
                        <button
                          type="button"
                          onClick={saveSubjectSelectionPattern}
                          disabled={quizMode === 'today_remaining' || quizMode === 'worry_practice' || selectedSubjectNames.length === 0}
                          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-gray-300"
                        >
                          現在の選択を登録
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div>
                          <label className="heading-2 block text-xs font-medium text-gray-600">デフォルトパターン</label>
                          <select
                            value={defaultSubjectPatternId ?? ''}
                            onChange={(event) => setDefaultSubjectPattern(event.target.value)}
                            disabled={subjectSelectionPatterns.length === 0 || isStudySettingsSaving}
                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20 disabled:bg-gray-100 disabled:text-gray-400"
                          >
                            <option value="">指定なし</option>
                            {subjectSelectionPatternOptions.map((pattern) => (
                              <option key={pattern.id} value={pattern.id}>
                                {pattern.name} ({pattern.availableSubjectNames.length})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                          {isStudySettingsSaving ? '保存中' : isStudySettingsLoading ? '読込中' : 'Azure同期'}
                        </div>
                      </div>

                      {quizMode === 'today_remaining' && (
                        <p className="mt-2 text-xs text-gray-500"></p>
                      )}
                    </div>

                  </div>

                  <div>

                    <label className="heading-2 block text-sm font-medium text-gray-700">モード</label>

                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">

                      <button type="button" onClick={() => setQuizMode('today_remaining')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'today_remaining' ? 'bg-[#e8383d] text-white' : 'bg-red-100 text-gray-700 hover:bg-red-200'}`}>今日の残り</button>

                      <button type="button" onClick={() => setQuizMode('random')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>ランダム</button>

                      <button type="button" onClick={() => setQuizMode('weak_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>苦手克服</button>

                      <button type="button" onClick={() => setQuizMode('unanswered')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>未解答問題</button>

                      <button type="button" onClick={() => setQuizMode('specific_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'specific_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>特定領域</button>

                      <button type="button" onClick={() => setQuizMode('worry_practice')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'worry_practice' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}`}>心配事</button>

                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-xs font-medium text-slate-600">
                        デフォルト: {defaultQuizMode === 'today_remaining' ? '今日の残り' : defaultQuizMode === 'random' ? 'ランダム' : defaultQuizMode === 'weak_area' ? '苦手克服' : defaultQuizMode === 'unanswered' ? '未解答問題' : defaultQuizMode === 'specific_area' ? '特定領域' : '心配事'}
                      </div>
                      <button
                        type="button"
                        onClick={setCurrentQuizModeAsDefault}
                        disabled={isStudySettingsSaving}
                        className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        現在のモードをデフォルトにする
                      </button>
                    </div>

                    {quizMode === 'today_remaining' && (
                      <div className="mt-3 rounded-lg border border-red-100 bg-red-50/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-red-800"></p>
                            <p className="mt-0.5 text-[11px] text-red-700"></p>
                          </div>
                          <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-red-800">
                            {isTodayProgressLoading ? '読込中' : `${Math.min(todayRemaining.actualDaily, todayRemaining.planDaily)} / ${todayRemaining.planDaily} 完了`}
                          </div>
                        </div>

                        <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                          {isTodayProgressLoading ? (
                            <div className="rounded-md border border-red-100 bg-white px-3 py-2 text-xs text-red-700">
                              学習予定の実績を読み込んでいます。
                            </div>
                          ) : todayRemaining.planProgress.length === 0 ? (
                            <div className="rounded-md border border-red-100 bg-white px-3 py-2 text-xs text-red-700">
                              有効な学習予定がありません。
                            </div>
                          ) : (
                            todayRemaining.planProgress.map((plan) => {
                              const completedToday = plan.isScheduledToday && plan.remaining === 0;
                              const progressPercent = plan.planDaily > 0
                                ? Math.min(100, Math.round((plan.actualDaily / plan.planDaily) * 100))
                                : 0;
                              const subjectPreview = plan.subjectNames.slice(0, 3).join('、');
                              const overflowCount = Math.max(0, plan.subjectNames.length - 3);

                              return (
                                <div key={plan.planId} className="rounded-md border border-red-100 bg-white px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-slate-800" title={plan.title}>{plan.title}</div>
                                      {/* <div className="mt-0.5 truncate text-[11px] text-slate-500" title={plan.subjectNames.join('、')}>
                                        {subjectPreview || '科目未設定'}{overflowCount > 0 ? ` ほか${overflowCount}` : ''}
                                      </div> */}
                                    </div>

                                    <div className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${!plan.isScheduledToday
                                      ? 'bg-slate-100 text-slate-500'
                                      : completedToday
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-red-100 text-red-700'
                                      }`}>
                                      {!plan.isScheduledToday ? '今日は対象外' : completedToday ? '完了' : `残り${plan.remaining}問`}
                                    </div>

                                  </div>
                                  <div className="mt-2 flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                      <div
                                        className={`h-full rounded-full ${completedToday ? 'bg-emerald-500' : 'bg-red-500'}`}
                                        style={{ width: `${progressPercent}%` }}
                                      />
                                    </div>
                                    <div className="w-16 text-right text-[11px] font-medium text-slate-600">
                                      {plan.isScheduledToday ? `${Math.min(plan.actualDaily, plan.planDaily)} / ${plan.planDaily}` : '-'}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                  </div>

                  <div>
                    <label className="heading-2 block text-sm font-medium text-gray-700">計算問題</label>
                    <select
                      value={questionTagFilter}
                      onChange={(event) => setQuestionTagFilter(event.target.value as QuestionTagFilter)}
                      className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20"
                    >
                      <option value="all">すべて出題</option>
                      <option value="calculation_only">計算問題のみ</option>
                      <option value="exclude_calculation">計算問題を除外</option>
                    </select>
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
                            <span className="text-slate-500"></span>
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
                                className={`rounded-md border px-3 py-2 text-xs ${isCompleted
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

                  {quizMode === 'worry_practice' && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-4">
                      <div className="flex flex-col gap-1">
                        <label className="heading-2 block text-sm font-semibold text-amber-950">心配事・出題してほしい論点</label>
                        <div className="text-xs text-amber-800">生成ごとに入力内容と問題セットを保存版として残します。同じ入力から再生成すると v2, v3 として管理します。</div>
                        <div className="text-xs text-amber-800">科目（問題json）を選択すると、その問題を参考情報として類題を生成します。未選択の場合は入力内容のみから生成します。</div>
                      </div>
                      <textarea
                        value={worryPracticeInput}
                        onChange={(event) => setWorryPracticeInput(event.target.value)}
                        rows={6}
                        className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                      {isLoading && quizMode === 'worry_practice' && (
                        <div className="rounded-lg border border-amber-200 bg-white px-3 py-3">
                          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-amber-900">
                            <span>AI問題生成中</span>
                            <span>{WORRY_PRACTICE_GENERATION_STEPS[worryPracticeGenerationStep]}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100">
                            <div
                              className="h-full rounded-full bg-amber-500 transition-all duration-300"
                              style={{ width: `${((worryPracticeGenerationStep + 1) / WORRY_PRACTICE_GENERATION_STEPS.length) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800">
                        <span>
                          科目: 心配事演習 / モード: 心配事
                          {selectedSubjectNames.length > 0 && ` / 参考問題: ${selectedSubjectNames.join(', ')}`}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void fetchWorryPracticeVersions()}
                            disabled={isWorryPracticeVersionsLoading}
                            className="rounded-md border border-amber-200 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {isWorryPracticeVersionsLoading ? '更新中' : '保存版を更新'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setWorryPracticeInput('')}
                            disabled={!worryPracticeInput}
                            className="rounded-md border border-amber-200 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                          >
                            入力をクリア
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-white/80 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-amber-950">保存版</div>
                          <div className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{worryPracticeVersions.length}件</div>
                        </div>
                        {isWorryPracticeVersionsLoading ? (
                          <p className="mt-3 text-xs text-amber-800">保存版を読み込んでいます。</p>
                        ) : worryPracticeVersions.length === 0 ? (
                          <p className="mt-3 text-xs text-amber-800">まだ保存版はありません。演習を開始すると自動で保存されます。</p>
                        ) : (
                          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                            {worryPracticeVersions.map((version) => (
                              <div key={version.id} className="rounded-md border border-amber-100 bg-white px-3 py-2">
                                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">v{version.version}</span>
                                      <span className="truncate text-sm font-semibold text-slate-800">{version.title}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {version.question_count}問 / {new Date(version.created_at).toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void startWorryPracticeVersion(version.id)}
                                      disabled={isWorryPracticeVersionStarting || isLoading}
                                      className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:bg-gray-300"
                                    >
                                      この版で再演習
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setWorryPracticeInput(version.concern_text)}
                                      className="rounded-md border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50"
                                    >
                                      入力へ戻す
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void deleteWorryPracticeVersion(version.id)}
                                      disabled={deletingWorryPracticeVersionId === version.id}
                                      className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      {deletingWorryPracticeVersionId === version.id ? '削除中' : '削除'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div>

                    <label className="heading-2 block text-sm font-medium text-gray-700">問題数</label>

                    <div className="mt-2 text-sm text-gray-500 mb-2">

                      {quizMode === 'today_remaining' && (isTodayProgressLoading
                        ? '(学習予定の実績を読み込み中...)'
                        : `(今日の残り: ${todayRemaining.count} 問 / 今日 ${Math.min(todayRemaining.actualDaily, todayRemaining.planDaily)} / ${todayRemaining.planDaily} 完了 / 2分/問で約${estimatedCompletionText})`
                      )}
                      {quizMode === 'today_remaining' && todayRemainingPaceHint && (
                        <div className="mt-1 text-xs font-medium text-[#e8383d]">{todayRemainingPaceHint}</div>
                      )}

                      {quizMode === 'unanswered' && unansweredCount !== null && `(未解答: ${unansweredCount} 問)`}

                      {quizMode === 'weak_area' && weakAreaCount !== null && `(苦手問題: ${weakAreaCount} 問)`}

                      {quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length === 0 && '(キーワードを1つ以上入力してください)'}

                      {quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length > 0 && !isSpecificAreaCountLoading && hasSpecificAreaInvestigationResult && specificAreaCount !== null && `(対象問題数: ${specificAreaCount} 問)`}

                      {quizMode === 'specific_area' && isSpecificAreaCountLoading && '(対象選定中...)'}

                      {quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length > 0 && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && '(対象問題を調査してください)'}

                      {quizMode === 'worry_practice' && '(入力内容から保存版問題を生成)'}

                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-3">

                      {[1, 5, 10, 20].map((optionValue) => {

                        const isDisabled = (quizMode === 'today_remaining' && optionValue > todayRemaining.count) ||

                          (quizMode === 'unanswered' && unansweredCount !== null && optionValue > unansweredCount) ||

                          (quizMode === 'weak_area' && weakAreaCount !== null && optionValue > weakAreaCount) ||

                          (quizMode === 'specific_area' && specificAreaCount !== null && optionValue > specificAreaCount) ||

                          optionValue <= 0;



                        return (

                          <button

                            key={optionValue}

                            type="button"

                            onClick={() => setNumQuestions(optionValue)}

                            disabled={isDisabled}

                            className={`px-2 py-2 rounded-md text-sm font-medium transition-colors ${numQuestions === optionValue && !isDisabled

                              ? 'bg-primary-new text-white'

                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'

                              }`}

                          >

                            {optionValue}

                          </button>

                        );

                      })}

                    </div>

                  </div>

                </form>

                <div className="mt-6">

                  <button type="button" onClick={() => void startQuiz()} disabled={isLoading || effectiveSelectedSubjectNames.length === 0 || (quizMode === 'today_remaining' && isTodayProgressLoading)} className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-new">

                    {isLoading ? <LoaderIcon className="w-5 h-5" /> : null}

                    {isLoading ? 'クイズ準備中...' : 'Start'}

                  </button>
                  <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">モード表示設定</summary>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {STUDY_ACTION_MODE_OPTIONS.map((option) => (
                        <label key={option.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm text-slate-700">
                          <span>{option.label}</span>
                          <input
                            type="checkbox"
                            checked={isStudyActionModeVisible(option.id)}
                            onChange={(event) => setStudyActionModeVisible(option.id, event.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-new focus:ring-primary-new"
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  {(isStudyActionModeVisible('ipad_air') || isStudyActionModeVisible('ipad_mini') || isStudyActionModeVisible('paper_practice')) && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {isStudyActionModeVisible('ipad_air') && (
                        <button
                          type="button"
                          onClick={() => openIpadMode('air')}
                          disabled={isLoading || effectiveSelectedSubjectNames.length === 0 || quizMode === 'specific_area' || quizMode === 'worry_practice' || (quizMode === 'today_remaining' && isTodayProgressLoading)}
                          className="w-full py-3 px-4 border border-cyan-600 rounded-md shadow-sm text-base font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          iPad Airモード
                        </button>
                      )}
                      {isStudyActionModeVisible('ipad_mini') && (
                        <button
                          type="button"
                          onClick={() => openIpadMode('mini')}
                          disabled={isLoading || effectiveSelectedSubjectNames.length === 0 || quizMode === 'specific_area' || quizMode === 'worry_practice' || (quizMode === 'today_remaining' && isTodayProgressLoading)}
                          className="w-full py-3 px-4 border border-sky-600 rounded-md shadow-sm text-base font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          iPad miniモード
                        </button>
                      )}
                      {isStudyActionModeVisible('paper_practice') && (
                        <button
                          type="button"
                          onClick={openPaperPracticeMode}
                          disabled={isLoading || effectiveSelectedSubjectNames.length === 0 || quizMode === 'worry_practice' || (quizMode === 'today_remaining' && isTodayProgressLoading)}
                          className="w-full py-3 px-4 border border-slate-700 rounded-md shadow-sm text-base font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          紙演習モード
                        </button>
                      )}
                    </div>
                  )}
                  {isStudyActionModeVisible('forced') && (
                    <button
                      type="button"
                      onClick={() => void startQuiz(true)}
                      disabled={isLoading || effectiveSelectedSubjectNames.length === 0 || quizMode === 'worry_practice' || (quizMode === 'today_remaining' && isTodayProgressLoading)}
                      className="mt-3 w-full py-3 px-4 border border-[#e8383d] rounded-md shadow-sm text-base font-medium text-[#e8383d] bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      強制モード
                    </button>
                  )}

                </div>

                {(error || plansError || studySettingsError) && <p className="text-danger text-sm mt-2 text-center">{error || plansError || studySettingsError}</p>}

              </div>

              <SubjectProgress selectedSubjectNames={quizMode === 'worry_practice' ? effectiveSelectedSubjectNames : selectedSubjectNames} quizMode={quizMode} />

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

                <textarea name="question_text" value={editingProblem.question_text} onChange={handleProblemFormChange} rows={4} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" />

              </div>

              {/* 選択肢 */}

              <div>

                <label className="block text-sm font-medium text-gray-700">選択肢</label>

                <div className="space-y-2 mt-1">

                  {editingProblem.choices.map((choice, index) => (

                    <div key={index} className="flex items-center gap-2">

                      <input type="text" value={choice.label} onChange={(e) => handleProblemChoiceChange(index, 'label', e.target.value)} className="w-16 shadow-sm sm:text-sm border-gray-300 rounded-md" />

                      <input type="text" value={choice.text} onChange={(e) => handleProblemChoiceChange(index, 'text', e.target.value)} className="flex-grow shadow-sm sm:text-sm border-gray-300 rounded-md" />

                    </div>

                  ))}

                </div>

              </div>

              {/* 正解 */}

              <div>

                <label className="block text-sm font-medium text-gray-700">正解の選択肢ラベル</label>

                <input type="text" name="answer" value={editingProblem.answer} onChange={handleProblemFormChange} className="mt-1 w-32 block shadow-sm sm:text-sm border-gray-300 rounded-md" />

              </div>

              {/* カテゴリ */}

              <div>

                <label className="heading-2 block text-sm font-medium text-gray-700">カテゴリ</label>

                <input type="text" name="category" value={editingProblem.category || ''} onChange={handleProblemFormChange} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" />

              </div>

              {/* 解説 */}

              <div>

                <label className="heading-2 block text-sm font-medium text-gray-700">解説</label>

                <textarea name="explanation.text" value={editingProblem.explanation.text} onChange={handleProblemFormChange} rows={6} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" />

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
