import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import { markdownComponents } from './components/markdownComponents';
import mplusRegularFontUrl from './assets/fonts/MPLUS1p-Regular.ttf';

const API_BASE_URL = '/api';
const PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY = 'paperPracticePendingRequest';
const PDF_FONT_FILE_NAME = 'MPLUS1p-Regular.ttf';
const PDF_FONT_NAME = 'MPLUS1p';
const PAPER_PAGE_WIDTH = 595;
const PAPER_PAGE_HEIGHT = 842;
const PAPER_LANDSCAPE_WIDTH = 842;
const PAPER_LANDSCAPE_HEIGHT = 595;
const PDF_MAX_FONT_SIZE = 13;
const PDF_MIN_FONT_SIZE = 5;
const PDF_LANDSCAPE_FONT_SIZE_REDUCTION = 2;
const JAPANESE_CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク'];

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
}

interface PaperPracticeLot {
  id: string;
  title: string;
  created_at: string;
  subjects: string[];
  mode: string;
  source_mode?: string | null;
  count: number;
  tag_filter: string;
  questions: QuizQuestion[];
}

interface PendingPaperPracticeRequest {
  subjects: string[];
  mode: string;
  source_mode?: string;
  count: number;
  weights?: Record<string, string>;
  keywords?: string[];
  specific_area_history_scope?: string;
  tag_filter?: string;
}

interface GradedAnswer {
  lotNumber: number;
  question: QuizQuestion;
  selectedAnswer: string;
  isCorrect: boolean;
}

type PaperPracticeModalStep = 'answer' | 'result' | 'review';
type PaperPracticePdfLayout = 'portrait-one' | 'landscape-two';

interface PaperPracticeAttemptAnswer {
  lot_number: number;
  problem_id: string;
  subject: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
  question: QuizQuestion;
}

interface PaperPracticeAttempt {
  id: string;
  lot_id: string;
  created_at: string;
  total_count: number;
  correct_count: number;
  answers: PaperPracticeAttemptAnswer[];
}

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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function getLotDisplayTitle(lot: Pick<PaperPracticeLot, 'title' | 'created_at'>) {
  if (/^紙演習ロット \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(lot.title)) {
    return formatDateTime(lot.created_at);
  }
  return lot.title.replace(/^紙演習ロット\s*/, '').trim() || formatDateTime(lot.created_at);
}

function getLotListTitle(lot: PaperPracticeLot) {
  return `${getLotDisplayTitle(lot)} ${lot.count}問`;
}

function modeLabel(mode: string | null | undefined) {
  const labels: Record<string, string> = {
    today_remaining: '今日の残り',
    random: 'ランダム',
    weak_area: '苦手克服',
    unanswered: '未解答問題',
    specific_area: '特定領域',
    paper_practice: '紙演習',
  };
  return mode ? labels[mode] ?? mode : '-';
}

function choiceDisplayLabel(index: number, fallback: string) {
  return JAPANESE_CHOICE_LABELS[index] ?? fallback;
}

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'paper-practice-lot';
}

