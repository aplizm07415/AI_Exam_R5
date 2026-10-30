import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import mplusRegularFontUrl from './assets/fonts/MPLUS1p-Regular.ttf';

const API_BASE_URL = '/api';
const ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY = 'adhocQuizHistoryMode';
const SIMILAR_PRACTICE_HISTORY_MODE = 'similar_practice';

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
  first_missed_answered_at?: string;
}

interface ReviewLaterEntry {
  subject: string;
  problem_id: string;
  created_at: string;
  updated_at: string;
  question: QuizQuestion | null;
  error?: string | null;
}

interface SubjectProblem extends QuizQuestion {}

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

interface BulkReorganizeResult {
  subject: string;
  total: number;
  updated: number;
  failed: number;
  skipped: number;
  items: Array<{
    subject: string;
    problem_id: string;
    updated: boolean;
    used_ai: boolean;
    skipped?: boolean;
    consistency_notes?: string[];
    error?: string | null;
  }>;
}

type BulkReorganizeStatus = 'queued' | 'running' | 'completed' | 'failed';

interface BulkReorganizeSubjectProgress {
  subject: string;
  status: BulkReorganizeStatus;
  total: number;
  processed: number;
  updated: number;
  failed: number;
  skipped: number;
  current_problem_id?: string | null;
  error?: string | null;
  items: BulkReorganizeResult['items'];
}

interface BulkReorganizeJobStatus {
  job_id: string;
  status: BulkReorganizeStatus;
  total_subjects: number;
  completed_subjects: number;
  total_problems: number;
  processed_problems: number;
  updated: number;
  failed: number;
  skipped: number;
  max_parallel_subjects: number;
  started_at: string;
  completed_at?: string | null;
  subjects: BulkReorganizeSubjectProgress[];
}

interface QuestionTextMdDedupeItem {
  subject: string;
  problem_id: string;
  updated: boolean;
  duplicates_removed: number;
  before_length: number;
  after_length: number;
  error?: string | null;
}

interface QuestionTextMdDedupeSubjectResult {
  subject: string;
  total: number;
  updated: number;
  failed: number;
  duplicates_removed: number;
  items: QuestionTextMdDedupeItem[];
}

interface QuestionTextMdDedupeResult {
  total_subjects: number;
  total: number;
  updated: number;
  failed: number;
  duplicates_removed: number;
  subjects: QuestionTextMdDedupeSubjectResult[];
}

type IpadProfile = 'air' | 'mini';

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

const PDF_FONT_FILE_NAME = 'MPLUS1p-Regular.ttf';
const PDF_FONT_NAME = 'MPLUS1p';

let pdfFontBinaryStringPromise: Promise<string> | null = null;

function arrayBufferToBinaryString(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return binary;
}

function loadPdfFontBinaryString() {
  if (!pdfFontBinaryStringPromise) {
    pdfFontBinaryStringPromise = fetch(mplusRegularFontUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error('PDF用フォントの取得に失敗しました。');
        }
        return response.arrayBuffer();
      })
      .then(arrayBufferToBinaryString);
  }

  return pdfFontBinaryStringPromise;
}