function normalizePdfText(value: string | undefined | null) {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function getChoiceDisplayForLabel(question: QuizQuestion, label: string) {
  const index = question.choices.findIndex((choice) => choice.label === label);
  if (index < 0) return label;
  return choiceDisplayLabel(index, label);
}

function attemptToGradedAnswers(attempt: PaperPracticeAttempt): GradedAnswer[] {
  return attempt.answers.map((answer) => ({
    lotNumber: answer.lot_number,
    question: answer.question,
    selectedAnswer: answer.selected_answer,
    isCorrect: answer.is_correct,
  }));
}

function PaperReviewCard({
  item,
}: {
  item: GradedAnswer;
}) {
  const selectedChoice = item.question.choices.find((choice) => choice.label === item.selectedAnswer);
  const correctChoice = item.question.choices.find((choice) => choice.label === item.question.answer);
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">ロット内 {item.lotNumber}問目</div>
        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${item.isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
          {item.isCorrect ? '正解' : '不正解'}
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-7 text-slate-800">{item.question.question_text}</p>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="text-xs font-semibold text-slate-500">選択</div>
          <div className="mt-1 break-words text-slate-800">{selectedChoice ? `${item.selectedAnswer}. ${selectedChoice.text}` : item.selectedAnswer}</div>
        </div>
        <div className="min-w-0 rounded-lg bg-emerald-50 p-3">
          <div className="text-xs font-semibold text-emerald-700">正解</div>
          <div className="mt-1 break-words text-emerald-950">{correctChoice ? `${item.question.answer}. ${correctChoice.text}` : item.question.answer}</div>
        </div>
      </div>
      <div className="mt-4 border-t border-slate-200 pt-4">
        <h4 className="text-base font-semibold text-primary-new">解説</h4>
        <div className="question-markdown prose prose-sm mt-2 max-w-none text-slate-700">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
            {item.question.explanation?.text || 'この問題の解説はありません。'}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default function PaperPracticePage() {
  const [lots, setLots] = useState<PaperPracticeLot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingLot, setIsCreatingLot] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [deletingLotId, setDeletingLotId] = useState<string | null>(null);
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);
  const [historyLot, setHistoryLot] = useState<PaperPracticeLot | null>(null);
  const [lotAttempts, setLotAttempts] = useState<PaperPracticeAttempt[]>([]);
  const [isLoadingAttempts, setIsLoadingAttempts] = useState(false);
  const [attemptError, setAttemptError] = useState('');
  const [pdfProgress, setPdfProgress] = useState('');
  const [error, setError] = useState('');
  const [answerLot, setAnswerLot] = useState<PaperPracticeLot | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [gradedAnswers, setGradedAnswers] = useState<GradedAnswer[]>([]);
  const [modalStep, setModalStep] = useState<PaperPracticeModalStep>('answer');
  const [reviewKind, setReviewKind] = useState<'incorrect' | 'correct'>('incorrect');
  const [reviewIndex, setReviewIndex] = useState(0);
  const pendingHandledRef = useRef(false);

  const fetchLots = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/paper-practice/lots`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '紙演習ロットの取得に失敗しました。');
      }
      const payload: PaperPracticeLot[] = await response.json();
      setLots(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '紙演習ロットの取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createLot = useCallback(async (request: PendingPaperPracticeRequest) => {
    setIsCreatingLot(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/paper-practice/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '紙演習ロットの作成に失敗しました。');
      }
      const lot: PaperPracticeLot = await response.json();
      setLots((current) => [lot, ...current.filter((item) => item.id !== lot.id)]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '紙演習ロットの作成に失敗しました。');
    } finally {
      setIsCreatingLot(false);
    }
  }, []);

  useEffect(() => {
    void fetchLots();
  }, [fetchLots]);

  useEffect(() => {
    if (pendingHandledRef.current) return;
    pendingHandledRef.current = true;
    const raw = sessionStorage.getItem(PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY);
    try {
      const parsed = JSON.parse(raw) as PendingPaperPracticeRequest;
      void createLot(parsed);
    } catch {
      setError('紙演習ロット作成条件の読み込みに失敗しました。');
    }
  }, [createLot]);

  const openAnswerModal = (lot: PaperPracticeLot) => {
    setAnswerLot(lot);
    setAnswers({});
    setGradedAnswers([]);
    setModalStep('answer');
    setReviewKind('incorrect');
    setReviewIndex(0);
    setError('');
  };

  const closeAnswerModal = () => {
    if (isSubmittingAnswers) return;
    setAnswerLot(null);
    setAnswers({});
    setGradedAnswers([]);
    setModalStep('answer');
  };

  const fetchAttempts = async (lot: PaperPracticeLot) => {
    setHistoryLot(lot);
    setLotAttempts([]);
    setAttemptError('');
    setIsLoadingAttempts(true);
    try {
      const response = await fetch(`${API_BASE_URL}/paper-practice/lots/${encodeURIComponent(lot.id)}/attempts`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '採点履歴の取得に失敗しました。');
      }
      const attempts: PaperPracticeAttempt[] = await response.json();
      setLotAttempts(attempts);
    } catch (fetchError) {
      setAttemptError(fetchError instanceof Error ? fetchError.message : '採点履歴の取得に失敗しました。');
    } finally {
      setIsLoadingAttempts(false);
    }
  };

  const closeHistoryModal = () => {
    setHistoryLot(null);
    setLotAttempts([]);
    setAttemptError('');
  };

  const openAttemptReview = (lot: PaperPracticeLot, attempt: PaperPracticeAttempt) => {
    setAnswerLot(lot);
    setAnswers(Object.fromEntries(attempt.answers.map((answer) => [answer.problem_id, answer.selected_answer])));
    setGradedAnswers(attemptToGradedAnswers(attempt));
    setModalStep('result');
    setReviewKind(attempt.answers.some((answer) => !answer.is_correct) ? 'incorrect' : 'correct');
    setReviewIndex(0);
    setError('');
    closeHistoryModal();
  };

  const deleteLot = async (lot: PaperPracticeLot) => {
    if (deletingLotId) return;
    if (!window.confirm(`ロット「${getLotListTitle(lot)}」を削除しますか？`)) return;

    setDeletingLotId(lot.id);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/paper-practice/lots/${encodeURIComponent(lot.id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '紙演習ロットの削除に失敗しました。');
      }
      setLots((current) => current.filter((item) => item.id !== lot.id));
      if (answerLot?.id === lot.id) {
        setAnswerLot(null);
        setAnswers({});
        setGradedAnswers([]);
        setModalStep('answer');
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '紙演習ロットの削除に失敗しました。');
    } finally {
      setDeletingLotId(null);
    }
  };

  const exportLotPdf = async (lot: PaperPracticeLot, layout: PaperPracticePdfLayout) => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfProgress('PDFを準備しています...');
    setError('');

    try {
      const { jsPDF } = await import('jspdf');
      const fontBinary = await loadPdfFontBinaryString();
      const isLandscapeTwo = layout === 'landscape-two';
      const pdf = new jsPDF({
        orientation: isLandscapeTwo ? 'landscape' : 'portrait',
        unit: 'px',
        format: isLandscapeTwo ? [PAPER_LANDSCAPE_WIDTH, PAPER_LANDSCAPE_HEIGHT] : [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT],
        compress: true,
      });
      pdf.addFileToVFS(PDF_FONT_FILE_NAME, fontBinary);
      pdf.addFont(PDF_FONT_FILE_NAME, PDF_FONT_NAME, 'normal');
      pdf.setFont(PDF_FONT_NAME, 'normal');

      const drawLines = (lines: string[], x: number, y: number, lineHeight: number) => {
        lines.forEach((line, index) => {
          pdf.text(line, x, y + index * lineHeight);
        });
      };

      const buildBlocks = (question: QuizQuestion, questionIndex: number) => {
        const baseBlocks = [
          `${getLotDisplayTitle(lot)} / ロット内 ${questionIndex + 1}問目`,
          `${question.subject}${question.category ? ` / ${question.category}` : ''}`,
          '',
          normalizePdfText(question.question_text),
          '',
          ...question.choices.map((choice, choiceIndex) => `${choiceDisplayLabel(choiceIndex, choice.label)}. ${choice.text}`),
        ];
        return baseBlocks;
      };

      const drawQuestion = (
        question: QuizQuestion,
        questionIndex: number,
        x: number,
        y: number,
        width: number,
        height: number,
        maxFontSize: number,
        minFontSize: number,
      ) => {
        const baseBlocks = buildBlocks(question, questionIndex);
        let fontSize = maxFontSize;
        let renderedLines: string[] = [];
        while (fontSize >= minFontSize) {
          pdf.setFontSize(fontSize);
          renderedLines = baseBlocks.flatMap((block) => (block ? pdf.splitTextToSize(block, width) as string[] : ['']));
          const lineHeight = fontSize * 1.35;
          if (renderedLines.length * lineHeight <= height) {
            break;
          }
          fontSize -= 1;
        }
        pdf.setTextColor(15, 23, 42);
        pdf.setFontSize(fontSize);
        drawLines(renderedLines, x, y, fontSize * 1.35);
      };

      if (isLandscapeTwo) {
        lot.questions.forEach((question, questionIndex) => {
          if (questionIndex > 0 && questionIndex % 2 === 0) {
            pdf.addPage([PAPER_LANDSCAPE_WIDTH, PAPER_LANDSCAPE_HEIGHT], 'landscape');
          }
          setPdfProgress(`PDFを生成中... ${questionIndex + 1} / ${lot.questions.length}`);
          if (questionIndex % 2 === 0) {
            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, 0, PAPER_LANDSCAPE_WIDTH, PAPER_LANDSCAPE_HEIGHT, 'F');
            pdf.setDrawColor(226, 232, 240);
            pdf.line(PAPER_LANDSCAPE_WIDTH / 2, 0, PAPER_LANDSCAPE_WIDTH / 2, PAPER_LANDSCAPE_HEIGHT);
          }
          const panelIndex = questionIndex % 2;
          const panelWidth = PAPER_LANDSCAPE_WIDTH / 2;
          drawQuestion(
            question,
            questionIndex,
            panelIndex * panelWidth + 12,
            18,
            panelWidth - 24,
            PAPER_LANDSCAPE_HEIGHT - 32,
            PDF_MAX_FONT_SIZE - PDF_LANDSCAPE_FONT_SIZE_REDUCTION,
            PDF_MIN_FONT_SIZE - PDF_LANDSCAPE_FONT_SIZE_REDUCTION,
          );
        });
      } else {
        lot.questions.forEach((question, questionIndex) => {
          if (questionIndex > 0) {
            pdf.addPage([PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], 'portrait');
          }
          setPdfProgress(`PDFを生成中... ${questionIndex + 1} / ${lot.questions.length}`);
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT, 'F');
          drawQuestion(question, questionIndex, 16, 24, PAPER_PAGE_WIDTH - 32, PAPER_PAGE_HEIGHT - 34, PDF_MAX_FONT_SIZE, PDF_MIN_FONT_SIZE);
        });
      }

      const suffix = isLandscapeTwo ? 'A4横2問' : 'A4縦1問';
      pdf.save(`${sanitizeFilename(getLotListTitle(lot))}_${suffix}.pdf`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'PDF出力に失敗しました。');
    } finally {
      setIsExportingPdf(false);
      setPdfProgress('');
    }
  };

  const submitAnswers = async () => {
    if (!answerLot || isSubmittingAnswers || gradedAnswers.length > 0) return;
    const missingNumbers = answerLot.questions
      .map((question, index) => (answers[question.id] ? null : index + 1))
      .filter((value): value is number => value !== null);
    if (missingNumbers.length > 0) {
      setError(`未入力の問題があります: ${missingNumbers.join(', ')}`);
      return;
    }

    try {
      setIsSubmittingAnswers(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/paper-practice/lots/${encodeURIComponent(answerLot.id)}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '一括採点結果の保存に失敗しました。');
      }
      const attempt: PaperPracticeAttempt = await response.json();
      const nextGradedAnswers = attemptToGradedAnswers(attempt);
      setGradedAnswers(nextGradedAnswers);
      setReviewKind(nextGradedAnswers.some((item) => !item.isCorrect) ? 'incorrect' : 'correct');
      setReviewIndex(0);
      setModalStep('result');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '一括採点結果の保存に失敗しました。');
    } finally {
      setIsSubmittingAnswers(false);
    }
  };

  const currentReviewItems = useMemo(
    () => gradedAnswers.filter((item) => (reviewKind === 'incorrect' ? !item.isCorrect : item.isCorrect)),
    [gradedAnswers, reviewKind],
  );
  const currentReviewItem = currentReviewItems[Math.min(reviewIndex, Math.max(0, currentReviewItems.length - 1))];
  const correctCount = gradedAnswers.filter((item) => item.isCorrect).length;
  const incorrectCount = gradedAnswers.length - correctCount;
  const answeredCount = answerLot ? answerLot.questions.filter((question) => answers[question.id]).length : 0;
  const accuracy = gradedAnswers.length > 0 ? Math.round((correctCount / gradedAnswers.length) * 100) : 0;

  const startReview = (kind: 'incorrect' | 'correct') => {
    setReviewKind(kind);
    setReviewIndex(0);
    setModalStep('review');
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">紙演習モード</h2>
          <p className="mt-1 text-sm text-slate-500">ロット一覧</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchLots()}
          disabled={isLoading || isCreatingLot}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          更新
        </button>
      </div>

      {isCreatingLot && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">
          ロットを作成しています...
        </div>
      )}
      {pdfProgress && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
          {pdfProgress}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : lots.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          ロットはまだありません。
        </div>
      ) : (
        <div className="space-y-3">
          {lots.map((lot) => (
            <div key={lot.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold text-slate-900">{getLotListTitle(lot)}</h3>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{formatDateTime(lot.created_at)}</span>
                    <span>{modeLabel(lot.source_mode || lot.mode)}</span>
                    <span className="truncate">{lot.subjects.join(', ')}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:w-[30rem] sm:grid-cols-5">
                  <button
                    type="button"
                    onClick={() => void exportLotPdf(lot, 'portrait-one')}
                    disabled={isExportingPdf || deletingLotId === lot.id}
                    className="rounded-md border border-slate-700 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    PDF縦
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportLotPdf(lot, 'landscape-two')}
                    disabled={isExportingPdf || deletingLotId === lot.id}
                    className="rounded-md border border-slate-700 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    PDF横
                  </button>
                  <button
                    type="button"
                    onClick={() => openAnswerModal(lot)}
                    disabled={deletingLotId === lot.id}
                    className="rounded-md bg-primary-new px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    演習開始
                  </button>
                  <button
                    type="button"
                    onClick={() => void fetchAttempts(lot)}
                    disabled={deletingLotId === lot.id}
                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    履歴
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteLot(lot)}
                    disabled={deletingLotId === lot.id}
                    className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {deletingLotId === lot.id ? '削除中...' : '削除'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {historyLot && createPortal((
        <div className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-slate-950/50 px-2 py-3 sm:items-center sm:px-4 sm:py-6">
          <div className="flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl sm:h-[80dvh]">
            <div className="shrink-0 border-b border-slate-200 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{getLotListTitle(historyLot)}</h3>
                  <p className="text-xs text-slate-500">採点履歴</p>
                </div>
                <button
                  type="button"
                  onClick={closeHistoryModal}
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  閉じる
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {isLoadingAttempts ? (
                <LoadingSpinner />
              ) : attemptError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{attemptError}</div>
              ) : lotAttempts.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  採点履歴はまだありません。
                </div>
              ) : (
                <div className="space-y-3">
                  {lotAttempts.map((attempt, index) => {
                    const incorrectCountForAttempt = attempt.total_count - attempt.correct_count;
                    const accuracyForAttempt = attempt.total_count > 0 ? Math.round((attempt.correct_count / attempt.total_count) * 100) : 0;
                    return (
                      <div key={attempt.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">
                              {lotAttempts.length - index}回目 / {formatDateTime(attempt.created_at)}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span>実施 {attempt.total_count}</span>
                              <span>正解 {attempt.correct_count}</span>
                              <span>不正解 {incorrectCountForAttempt}</span>
                              <span>正答率 {accuracyForAttempt}%</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openAttemptReview(historyLot, attempt)}
                            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                          >
                            振り返り
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {answerLot && createPortal((
        <div className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-slate-950/50 px-2 py-3 sm:items-center sm:px-4 sm:py-6">
          <div className="flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl sm:h-[92dvh] sm:max-h-[56rem]">
            <div className="shrink-0 border-b border-slate-200 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{getLotListTitle(answerLot)}</h3>
                  <p className="text-xs text-slate-500">{formatDateTime(answerLot.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={closeAnswerModal}
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  閉じる
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                <div className={`rounded-md px-1.5 py-2 ${modalStep === 'answer' ? 'bg-primary-new text-white' : 'bg-slate-100 text-slate-500'}`}>解答入力</div>
                <div className={`rounded-md px-1.5 py-2 ${modalStep === 'result' ? 'bg-primary-new text-white' : 'bg-slate-100 text-slate-500'}`}>採点結果</div>
                <div className={`rounded-md px-1.5 py-2 ${modalStep === 'review' ? 'bg-primary-new text-white' : 'bg-slate-100 text-slate-500'}`}>解説確認</div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-5 sm:py-4">
              {modalStep === 'answer' && (
                <div className="space-y-2">
                  <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    入力済み {answeredCount} / {answerLot.questions.length}
                  </div>
                  {answerLot.questions.map((question, index) => (
                    <div key={question.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-[4.75rem_minmax(0,1fr)]">
                      <div className="flex items-center justify-center bg-slate-50 px-1 text-sm font-semibold text-slate-800 sm:px-2">
                        {index + 1}
                      </div>
                      <div className="grid min-w-0 grid-cols-2 gap-1.5 p-1.5 sm:grid-cols-4 sm:gap-2 sm:p-2">
                        {question.choices.map((choice, choiceIndex) => (
                          <label
                            key={choice.label}
                            className={`flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-1.5 py-2 text-sm font-semibold transition-colors sm:gap-2 sm:px-2 ${
                              answers[question.id] === choice.label
                                ? 'border-primary-new bg-blue-50 text-primary-new'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`paper-answer-${question.id}`}
                              value={choice.label}
                              checked={answers[question.id] === choice.label}
                              onChange={() => setAnswers((current) => ({ ...current, [question.id]: choice.label }))}
                              className="h-4 w-4"
                            />
                            <span>{choiceDisplayLabel(choiceIndex, choice.label)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {modalStep === 'result' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg bg-slate-100 p-3 text-center sm:p-4">
                      <div className="text-xs font-semibold text-slate-500">採点済み</div>
                      <div className="mt-1 text-xl font-bold text-slate-800 sm:text-2xl">{gradedAnswers.length}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-3 text-center sm:p-4">
                      <div className="text-xs font-semibold text-emerald-700">正解</div>
                      <div className="mt-1 text-xl font-bold text-emerald-800 sm:text-2xl">{correctCount}</div>
                    </div>
                    <div className="rounded-lg bg-rose-50 p-3 text-center sm:p-4">
                      <div className="text-xs font-semibold text-rose-700">不正解</div>
                      <div className="mt-1 text-xl font-bold text-rose-700 sm:text-2xl">{incorrectCount}</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3 text-center sm:p-4">
                      <div className="text-xs font-semibold text-blue-700">正答率</div>
                      <div className="mt-1 text-xl font-bold text-blue-800 sm:text-2xl">{accuracy}%</div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_4rem] bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-500 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_5rem] sm:px-3">
                      <div>No.</div>
                      <div>選択</div>
                      <div>正解</div>
                      <div className="text-right">結果</div>
                    </div>
                    <div className="max-h-[42vh] overflow-y-auto divide-y divide-slate-100">
                      {gradedAnswers.map((item) => (
                        <div key={`${item.question.id}-${item.lotNumber}`} className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_4rem] items-center px-2 py-2 text-sm sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_5rem] sm:px-3">
                          <div className="font-semibold text-slate-700">{item.lotNumber}</div>
                          <div className="min-w-0 break-words text-slate-700">{getChoiceDisplayForLabel(item.question, item.selectedAnswer)}</div>
                          <div className="min-w-0 break-words text-slate-700">{getChoiceDisplayForLabel(item.question, item.question.answer)}</div>
                          <div className={`text-right text-xs font-semibold ${item.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {item.isCorrect ? '正解' : '不正解'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => startReview('incorrect')}
                      onPointerUp={() => startReview('incorrect')}
                      disabled={incorrectCount === 0}
                      className="rounded-md bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      不正解の解説を確認
                    </button>
                    <button
                      type="button"
                      onClick={() => startReview('correct')}
                      onPointerUp={() => startReview('correct')}
                      disabled={correctCount === 0}
                      className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      正解の解説を確認
                    </button>
                  </div>
                </div>
              )}

              {modalStep === 'review' && (
                <div>
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startReview('incorrect')}
                        disabled={incorrectCount === 0}
                        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${reviewKind === 'incorrect' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                      >
                        不正解
                      </button>
                      <button
                        type="button"
                        onClick={() => startReview('correct')}
                        disabled={correctCount === 0}
                        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${reviewKind === 'correct' ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
                      >
                        正解
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setModalStep('result')}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
                    >
                      結果へ戻る
                    </button>
                  </div>
                  {currentReviewItem ? (
                    <div className="space-y-3">
                      <PaperReviewCard item={currentReviewItem} />
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setReviewIndex((current) => Math.max(0, current - 1))}
                          disabled={reviewIndex <= 0}
                          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          前へ
                        </button>
                        <div className="text-sm text-slate-500">{Math.min(reviewIndex + 1, currentReviewItems.length)} / {currentReviewItems.length}</div>
                        <button
                          type="button"
                          onClick={() => setReviewIndex((current) => Math.min(currentReviewItems.length - 1, current + 1))}
                          disabled={reviewIndex >= currentReviewItems.length - 1}
                          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          次へ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                      対象の問題はありません。
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-5 sm:py-4">
              {modalStep === 'answer' ? (
                <button
                  type="button"
                  onClick={() => void submitAnswers()}
                  disabled={isSubmittingAnswers}
                  className="w-full rounded-md bg-primary-new px-4 py-3 text-base font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {isSubmittingAnswers ? '採点中...' : '一括採点'}
                </button>
              ) : modalStep === 'result' ? (
                <button
                  type="button"
                  onClick={closeAnswerModal}
                  className="w-full rounded-md bg-slate-800 px-4 py-3 text-base font-medium text-white hover:bg-slate-700"
                >
                  完了
                </button>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setModalStep('result')}
                    className="rounded-md border border-slate-300 px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50"
                  >
                    結果へ戻る
                  </button>
                  <button
                    type="button"
                    onClick={closeAnswerModal}
                    className="rounded-md bg-slate-800 px-4 py-3 text-base font-medium text-white hover:bg-slate-700"
                  >
                    完了
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