function normalizePdfText(value: string | undefined | null) {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

export default function ReviewLaterPage() {
  const navigate = useNavigate();
  const subjectProblemsCacheRef = useRef<Record<string, SubjectProblem[]>>({});
  const firstMissedCacheRef = useRef<Record<string, { ids: string[]; dates: Record<string, string> }>>({});
  const [items, setItems] = useState<ReviewLaterEntry[]>([]);
  const [subjectNames, setSubjectNames] = useState<string[]>([]);
  const [selectedSubjectName, setSelectedSubjectName] = useState('');
  const [loadedSubjectProblemName, setLoadedSubjectProblemName] = useState('');
  const [subjectProblems, setSubjectProblems] = useState<SubjectProblem[]>([]);
  const [isLoadingSubjectProblems, setIsLoadingSubjectProblems] = useState(false);
  const [sortMode, setSortMode] = useState<'default' | 'first_missed'>('default');
  const [firstMissedIds, setFirstMissedIds] = useState<Set<string>>(new Set());
  const [firstMissedDateById, setFirstMissedDateById] = useState<Record<string, string>>({});
  const [firstMissedDateFrom, setFirstMissedDateFrom] = useState('');
  const [firstMissedDateTo, setFirstMissedDateTo] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [editingProblem, setEditingProblem] = useState<QuizQuestion | null>(null);
  const [customExplanationText, setCustomExplanationText] = useState('');
  const [showStructuredQuestionFields, setShowStructuredQuestionFields] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProblem, setIsSavingProblem] = useState(false);
  const [isSavingMemo, setIsSavingMemo] = useState(false);
  const [isRegisteringHistory, setIsRegisteringHistory] = useState(false);
  const [isReorganizingExplanation, setIsReorganizingExplanation] = useState(false);
  const [isBulkReorganizingSubject, setIsBulkReorganizingSubject] = useState(false);
  const [bulkReorganizeResult, setBulkReorganizeResult] = useState<BulkReorganizeResult | null>(null);
  const [bulkReorganizeJob, setBulkReorganizeJob] = useState<BulkReorganizeJobStatus | null>(null);
  const [bulkReorganizeSubjectNames, setBulkReorganizeSubjectNames] = useState<string[]>([]);
  const [maxParallelReorganizeSubjects, setMaxParallelReorganizeSubjects] = useState(2);
  const [isCheckingQuestionTextMdDuplicates, setIsCheckingQuestionTextMdDuplicates] = useState(false);
  const [questionTextMdDedupeResult, setQuestionTextMdDedupeResult] = useState<QuestionTextMdDedupeResult | null>(null);
  const [aiExplanationReview, setAiExplanationReview] = useState<{ notes: string[]; usedAi: boolean } | null>(null);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [isBulkRegisteringFirstMissed, setIsBulkRegisteringFirstMissed] = useState(false);
  const [similarTopics, setSimilarTopics] = useState<string[]>([]);
  const [isOralVivaActive, setIsOralVivaActive] = useState(false);
  const [oralVivaStepIndex, setOralVivaStepIndex] = useState(0);
  const [oralVivaMessages, setOralVivaMessages] = useState<OralVivaMessage[]>([]);
  const [oralVivaInput, setOralVivaInput] = useState('');
  const [oralVivaScores, setOralVivaScores] = useState<OralVivaScores>({ logicality: 0, specificity: 0, reproducibility: 0 });
  const [oralVivaResult, setOralVivaResult] = useState<{
    improvementPoints: string[];
    miniQuizQuestion: string;
    miniQuizAnswer: string;
  } | null>(null);
  const [isOralVivaLoading, setIsOralVivaLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfExportProgress, setPdfExportProgress] = useState('');
  const [error, setError] = useState('');
  const oralVivaSteps: OralVivaStep[] = ['root', 'refute', 'apply', 'summary'];
  const oralVivaStepLabels: Record<OralVivaStep, string> = { root: '根拠', refute: '反証', apply: '応用', summary: '要約' };

  const fetchItems = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/review-later`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '後で確認一覧の取得に失敗しました。');
      }
      const data: ReviewLaterEntry[] = await response.json();
      setItems(data);
      setSelectedKey((prev) => {
        if (prev && data.some((item) => `${item.subject}::${item.problem_id}` === prev)) {
          return prev;
        }
        const first = data[0];
        return first ? `${first.subject}::${first.problem_id}` : '';
      });
    } catch (fetchError) {
      console.error(fetchError);
      setError(fetchError instanceof Error ? fetchError.message : '後で確認一覧の取得に失敗しました。');
      setItems([]);
      setSelectedKey('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  useEffect(() => {
    const fetchSubjects = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/subjects`);
        if (!response.ok) {
          throw new Error('科目一覧の取得に失敗しました。');
        }
        const names: string[] = await response.json();
        const filtered = names
          .filter((name) =>
            name.endsWith('.json') &&
            !name.includes('/') &&
            name !== 'plans.json' &&
            !name.startsWith('history/') &&
            !name.startsWith('custom-explanations/') &&
            !name.startsWith('soragaki/') &&
            !name.startsWith('review-later/')
          )
          .sort((a, b) => a.localeCompare(b));
        setSubjectNames(filtered);
        setSelectedSubjectName((prev) => prev || filtered[0] || '');
      } catch (fetchError) {
        console.error(fetchError);
      }
    };
    void fetchSubjects();
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => `${item.subject}::${item.problem_id}` === selectedKey) ?? null,
    [items, selectedKey]
  );
  const isSelectedSubjectProblemListLoaded =
    selectedSubjectName !== '' && loadedSubjectProblemName === selectedSubjectName;
  const questionSupplementImageUrls = editingProblem
    ? getCustomImageUrls(editingProblem.custom_question_image_data_urls, editingProblem.custom_question_image_data_url)
    : [];
  const explanationSupplementImageUrls = editingProblem
    ? getCustomImageUrls(editingProblem.custom_explanation_image_data_urls, editingProblem.custom_explanation_image_data_url)
    : [];

  const selectedProblem = useMemo(() => {
    if (selectedItem?.question) {
      return selectedItem.question;
    }
    if (!isSelectedSubjectProblemListLoaded) {
      return null;
    }
    return subjectProblems.find((problem) => `${problem.subject}::${problem.id}` === selectedKey) ?? null;
  }, [isSelectedSubjectProblemListLoaded, selectedItem, subjectProblems, selectedKey]);

  const reviewLaterKeySet = useMemo(
    () => new Set(items.map((item) => `${item.subject}::${item.problem_id}`)),
    [items]
  );
  const bulkReorganizeSubjectNameSet = useMemo(
    () => new Set(bulkReorganizeSubjectNames),
    [bulkReorganizeSubjectNames]
  );
  const bulkReorganizeProgressPercent = useMemo(() => {
    if (!bulkReorganizeJob || bulkReorganizeJob.total_problems <= 0) {
      return bulkReorganizeJob && bulkReorganizeJob.total_subjects > 0
        ? Math.round((bulkReorganizeJob.completed_subjects / bulkReorganizeJob.total_subjects) * 100)
        : 0;
    }
    return Math.round((bulkReorganizeJob.processed_problems / bulkReorganizeJob.total_problems) * 100);
  }, [bulkReorganizeJob]);
  const isBulkQuestionOperationRunning = isBulkReorganizingSubject || isCheckingQuestionTextMdDuplicates;

  const removeReviewLaterEntryLocally = (subject: string, problemId: string) => {
    const targetKey = `${subject}::${problemId}`;
    setItems((prev) => {
      const next = prev.filter((item) => `${item.subject}::${item.problem_id}` !== targetKey);
      setSelectedKey((currentKey) => {
        if (currentKey !== targetKey) {
          return currentKey && next.some((item) => `${item.subject}::${item.problem_id}` === currentKey)
            ? currentKey
            : (next[0] ? `${next[0].subject}::${next[0].problem_id}` : '');
        }
        return next[0] ? `${next[0].subject}::${next[0].problem_id}` : '';
      });
      return next;
    });
  };

  const sortedSubjectProblems = useMemo(() => {
    if (!isSelectedSubjectProblemListLoaded) {
      return [];
    }
    const filtered = subjectProblems.filter((problem) => {
      if (!firstMissedDateFrom && !firstMissedDateTo) {
        return true;
      }
      const firstMissedAt = firstMissedDateById[problem.id];
      if (!firstMissedAt) {
        return false;
      }
      const localDate = firstMissedAt.slice(0, 10);
      if (firstMissedDateFrom && localDate < firstMissedDateFrom) {
        return false;
      }
      if (firstMissedDateTo && localDate > firstMissedDateTo) {
        return false;
      }
      return true;
    });
    const next = [...filtered];
    if (sortMode === 'first_missed') {
      next.sort((a, b) => {
        const aFirstMissed = firstMissedIds.has(a.id) ? 1 : 0;
        const bFirstMissed = firstMissedIds.has(b.id) ? 1 : 0;
        if (aFirstMissed !== bFirstMissed) {
          return bFirstMissed - aFirstMissed;
        }
        return a.id.localeCompare(b.id);
      });
      return next;
    }
    return next.sort((a, b) => a.id.localeCompare(b.id));
  }, [isSelectedSubjectProblemListLoaded, subjectProblems, sortMode, firstMissedIds, firstMissedDateById, firstMissedDateFrom, firstMissedDateTo]);
  const unregisteredFirstMissedProblems = useMemo(
    () => sortedSubjectProblems.filter((problem) => firstMissedIds.has(problem.id) && !reviewLaterKeySet.has(`${problem.subject}::${problem.id}`)),
    [sortedSubjectProblems, firstMissedIds, reviewLaterKeySet]
  );

  useEffect(() => {
    if (subjectNames.length === 0) {
      return;
    }
    setSelectedSubjectName((prev) => {
      if (prev && subjectNames.includes(prev)) {
        return prev;
      }
      return selectedItem?.subject && subjectNames.includes(selectedItem.subject)
        ? selectedItem.subject
        : subjectNames[0] || '';
    });
  }, [selectedItem?.subject, subjectNames]);

  useEffect(() => {
    setBulkReorganizeSubjectNames((prev) => {
      const available = new Set(subjectNames);
      const next = prev.filter((subjectName) => available.has(subjectName));
      if (next.length > 0) {
        return next;
      }
      return selectedSubjectName && available.has(selectedSubjectName) ? [selectedSubjectName] : [];
    });
  }, [selectedSubjectName, subjectNames]);

  useEffect(() => {
    if (selectedProblem) {
      setEditingProblem({ ...selectedProblem });
      setCustomExplanationText(selectedProblem.custom_explanation || '');
    } else {
      setEditingProblem(null);
      setCustomExplanationText('');
    }
    setIsOralVivaActive(false);
    setAiExplanationReview(null);
    setShowStructuredQuestionFields(false);
    setOralVivaStepIndex(0);
    setOralVivaMessages([]);
    setOralVivaInput('');
    setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
    setOralVivaResult(null);
    setIsOralVivaLoading(false);
  }, [selectedProblem]);

  const loadSubjectProblems = async (subjectName = selectedSubjectName, force = false) => {
    if (!subjectName || isLoadingSubjectProblems) {
      return;
    }
    const cachedProblems = subjectProblemsCacheRef.current[subjectName];
    const cachedFirstMissed = firstMissedCacheRef.current[subjectName];
    if (!force && cachedProblems && cachedFirstMissed) {
      setSubjectProblems(cachedProblems);
      setFirstMissedIds(new Set(cachedFirstMissed.ids));
      setFirstMissedDateById(cachedFirstMissed.dates);
      setLoadedSubjectProblemName(subjectName);
      return;
    }
    setIsLoadingSubjectProblems(true);
    setError('');
    try {
      const [problemsResponse, firstMissedResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/subjects/${encodeURIComponent(subjectName)}/problems`),
        fetch(`${API_BASE_URL}/analytics/export/first-missed-problems?subjects=${encodeURIComponent(subjectName)}`),
      ]);
      if (!problemsResponse.ok) {
        const payload = await problemsResponse.json().catch(() => null);
        throw new Error(payload?.detail || '科目問題一覧の取得に失敗しました。');
      }
      const problems: SubjectProblem[] = await problemsResponse.json();
      subjectProblemsCacheRef.current[subjectName] = problems;
      setSubjectProblems(problems);
      if (firstMissedResponse.ok) {
        const payload: { questions?: QuizQuestion[] } = await firstMissedResponse.json();
        const firstMissedQuestions = payload.questions || [];
        const ids = firstMissedQuestions.map((question) => question.id);
        const dates = Object.fromEntries(
          firstMissedQuestions
            .filter((question) => question.first_missed_answered_at)
            .map((question) => [question.id, question.first_missed_answered_at as string])
        );
        firstMissedCacheRef.current[subjectName] = { ids, dates };
        setFirstMissedIds(new Set(ids));
        setFirstMissedDateById(dates);
      } else {
        firstMissedCacheRef.current[subjectName] = { ids: [], dates: {} };
        setFirstMissedIds(new Set());
        setFirstMissedDateById({});
      }
      setLoadedSubjectProblemName(subjectName);
    } catch (fetchError) {
      console.error(fetchError);
      setError(fetchError instanceof Error ? fetchError.message : '科目問題一覧の取得に失敗しました。');
      setLoadedSubjectProblemName('');
      setSubjectProblems([]);
      setFirstMissedIds(new Set());
      setFirstMissedDateById({});
    } finally {
      setIsLoadingSubjectProblems(false);
    }
  };

  const handleProblemChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!editingProblem) return;
    const { name, value } = event.target;
    if (name.startsWith('explanation.')) {
      const key = name.split('.')[1] as keyof Explanation;
      setEditingProblem({
        ...editingProblem,
        explanation: {
          ...editingProblem.explanation,
          [key]: value,
        },
      });
      return;
    }
    setEditingProblem({ ...editingProblem, [name]: value });
  };

  const handleChoiceChange = (index: number, field: 'label' | 'text', value: string) => {
    if (!editingProblem) return;
    const nextChoices = [...editingProblem.choices];
    const currentChoice = nextChoices[index];
    if (!currentChoice) return;
    nextChoices[index] = {
      label: field === 'label' ? value : currentChoice.label,
      text: field === 'text' ? value : currentChoice.text,
    };
    setEditingProblem({ ...editingProblem, choices: nextChoices });
  };

  const saveProblemData = async () => {
    if (!editingProblem) return;
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
    const response = await fetch(
      `${API_BASE_URL}/subjects/${encodeURIComponent(editingProblem.subject)}/problems/${encodeURIComponent(editingProblem.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail || '問題の更新に失敗しました。');
    }
    const updatedProblem: QuizQuestion = await response.json();
    subjectProblemsCacheRef.current[updatedProblem.subject] = (
      subjectProblemsCacheRef.current[updatedProblem.subject] ?? []
    ).map((problem) => (
      problem.id === updatedProblem.id ? { ...problem, ...updatedProblem } : problem
    ));
    setItems((prev) =>
      prev.map((item) =>
        item.subject === updatedProblem.subject && item.problem_id === updatedProblem.id
          ? { ...item, question: { ...item.question, ...updatedProblem } as QuizQuestion }
          : item
      )
    );
    setEditingProblem((prev) => (prev ? { ...prev, ...updatedProblem } : prev));
  };

  const saveMemoData = async () => {
    if (!editingProblem) return;
    const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: customExplanationText,
        explanation_image_data_urls: explanationSupplementImageUrls,
        question_image_data_urls: questionSupplementImageUrls,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
    }
    subjectProblemsCacheRef.current[editingProblem.subject] = (
      subjectProblemsCacheRef.current[editingProblem.subject] ?? []
    ).map((problem) => (
      problem.id === editingProblem.id
        ? {
            ...problem,
            custom_explanation: customExplanationText,
            custom_explanation_image_data_urls: explanationSupplementImageUrls,
            custom_question_image_data_urls: questionSupplementImageUrls,
            custom_explanation_image_data_url: explanationSupplementImageUrls[0],
            custom_question_image_data_url: questionSupplementImageUrls[0],
          }
        : problem
    ));
    setItems((prev) =>
      prev.map((item) =>
        item.subject === editingProblem.subject && item.problem_id === editingProblem.id && item.question
          ? {
              ...item,
              question: {
                ...item.question,
                custom_explanation: customExplanationText,
                custom_explanation_image_data_urls: explanationSupplementImageUrls,
                custom_question_image_data_urls: questionSupplementImageUrls,
                custom_explanation_image_data_url: explanationSupplementImageUrls[0],
                custom_question_image_data_url: questionSupplementImageUrls[0],
              },
            }
          : item
      )
    );
    setEditingProblem((prev) =>
      prev
        ? {
            ...prev,
            custom_explanation: customExplanationText,
            custom_explanation_image_data_urls: explanationSupplementImageUrls,
            custom_question_image_data_urls: questionSupplementImageUrls,
            custom_explanation_image_data_url: explanationSupplementImageUrls[0],
            custom_question_image_data_url: questionSupplementImageUrls[0],
          }
        : prev
    );
  };

  const handleSaveAll = async () => {
    if (!editingProblem || isSavingProblem || isSavingMemo) return;
    setError('');
    setIsSavingProblem(true);
    setIsSavingMemo(true);
    try {
      await saveProblemData();
      await saveMemoData();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : '保存に失敗しました。');
    } finally {
      setIsSavingProblem(false);
      setIsSavingMemo(false);
    }
  };

  const handleSaveProblem = async () => {
    await handleSaveAll();
  };

  const handleSaveMemo = async () => {
    await handleSaveAll();
  };

  const saveMemoText = async (text: string) => {
    if (!editingProblem) return;
    const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        explanation_image_data_urls: explanationSupplementImageUrls,
        question_image_data_urls: questionSupplementImageUrls,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
    }
  };

  const reorganizeExplanationWithAi = async () => {
    if (!editingProblem || isReorganizingExplanation) return;
    try {
      setIsReorganizingExplanation(true);
      setAiExplanationReview(null);
      setError('');
      const response = await fetch(
        `${API_BASE_URL}/review-later/${encodeURIComponent(editingProblem.subject)}/${encodeURIComponent(editingProblem.id)}/reorganize-explanation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: editingProblem }),
        }
      );
      const payload: {
        reorganized_explanation?: string;
        reorganized_question_text_md?: string | null;
        consistency_notes?: string[];
        used_ai?: boolean;
        detail?: string;
      } = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'AI整理に失敗しました。');
      }
      const nextExplanation = (payload.reorganized_explanation || '').trim();
      if (!nextExplanation) {
        throw new Error('AI整理結果が空でした。');
      }
      const nextQuestionTextMd = payload.reorganized_question_text_md?.trim();
      setEditingProblem((prev) => prev ? {
        ...prev,
        ...(nextQuestionTextMd ? { question_text_md: nextQuestionTextMd } : {}),
        explanation: {
          ...prev.explanation,
          text: nextExplanation,
        },
      } : prev);
      setAiExplanationReview({
        notes: Array.isArray(payload.consistency_notes) ? payload.consistency_notes : [],
        usedAi: Boolean(payload.used_ai),
      });
    } catch (organizeError) {
      console.error(organizeError);
      setError(organizeError instanceof Error ? organizeError.message : 'AI整理に失敗しました。');
    } finally {
      setIsReorganizingExplanation(false);
    }
  };

  const startOralViva = async () => {
    if (!editingProblem || isOralVivaLoading) return;
    setIsOralVivaLoading(true);
    setError('');
    setIsOralVivaActive(true);
    setOralVivaStepIndex(0);
    setOralVivaMessages([]);
    setOralVivaResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'root',
          question: {
            problem_id: editingProblem.id,
            question_text: editingProblem.question_text,
            explanation_text: editingProblem.explanation.text || '',
            correct_answer: editingProblem.answer,
            selected_answer: null,
            was_correct: null,
          },
          conversation: [],
          user_message: '',
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || '口頭試問の開始に失敗しました。');
      }
      const payload: OralVivaResponse = await res.json();
      setOralVivaMessages([{ role: 'assistant', content: payload.assistant_message }]);
      setOralVivaScores(payload.scores);
    } catch (e) {
      setError(e instanceof Error ? e.message : '口頭試問の開始に失敗しました。');
      setIsOralVivaActive(false);
    } finally {
      setIsOralVivaLoading(false);
    }
  };

  const submitOralViva = async () => {
    if (!editingProblem || !isOralVivaActive || isOralVivaLoading) return;
    const message = oralVivaInput.trim();
    if (!message) return;
    const step = oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)] as OralVivaStep;
    const userTurn: OralVivaMessage = { role: 'user', content: message };
    setOralVivaInput('');
    setOralVivaMessages((prev) => [...prev, userTurn]);
    setIsOralVivaLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          question: {
            problem_id: editingProblem.id,
            question_text: editingProblem.question_text,
            explanation_text: editingProblem.explanation.text || '',
            correct_answer: editingProblem.answer,
            selected_answer: null,
            was_correct: null,
          },
          conversation: [...oralVivaMessages, userTurn],
          user_message: message,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || '口頭試問の送信に失敗しました。');
      }
      const payload: OralVivaResponse = await res.json();
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
          await saveMemoText(appended);
        }
      } else {
        setOralVivaStepIndex((prev) => Math.min(prev + 1, oralVivaSteps.length - 1));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '口頭試問の送信に失敗しました。');
    } finally {
      setIsOralVivaLoading(false);
    }
  };

  const skipToSummary = async () => {
    if (!editingProblem || !isOralVivaActive || isOralVivaLoading) return;
    const userTurn: OralVivaMessage = { role: 'user', content: 'ここまでの内容を要約して終了してください。' };
    setOralVivaStepIndex(oralVivaSteps.length - 1);
    setOralVivaMessages((prev) => [...prev, userTurn]);
    setIsOralVivaLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'summary',
          question: {
            problem_id: editingProblem.id,
            question_text: editingProblem.question_text,
            explanation_text: editingProblem.explanation.text || '',
            correct_answer: editingProblem.answer,
            selected_answer: null,
            was_correct: null,
          },
          conversation: [...oralVivaMessages, userTurn],
          user_message: userTurn.content,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || '要約生成に失敗しました。');
      }
      const payload: OralVivaResponse = await res.json();
      setOralVivaMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
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
        await saveMemoText(appended);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '要約生成に失敗しました。');
    } finally {
      setIsOralVivaLoading(false);
    }
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
          return;
        }
        reject(new Error('画像の読み込みに失敗しました。'));
      };
      reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
      reader.readAsDataURL(file);
    });

  const handleCustomImageUpload = async (kind: 'question' | 'explanation', files?: FileList | null) => {
    if (!editingProblem || !files || files.length === 0) return;
    try {
      const dataUrls = await Promise.all(Array.from(files).map((file) => readFileAsDataUrl(file)));
      if (kind === 'question') {
        setEditingProblem((prev) => {
          if (!prev) return prev;
          const nextUrls = [...getCustomImageUrls(prev.custom_question_image_data_urls, prev.custom_question_image_data_url), ...dataUrls];
          return {
            ...prev,
            custom_question_image_data_urls: nextUrls,
            custom_question_image_data_url: nextUrls[0],
          };
        });
      } else {
        setEditingProblem((prev) => {
          if (!prev) return prev;
          const nextUrls = [...getCustomImageUrls(prev.custom_explanation_image_data_urls, prev.custom_explanation_image_data_url), ...dataUrls];
          return {
            ...prev,
            custom_explanation_image_data_urls: nextUrls,
            custom_explanation_image_data_url: nextUrls[0],
          };
        });
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '画像の読み込みに失敗しました。');
    }
  };

  const handleRemove = async (targetItem?: ReviewLaterEntry) => {
    const itemToRemove = targetItem ?? selectedItem;
    if (!itemToRemove) return;
    try {
      setIsRegisteringHistory(true);
      const response = await fetch(
        `${API_BASE_URL}/review-later/${encodeURIComponent(itemToRemove.subject)}/${encodeURIComponent(itemToRemove.problem_id)}/register-history`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '登録解除に失敗しました。');
      }
      removeReviewLaterEntryLocally(itemToRemove.subject, itemToRemove.problem_id);
    } catch (removeError) {
      console.error(removeError);
      setError(removeError instanceof Error ? removeError.message : '登録解除に失敗しました。');
    } finally {
      setIsRegisteringHistory(false);
    }
  };

  const handleToggleReviewLater = async (problem: SubjectProblem, enabled: boolean) => {
    try {
      setError('');
      const response = await fetch(
        enabled
          ? `${API_BASE_URL}/review-later`
          : `${API_BASE_URL}/review-later/${encodeURIComponent(problem.id)}?subject=${encodeURIComponent(problem.subject)}`,
        enabled
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subject: problem.subject, problem_id: problem.id }),
            }
          : { method: 'DELETE' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '後で確認の更新に失敗しました。');
      }
      if (enabled) {
        const now = new Date().toISOString();
        setItems((prev) => {
          const itemKey = `${problem.subject}::${problem.id}`;
          if (prev.some((item) => `${item.subject}::${item.problem_id}` === itemKey)) {
            return prev;
          }
          return [
            {
              subject: problem.subject,
              problem_id: problem.id,
              created_at: now,
              updated_at: now,
              question: problem,
              error: null,
            },
            ...prev,
          ];
        });
      } else {
        removeReviewLaterEntryLocally(problem.subject, problem.id);
      }
    } catch (toggleError) {
      console.error(toggleError);
      setError(toggleError instanceof Error ? toggleError.message : '後で確認の更新に失敗しました。');
    }
  };

  const handleBulkRegisterFirstMissed = async () => {
    if (unregisteredFirstMissedProblems.length === 0 || isBulkRegisteringFirstMissed) return;
    try {
      setIsBulkRegisteringFirstMissed(true);
      setError('');
      const responses = await Promise.all(
        unregisteredFirstMissedProblems.map((problem) =>
          fetch(`${API_BASE_URL}/review-later`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: problem.subject, problem_id: problem.id }),
          })
        )
      );
      const failed = responses.find((response) => !response.ok);
      if (failed) {
        const payload = await failed.json().catch(() => null);
        throw new Error(payload?.detail || '初回不正解問題の一括登録に失敗しました。');
      }
      await fetchItems();
    } catch (bulkError) {
      console.error(bulkError);
      setError(bulkError instanceof Error ? bulkError.message : '初回不正解問題の一括登録に失敗しました。');
    } finally {
      setIsBulkRegisteringFirstMissed(false);
    }
  };

  const refreshSubjectProblems = async (subjectName: string) => {
    delete subjectProblemsCacheRef.current[subjectName];
    delete firstMissedCacheRef.current[subjectName];
    if (subjectName === selectedSubjectName && loadedSubjectProblemName === subjectName) {
      await loadSubjectProblems(subjectName, true);
    }
  };

  const fetchBulkReorganizeJob = async (jobId: string) => {
    const response = await fetch(`${API_BASE_URL}/review-later/reorganize-jobs/${encodeURIComponent(jobId)}`);
    const payload = await response.json().catch(() => null) as (BulkReorganizeJobStatus & { detail?: string }) | null;
    if (!response.ok || !payload) {
      throw new Error(payload?.detail || 'AI整理ジョブの進捗取得に失敗しました。');
    }
    setBulkReorganizeJob(payload);
    if (payload.status === 'completed' || payload.status === 'failed') {
      setIsBulkReorganizingSubject(false);
      await fetchItems();
      if (
        loadedSubjectProblemName === selectedSubjectName &&
        payload.subjects.some((subject) => subject.subject === selectedSubjectName)
      ) {
        await refreshSubjectProblems(selectedSubjectName);
      }
    }
    return payload;
  };

  useEffect(() => {
    if (!bulkReorganizeJob || !['queued', 'running'].includes(bulkReorganizeJob.status)) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await fetchBulkReorganizeJob(bulkReorganizeJob.job_id);
        if (cancelled) return;
        if (payload.status === 'completed' || payload.status === 'failed') {
          window.clearInterval(intervalId);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : 'AI整理ジョブの進捗取得に失敗しました。');
        }
      }
    };
    const intervalId = window.setInterval(() => { void poll(); }, 1500);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [bulkReorganizeJob?.job_id, bulkReorganizeJob?.status, selectedSubjectName]);

  const handleBulkReorganizeSubject = async () => {
    const targetSubjects = bulkReorganizeSubjectNames.filter((subjectName) => subjectNames.includes(subjectName));
    if (targetSubjects.length === 0 || isBulkQuestionOperationRunning) return;

    try {
      setIsBulkReorganizingSubject(true);
      setBulkReorganizeResult(null);
      setBulkReorganizeJob(null);
      setError('');
      const response = await fetch(`${API_BASE_URL}/review-later/reorganize-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjects: targetSubjects,
          max_parallel_subjects: maxParallelReorganizeSubjects,
        }),
      });
      const payload = await response.json().catch(() => null) as (BulkReorganizeJobStatus & { detail?: string }) | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.detail || '問題JSON全体のAI整理に失敗しました。');
      }
      setBulkReorganizeJob(payload);
    } catch (bulkError) {
      console.error(bulkError);
      setError(bulkError instanceof Error ? bulkError.message : '問題JSON全体のAI整理に失敗しました。');
      setIsBulkReorganizingSubject(false);
    }
  };

  const handleQuestionTextMdDuplicateCheck = async () => {
    const targetSubjects = bulkReorganizeSubjectNames.filter((subjectName) => subjectNames.includes(subjectName));
    if (targetSubjects.length === 0 || isBulkQuestionOperationRunning) return;

    try {
      setIsCheckingQuestionTextMdDuplicates(true);
      setQuestionTextMdDedupeResult(null);
      setError('');
      const response = await fetch(`${API_BASE_URL}/review-later/question-text-md-dedupe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: targetSubjects }),
      });
      const payload = await response.json().catch(() => null) as (QuestionTextMdDedupeResult & { detail?: string }) | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.detail || 'python重複確認に失敗しました。');
      }
      setQuestionTextMdDedupeResult(payload);
      await fetchItems();
      if (
        loadedSubjectProblemName === selectedSubjectName &&
        targetSubjects.includes(selectedSubjectName)
      ) {
        await refreshSubjectProblems(selectedSubjectName);
      }
    } catch (dedupeError) {
      console.error(dedupeError);
      setError(dedupeError instanceof Error ? dedupeError.message : 'python重複確認に失敗しました。');
    } finally {
      setIsCheckingQuestionTextMdDuplicates(false);
    }
  };

  const openIpadReview = (profile: IpadProfile) => {
    if (!selectedItem) return;
    const deepLink =
      `quizapp://quiz-review?base=${encodeURIComponent(window.location.origin)}` +
      `&subject=${encodeURIComponent(selectedItem.subject)}` +
      `&problem=${encodeURIComponent(selectedItem.problem_id)}` +
      `&profile=${encodeURIComponent(profile)}`;
    window.location.href = deepLink;
  };

  const handleStartSimilarPractice = async () => {
    if (!selectedItem || !selectedItem.question) return;
    setIsFindingSimilar(true);
    setError('');
    setSimilarTopics([]);
    try {
      const response = await fetch(
        `${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.subject)}/${encodeURIComponent(selectedItem.problem_id)}/similar?count=5`
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '類題の取得に失敗しました。');
      }
      const payload: { topic_keywords?: string[]; quiz_set?: QuizQuestion[] } = await response.json();
      const quizSet = Array.isArray(payload.quiz_set) ? payload.quiz_set : [];
      const topics = Array.isArray(payload.topic_keywords) ? payload.topic_keywords : [];
      setSimilarTopics(topics);

      if (quizSet.length === 0) {
        setError('類題が見つかりませんでした。');
        return;
      }
      sessionStorage.setItem('adhocQuizSet', JSON.stringify(quizSet));
      sessionStorage.setItem('adhocQuizLabel', `類題演習: ${selectedItem.problem_id}`);
      sessionStorage.setItem(ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY, SIMILAR_PRACTICE_HISTORY_MODE);
      navigate('/?adhoc=1');
    } catch (similarError) {
      setError(similarError instanceof Error ? similarError.message : '類題の取得に失敗しました。');
    } finally {
      setIsFindingSimilar(false);
    }
  };

  const exportReviewLaterPdf = async () => {
    const exportItems = items.filter((item): item is ReviewLaterEntry & { question: QuizQuestion } => Boolean(item.question));
    if (exportItems.length === 0 || isExportingPdf) {
      return;
    }

    setIsExportingPdf(true);
    setPdfExportProgress('PDFを準備しています...');
    setError('');

    try {
      const { jsPDF } = await import('jspdf');
      const fontBinary = await loadPdfFontBinaryString();
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      pdf.addFileToVFS(PDF_FONT_FILE_NAME, fontBinary);
      pdf.addFont(PDF_FONT_FILE_NAME, PDF_FONT_NAME, 'normal');
      pdf.setFont(PDF_FONT_NAME, 'normal');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginX = 12;
      const marginTop = 12;
      const marginBottom = 12;
      const contentWidth = pageWidth - marginX * 2;
      const maxY = pageHeight - marginBottom;

      const drawSection = (
        title: string,
        body: string,
        cursorY: number,
      ) => {
        const normalizedBody = normalizePdfText(body);
        if (!normalizedBody) {
          return { cursorY, truncated: false };
        }

        pdf.setFontSize(10);
        pdf.text(title, marginX, cursorY);
        cursorY += 5;

        pdf.setFontSize(9);
        const lines = pdf.splitTextToSize(normalizedBody, contentWidth);
        const remainingHeight = maxY - cursorY;
        const maxLines = Math.max(1, Math.floor(remainingHeight / 4.4));
        let truncated = false;
        let printableLines = lines as string[];

        if (printableLines.length > maxLines) {
          truncated = true;
          printableLines = printableLines.slice(0, maxLines);
          const lastLine = printableLines[printableLines.length - 1] || '';
          printableLines[printableLines.length - 1] = lastLine.length > 2 ? `${lastLine.slice(0, Math.max(0, lastLine.length - 2))}…` : '…';
        }

        pdf.text(printableLines, marginX, cursorY);
        cursorY += printableLines.length * 4.4 + 3;
        return { cursorY, truncated };
      };

      exportItems.forEach((item, index) => {
        if (index > 0) {
          pdf.addPage('a4', 'portrait');
          pdf.setFont(PDF_FONT_NAME, 'normal');
        }

        setPdfExportProgress(`PDFを生成中... ${index + 1} / ${exportItems.length}`);

        const question = item.question;
        let cursorY = marginTop;
        let truncatedAny = false;

        pdf.setFontSize(12);
        pdf.text(`${question.subject} / ${question.id}`, marginX, cursorY);
        cursorY += 6;

        const metaParts = [
          question.category ? `カテゴリ: ${question.category}` : null,
          question.first_missed_answered_at ? `初回不正解: ${question.first_missed_answered_at.slice(0, 10)}` : null,
          `登録日: ${item.created_at.slice(0, 10)}`,
        ].filter((part): part is string => Boolean(part));

        pdf.setFontSize(9);
        pdf.text(metaParts.join(' / '), marginX, cursorY);
        cursorY += 7;

        const sections = [
          { title: '問題文', body: question.question_text },
          { title: '選択肢', body: question.choices.map((choice) => `${choice.label}. ${choice.text}`).join('\n') },
          { title: '正解', body: question.answer },
          { title: '解説', body: question.explanation?.text || '' },
          { title: 'My Memo', body: question.custom_explanation || '' },
        ];

        sections.forEach((section) => {
          if (cursorY >= maxY - 4) {
            truncatedAny = true;
            return;
          }
          const result = drawSection(section.title, section.body, cursorY);
          cursorY = result.cursorY;
          truncatedAny = truncatedAny || result.truncated;
        });

        if (truncatedAny) {
          pdf.setFontSize(8);
          pdf.text('※ 1問1ページに収めるため、一部を省略しています。', marginX, maxY);
        }
      });

      pdf.save(`review-later-${new Date().toISOString().slice(0, 10)}.pdf`);
      setPdfExportProgress('');
    } catch (exportError) {
      console.error(exportError);
      setError(exportError instanceof Error ? exportError.message : '後で確認PDFの生成に失敗しました。');
    } finally {
      setIsExportingPdf(false);
      setPdfExportProgress('');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[3200px] space-y-6 px-4 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-dark">後で確認</h2>
          <p className="text-sm text-gray-500 mt-1">現在も登録状態の問題をすべて表示します。登録解除時に、実績を2件計上するか、未計上のまま解除するかを選べます。</p>
          <p className="mt-2 text-sm font-semibold text-amber-800">登録中 {items.length}件</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { void exportReviewLaterPdf(); }}
            disabled={isExportingPdf || items.every((item) => !item.question)}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg shadow-sm hover:bg-slate-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isExportingPdf ? 'PDF生成中...' : '一覧をPDF出力'}
          </button>
          <Link to="/dashboard" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg shadow-sm hover:bg-gray-50">
            分析ダッシュボードへ戻る
          </Link>
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
      {pdfExportProgress ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{pdfExportProgress}</div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-sm text-gray-500">登録された問題はありません。</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="text-sm font-semibold text-gray-800">一覧</div>
              <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{items.length}件</div>
            </div>
            {items.map((item) => {
              const itemKey = `${item.subject}::${item.problem_id}`;
              const active = itemKey === selectedKey;
              return (
                <div
                  key={itemKey}
                  className={`rounded-lg border px-4 py-3 transition-colors ${
                    active ? 'border-primary-new bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedKey(itemKey)}
                    className="w-full text-left"
                  >
                    <div className="text-xs text-gray-500 truncate">{item.subject}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-gray-800 line-clamp-2">
                      {item.question?.question_text || item.error || '問題を読み込めませんでした。'}
                    </div>
                    <div className="mt-2 text-[11px] text-gray-400">更新: {new Date(item.updated_at).toLocaleString()}</div>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            {!editingProblem ? (
              <div className="text-sm text-gray-500">表示できる問題がありません。</div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs text-gray-500">{editingProblem.subject}</div>
                    <div className="text-sm text-gray-500">問題ID: {editingProblem.id}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleStartSimilarPractice()}
                      disabled={isFindingSimilar || isRegisteringHistory || !selectedItem}
                      className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-gray-300"
                    >
                      {isFindingSimilar ? '類題検索中...' : '類題出題'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openIpadReview('air')}
                      disabled={isRegisteringHistory}
                      className="px-4 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700"
                    >
                      iPad Airで開く
                    </button>
                    <button
                      type="button"
                      onClick={() => openIpadReview('mini')}
                      disabled={isRegisteringHistory}
                      className="px-4 py-2 rounded-md bg-sky-600 text-white text-sm font-medium hover:bg-sky-700"
                    >
                      iPad miniで開く
                    </button>
                    {selectedItem && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleRemove()}
                          disabled={isRegisteringHistory}
                          className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
                        >
                          {isRegisteringHistory ? '解除中...' : '登録解除(実績2件)'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!selectedItem) return;
                            try {
                              const response = await fetch(
                                `${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.problem_id)}?subject=${encodeURIComponent(selectedItem.subject)}`,
                                { method: 'DELETE' }
                              );
                              if (!response.ok) {
                                const payload = await response.json().catch(() => null);
                                throw new Error(payload?.detail || '登録解除に失敗しました。');
                              }
                              removeReviewLaterEntryLocally(selectedItem.subject, selectedItem.problem_id);
                            } catch (removeError) {
                              console.error(removeError);
                              setError(removeError instanceof Error ? removeError.message : '登録解除に失敗しました。');
                            }
                          }}
                          disabled={isRegisteringHistory}
                          className="px-4 py-2 rounded-md bg-white border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
                        >
                          登録解除(実績未計上)
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {similarTopics.length > 0 && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    AI抽出トピック: {similarTopics.join(', ')}
                  </div>
                )}
                {(isFindingSimilar || isReorganizingExplanation) && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-emerald-900">
                      <span>AI処理中</span>
                      <span>{isFindingSimilar ? '類題候補を抽出中' : '整合性を確認・整理中'}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100">
                      <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-500" />
                    </div>
                  </div>
                )}

                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-gray-800">問題データ</h3>
                    <button
                      type="button"
                      onClick={() => setShowStructuredQuestionFields((prev) => !prev)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                        showStructuredQuestionFields
                          ? 'border-slate-700 bg-slate-800 text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      md / Mermaid
                    </button>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">問題文</label>
                    <textarea
                      name="question_text"
                      value={editingProblem.question_text}
                      onChange={handleProblemChange}
                      rows={13}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  {showStructuredQuestionFields && (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">問題文 md</label>
                        <textarea
                          name="question_text_md"
                          value={editingProblem.question_text_md || ''}
                          onChange={handleProblemChange}
                          rows={12}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">問題文 Mermaid</label>
                        <textarea
                          name="question_text_mermaid"
                          value={editingProblem.question_text_mermaid || ''}
                          onChange={handleProblemChange}
                          rows={12}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    {editingProblem.choices.map((choice, index) => (
                      <div key={`${choice.label}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-[100px_minmax(0,1fr)]">
                        <input
                          value={choice.label}
                          onChange={(event) => handleChoiceChange(index, 'label', event.target.value)}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={choice.text}
                          onChange={(event) => handleChoiceChange(index, 'text', event.target.value)}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">正解</label>
                      <input
                        name="answer"
                        value={editingProblem.answer}
                        onChange={handleProblemChange}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="heading-2 block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
                      <input
                        name="category"
                        value={editingProblem.category || ''}
                        onChange={handleProblemChange}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-sm font-medium text-gray-700">解説</label>
                      <button
                        type="button"
                        onClick={() => void reorganizeExplanationWithAi()}
                        disabled={isReorganizingExplanation || isSavingProblem || isSavingMemo}
                        className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        {isReorganizingExplanation ? 'AI整理中...' : 'AIで整合性確認・整理'}
                      </button>
                    </div>
                    <textarea
                      name="explanation.text"
                      value={editingProblem.explanation.text}
                      onChange={handleProblemChange}
                      rows={15}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    {aiExplanationReview && (
                      <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        <div className="font-semibold">{aiExplanationReview.usedAi ? 'AI整理結果' : 'ローカル整形結果'}</div>
                        {aiExplanationReview.notes.length > 0 ? (
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {aiExplanationReview.notes.map((note, index) => (
                              <li key={`${note}-${index}`}>{note}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1">整合性メモはありません。</p>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveProblem()}
                    disabled={isSavingProblem || isSavingMemo}
                    className="px-5 py-2 rounded-md bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:bg-gray-300"
                  >
                    {isSavingProblem || isSavingMemo ? '保存中...' : '問題データを保存'}
                  </button>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">My Memo</h3>
                  <textarea
                    value={customExplanationText}
                    onChange={(event) => setCustomExplanationText(event.target.value)}
                    rows={5}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">問題文補足画像アップロード</label>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => void handleCustomImageUpload('question', event.target.files)}
                        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                      />
                      {questionSupplementImageUrls.length > 0 && (
                        <div className="space-y-2">
                          {questionSupplementImageUrls.map((url, index) => (
                            <div key={`question-supplement-${index}`} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingProblem((prev) => {
                                  if (!prev) return prev;
                                  const nextUrls = getCustomImageUrls(prev.custom_question_image_data_urls, prev.custom_question_image_data_url)
                                    .filter((_, currentIndex) => currentIndex !== index);
                                  return {
                                    ...prev,
                                    custom_question_image_data_urls: nextUrls,
                                    custom_question_image_data_url: nextUrls[0],
                                  };
                                })}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                問題文補足画像{index + 1}を削除
                              </button>
                              <span className="text-xs text-gray-500">画像 {index + 1}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">解説補足画像アップロード</label>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => void handleCustomImageUpload('explanation', event.target.files)}
                        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                      />
                      {explanationSupplementImageUrls.length > 0 && (
                        <div className="space-y-2">
                          {explanationSupplementImageUrls.map((url, index) => (
                            <div key={`explanation-supplement-${index}`} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingProblem((prev) => {
                                  if (!prev) return prev;
                                  const nextUrls = getCustomImageUrls(prev.custom_explanation_image_data_urls, prev.custom_explanation_image_data_url)
                                    .filter((_, currentIndex) => currentIndex !== index);
                                  return {
                                    ...prev,
                                    custom_explanation_image_data_urls: nextUrls,
                                    custom_explanation_image_data_url: nextUrls[0],
                                  };
                                })}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                解説補足画像{index + 1}を削除
                              </button>
                              <span className="text-xs text-gray-500">画像 {index + 1}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveMemo()}
                    disabled={isSavingProblem || isSavingMemo}
                    className="px-5 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    {isSavingProblem || isSavingMemo ? '保存中...' : 'My Memoを保存'}
                  </button>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-sky-900">口頭試問モード</h4>
                      {!isOralVivaActive ? (
                        <button
                          type="button"
                          onClick={() => void startOralViva()}
                          disabled={isOralVivaLoading}
                          className="px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300"
                        >
                          {isOralVivaLoading ? '開始中...' : '口頭試問を開始'}
                        </button>
                      ) : (
                        <div className="text-right">
                          <p className="text-xs font-semibold text-sky-900">
                            ステップ: {oralVivaStepLabels[oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)] as OralVivaStep]} ({Math.min(oralVivaStepIndex + 1, oralVivaSteps.length)}/{oralVivaSteps.length})
                          </p>
                          <p className="text-[11px] text-sky-700">終了条件: 4ステップ完了 or 要約へスキップ</p>
                        </div>
                      )}
                    </div>

                    {isOralVivaActive && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {([
                            ['論理性', oralVivaScores.logicality],
                            ['具体性', oralVivaScores.specificity],
                            ['再現性', oralVivaScores.reproducibility],
                          ] as Array<[string, number]>).map(([label, value]) => (
                            <div key={label} className="rounded-md border border-sky-200 bg-white px-2 py-2">
                              <div className="flex justify-between text-xs text-sky-900 mb-1">
                                <span>{label}</span>
                                <span>{value}</span>
                              </div>
                              <div className="h-2 rounded bg-sky-100 overflow-hidden">
                                <div className="h-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="max-h-64 overflow-y-auto rounded-md border border-sky-200 bg-white p-2 space-y-2">
                          {oralVivaMessages.map((msg, idx) => (
                            <div key={`${msg.role}-${idx}`} className={`rounded-md px-2 py-1 text-sm ${msg.role === 'assistant' ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-800'}`}>
                              <p className="text-[11px] font-semibold">{msg.role === 'assistant' ? 'AI面接官' : 'あなた'}</p>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          ))}
                        </div>

                        {!oralVivaResult && (
                          <div className="space-y-2">
                            <textarea
                              value={oralVivaInput}
                              onChange={(event) => setOralVivaInput(event.target.value)}
                              rows={3}
                              className="w-full rounded-md border border-sky-300 px-3 py-2 text-sm bg-white"
                              placeholder="回答を入力してください"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void submitOralViva()}
                                disabled={isOralVivaLoading || !oralVivaInput.trim()}
                                className="px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300"
                              >
                                {isOralVivaLoading ? '送信中...' : '送信'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void skipToSummary()}
                                disabled={isOralVivaLoading}
                                className="px-3 py-1.5 rounded-md border border-sky-300 bg-white text-sky-900 text-xs font-medium hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400"
                              >
                                要約へスキップ
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsOralVivaActive(false)}
                                disabled={isOralVivaLoading}
                                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
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
                              <p className="text-sm text-gray-800 whitespace-pre-wrap">次回確認ミニ問題: {oralVivaResult.miniQuizQuestion}</p>
                            )}
                            {oralVivaResult.miniQuizAnswer && (
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">想定解答: {oralVivaResult.miniQuizAnswer}</p>
                            )}
                            <p className="text-xs text-gray-500">最終要約は My Memo に自動追記・保存されます。</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {questionSupplementImageUrls.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">問題文補足画像</div>
                      <div className="space-y-3">
                        {questionSupplementImageUrls.map((url, index) => (
                          <img key={`question-preview-${index}`} src={url} alt={`Question supplement ${index + 1}`} className="max-h-56 rounded-lg border border-gray-200 bg-gray-50" />
                        ))}
                      </div>
                    </div>
                  )}
                  {explanationSupplementImageUrls.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">解説補足画像</div>
                      <div className="space-y-3">
                        {explanationSupplementImageUrls.map((url, index) => (
                          <img key={`explanation-preview-${index}`} src={url} alt={`Explanation supplement ${index + 1}`} className="max-h-56 rounded-lg border border-gray-200 bg-gray-50" />
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-5">
        <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="heading-2 text-xl font-semibold text-emerald-950">一括AI整理</h3>
              <div className="mt-1 text-sm text-emerald-800">
                対象 {bulkReorganizeSubjectNames.length}科目 / 並行 {maxParallelReorganizeSubjects}科目
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                並行
                <select
                  value={maxParallelReorganizeSubjects}
                  onChange={(event) => setMaxParallelReorganizeSubjects(Number(event.target.value))}
                  disabled={isBulkQuestionOperationRunning}
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs"
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                科目
              </label>
              <button
                type="button"
                onClick={() => void handleBulkReorganizeSubject()}
                disabled={isBulkQuestionOperationRunning || isBulkRegisteringFirstMissed || bulkReorganizeSubjectNames.length === 0}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300"
              >
                {isBulkReorganizingSubject ? 'AI整理中...' : 'AI整理を開始'}
              </button>
              <button
                type="button"
                onClick={() => void handleQuestionTextMdDuplicateCheck()}
                disabled={isBulkQuestionOperationRunning || isBulkRegisteringFirstMissed || bulkReorganizeSubjectNames.length === 0}
                className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400"
              >
                {isCheckingQuestionTextMdDuplicates ? '重複確認中...' : 'python重複確認'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkReorganizeSubjectNames(selectedSubjectName ? [selectedSubjectName] : [])}
              disabled={!selectedSubjectName || isBulkQuestionOperationRunning}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              選択科目
            </button>
            <button
              type="button"
              onClick={() => setBulkReorganizeSubjectNames(subjectNames)}
              disabled={isBulkQuestionOperationRunning || subjectNames.length === 0}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              全科目
            </button>
            <button
              type="button"
              onClick={() => setBulkReorganizeSubjectNames([])}
              disabled={isBulkQuestionOperationRunning}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              解除
            </button>
          </div>

          <div className="mt-3 grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {subjectNames.map((subjectName) => (
              <label key={`bulk-reorganize-${subjectName}`} className="flex min-w-0 items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-950">
                <input
                  type="checkbox"
                  checked={bulkReorganizeSubjectNameSet.has(subjectName)}
                  disabled={isBulkQuestionOperationRunning}
                  onChange={() => {
                    setBulkReorganizeSubjectNames((prev) => (
                      prev.includes(subjectName)
                        ? prev.filter((item) => item !== subjectName)
                        : [...prev, subjectName]
                    ));
                  }}
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-600"
                />
                <span className="truncate" title={subjectName}>{subjectName}</span>
              </label>
            ))}
          </div>

          {bulkReorganizeJob && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="font-semibold">
                  AI整理ジョブ: {bulkReorganizeJob.status === 'completed' ? '完了' : bulkReorganizeJob.status === 'failed' ? '失敗' : '実行中'}
                </div>
                <div className="text-xs font-semibold text-emerald-800">
                  科目 {bulkReorganizeJob.completed_subjects}/{bulkReorganizeJob.total_subjects} / 問題 {bulkReorganizeJob.processed_problems}/{bulkReorganizeJob.total_problems || '-'} / 更新 {bulkReorganizeJob.updated} / スキップ {bulkReorganizeJob.skipped} / 失敗 {bulkReorganizeJob.failed}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.max(2, Math.min(100, bulkReorganizeProgressPercent))}%` }}
                />
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {bulkReorganizeJob.subjects.map((subject) => (
                  <div key={`bulk-progress-${subject.subject}`} className="rounded-md border border-emerald-100 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-xs font-semibold text-emerald-950" title={subject.subject}>{subject.subject}</div>
                      <div className="shrink-0 text-xs text-emerald-800">
                        {subject.status === 'completed' ? '完了' : subject.status === 'failed' ? '失敗' : subject.status === 'running' ? '実行中' : '待機'}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-emerald-800">
                      {subject.processed}/{subject.total || '-'}問 / 更新 {subject.updated} / スキップ {subject.skipped} / 失敗 {subject.failed}
                      {subject.current_problem_id ? ` / 処理中 ${subject.current_problem_id}` : ''}
                      {subject.error ? ` / ${subject.error}` : ''}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${subject.total > 0 ? Math.max(2, Math.min(100, Math.round((subject.processed / subject.total) * 100))) : 2}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {bulkReorganizeJob.subjects.some((subject) => subject.items.some((item) => item.error)) && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {bulkReorganizeJob.subjects.flatMap((subject) => subject.items)
                    .filter((item) => item.error)
                    .slice(0, 5)
                    .map((item) => (
                      <li key={`${item.subject}:${item.problem_id}`}>{item.problem_id}: {item.error}</li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {questionTextMdDedupeResult && (
            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="font-semibold">python重複確認: 完了</div>
                <div className="text-xs font-semibold text-sky-800">
                  科目 {questionTextMdDedupeResult.total_subjects} / 問題 {questionTextMdDedupeResult.total} / 更新 {questionTextMdDedupeResult.updated} / 削除 {questionTextMdDedupeResult.duplicates_removed} / 失敗 {questionTextMdDedupeResult.failed}
                </div>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {questionTextMdDedupeResult.subjects.map((subject) => (
                  <div key={`question-md-dedupe-${subject.subject}`} className="rounded-md border border-sky-100 bg-white px-3 py-2">
                    <div className="min-w-0 truncate text-xs font-semibold text-sky-950" title={subject.subject}>{subject.subject}</div>
                    <div className="mt-1 text-xs text-sky-800">
                      {subject.total}問 / 更新 {subject.updated} / 削除 {subject.duplicates_removed} / 失敗 {subject.failed}
                    </div>
                  </div>
                ))}
              </div>
              {questionTextMdDedupeResult.subjects.some((subject) => subject.items.some((item) => item.error)) && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {questionTextMdDedupeResult.subjects.flatMap((subject) => subject.items)
                    .filter((item) => item.error)
                    .slice(0, 5)
                    .map((item) => (
                      <li key={`${item.subject}:${item.problem_id}`}>{item.problem_id}: {item.error}</li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="heading-2 text-xl font-semibold text-gray-800">科目別の問題一覧</h3>
              <p className="mt-1 text-sm text-gray-500">ここでの後で確認の登録切り替えは、実績を記録しません。</p>
            </div>
            <button
              type="button"
              onClick={() => void loadSubjectProblems(selectedSubjectName, true)}
              disabled={!selectedSubjectName || isLoadingSubjectProblems || isBulkQuestionOperationRunning}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:bg-gray-300"
            >
              {isLoadingSubjectProblems ? '読込中...' : isSelectedSubjectProblemListLoaded ? '問題一覧を再読込' : '問題一覧を表示'}
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="text-sm text-gray-600">
              <span className="heading-2 block mb-1">科目</span>
              <select
                value={selectedSubjectName}
                onChange={(event) => setSelectedSubjectName(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {subjectNames.map((subjectName) => (
                  <option key={subjectName} value={subjectName}>
                    {subjectName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-gray-600">
              <span className="heading-2 block mb-1">並び順</span>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as 'default' | 'first_missed')}
                disabled={!isSelectedSubjectProblemListLoaded}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              >
                <option value="default">問題ID順</option>
                <option value="first_missed">初回不正解を上位</option>
              </select>
            </label>
            <label className="text-sm text-gray-600">
              <span className="block mb-1">不正解日 From</span>
              <input
                type="date"
                value={firstMissedDateFrom}
                onChange={(event) => setFirstMissedDateFrom(event.target.value)}
                disabled={!isSelectedSubjectProblemListLoaded}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              />
            </label>
            <label className="text-sm text-gray-600">
              <span className="block mb-1">不正解日 To</span>
              <input
                type="date"
                value={firstMissedDateTo}
                onChange={(event) => setFirstMissedDateTo(event.target.value)}
                disabled={!isSelectedSubjectProblemListLoaded}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleBulkRegisterFirstMissed()}
              disabled={!isSelectedSubjectProblemListLoaded || isBulkRegisteringFirstMissed || isBulkReorganizingSubject || unregisteredFirstMissedProblems.length === 0}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:bg-gray-300"
            >
              {isBulkRegisteringFirstMissed
                ? '一括登録中...'
                : `表示中を一括で後で確認に登録${unregisteredFirstMissedProblems.length > 0 ? ` (${unregisteredFirstMissedProblems.length})` : ''}`}
            </button>
          </div>

          <div className="mt-4">
            {isLoadingSubjectProblems ? (
              <LoadingSpinner />
            ) : selectedSubjectName === '' ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">科目がありません。</div>
            ) : !isSelectedSubjectProblemListLoaded ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">問題一覧は未表示です。</div>
            ) : sortedSubjectProblems.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">表示対象の問題がありません。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="px-3 py-2">問題ID</th>
                      <th className="px-3 py-2">カテゴリ</th>
                      <th className="px-3 py-2">問題文</th>
                      <th className="px-3 py-2">初回不正解</th>
                      <th className="px-3 py-2">初回不正解日</th>
                      <th className="px-3 py-2">後で確認</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSubjectProblems.map((problem) => {
                      const key = `${problem.subject}::${problem.id}`;
                      const isReviewLater = reviewLaterKeySet.has(key);
                      const firstMissedDate = firstMissedDateById[problem.id];
                      return (
                        <tr key={key} className="border-b align-top">
                          <td className="px-3 py-2 font-medium text-gray-800">{problem.id}</td>
                          <td className="px-3 py-2 text-gray-600">{problem.category || '-'}</td>
                          <td className="px-3 py-2 text-gray-700">
                            <button
                              type="button"
                              onClick={() => setSelectedKey(key)}
                              className="whitespace-pre-wrap text-left hover:text-primary-new"
                            >
                              {problem.question_text}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            {firstMissedIds.has(problem.id) ? (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">対象</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {firstMissedDate ? firstMissedDate.slice(0, 10) : '-'}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => void handleToggleReviewLater(problem, !isReviewLater)}
                              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                                isReviewLater
                                  ? 'bg-primary-new text-white hover:bg-blue-700'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              {isReviewLater ? '登録中' : '未登録'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
