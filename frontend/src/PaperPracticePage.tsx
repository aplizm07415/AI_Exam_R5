import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import { markdownComponents, markdownRehypePlugins } from './components/markdownComponents';
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
const PDF_PORTRAIT_FONT_SIZE_REDUCTION = 5;
const PDF_LANDSCAPE_FONT_SIZE_REDUCTION = 2;
const PDF_CAPTURE_SCALE = 2;
const PDF_SPLIT_BOTTOM_GUARD_PX = 18;
const PDF_SPLIT_SCAN_RANGE_PX = 180;
const PDF_SPLIT_MIN_BLANK_ROWS = 8;
const PDF_CONTINUATION_LINE_WIDTH = 5;
// アプリのメインカラー（tailwind: primary-new #3d7cce）
const PDF_COVER_ACCENT_RGB: readonly [number, number, number] = [61, 124, 206];
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
type PaperPracticePdfLayout = 'portrait-one' | 'landscape-two' | 'single-side-pair';
type PaperPracticeReviewKind = 'all' | 'incorrect' | 'correct';
type PaperPracticeGradingScope = 'answered_only' | 'all';
type Html2CanvasFunction = typeof import('html2canvas').default;
type PdfRgbColor = readonly [number, number, number];

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
    worry_practice: '心配事',
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

function hslToRgb(hue: number, saturation: number, lightness: number): PdfRgbColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime >= 1 && huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime >= 2 && huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime >= 3 && huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime >= 4 && huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = lightness - chroma / 2;
  return [
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  ];
}

function buildPdfContinuationLineColors(count: number): PdfRgbColor[] {
  const colors: PdfRgbColor[] = [];
  const used = new Set<string>();

  for (let index = 0; index < count; index += 1) {
    let attempt = 0;
    let color: PdfRgbColor;
    let key = '';

    do {
      const hue = (index * 137.508 + attempt * 31) % 360;
      const saturation = 0.82 + ((index + attempt) % 3) * 0.04;
      const lightness = 0.64 + ((index + attempt) % 2) * 0.08;
      color = hslToRgb(hue, saturation, lightness);
      key = color.join(',');
      attempt += 1;
    } while (used.has(key) && attempt < 20);

    used.add(key);
    colors.push(color);
  }

  return colors;
}

function getChoiceDisplayForLabel(question: QuizQuestion, label: string) {
  if (!label) return '未入力';
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

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function renderQuestionMermaidSvg(chart: string, idSeed: string) {
  const source = chart.trim();
  if (!source) {
    return { svg: '', error: '' };
  }

  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    });
    const result = await mermaid.render(`paper-practice-pdf-${idSeed}`, source);
    return { svg: result.svg, error: '' };
  } catch (error) {
    return {
      svg: '',
      error: error instanceof Error ? error.message : 'Mermaid図の描画に失敗しました。',
    };
  }
}

async function renderElementToCanvas(
  html2canvas: Html2CanvasFunction,
  element: React.ReactElement,
  width: number,
) {
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = `${width}px`;
  host.style.background = '#ffffff';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    root.render(element);
    await waitForNextFrame();
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await waitForNextFrame();

    const target = host.firstElementChild as HTMLElement | null;
    if (!target) {
      throw new Error('PDF用の問題表示を生成できませんでした。');
    }

    return await html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: PDF_CAPTURE_SCALE,
      useCORS: true,
      windowWidth: width,
      windowHeight: Math.max(target.scrollHeight, target.offsetHeight),
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

function isCanvasRowBlank(
  data: Uint8ClampedArray,
  width: number,
  row: number,
  sampleStep: number,
) {
  let coloredSamples = 0;
  let totalSamples = 0;
  const rowOffset = row * width * 4;

  for (let x = 0; x < width; x += sampleStep) {
    const offset = rowOffset + x * 4;
    const alpha = data[offset + 3] ?? 0;
    if (alpha < 12) {
      totalSamples += 1;
      continue;
    }

    const red = data[offset] ?? 255;
    const green = data[offset + 1] ?? 255;
    const blue = data[offset + 2] ?? 255;
    const isNearWhite = red >= 245 && green >= 245 && blue >= 245;
    if (!isNearWhite) {
      coloredSamples += 1;
    }
    totalSamples += 1;
  }

  return totalSamples === 0 || coloredSamples / totalSamples < 0.012;
}

function findReasonableCanvasSliceHeight(
  canvas: HTMLCanvasElement,
  sourceY: number,
  maxSliceHeightPx: number,
) {
  const remainingHeight = canvas.height - sourceY;
  if (remainingHeight <= maxSliceHeightPx) {
    return remainingHeight;
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return Math.max(1, maxSliceHeightPx - PDF_SPLIT_BOTTOM_GUARD_PX);
  }

  const safeMaxHeight = Math.max(1, maxSliceHeightPx - PDF_SPLIT_BOTTOM_GUARD_PX);
  const scanStart = sourceY + safeMaxHeight;
  const scanEnd = sourceY + Math.max(
    Math.floor(maxSliceHeightPx * 0.55),
    safeMaxHeight - PDF_SPLIT_SCAN_RANGE_PX,
  );
  const imageData = context.getImageData(0, sourceY, canvas.width, safeMaxHeight);
  const sampleStep = Math.max(1, Math.floor(canvas.width / 180));
  let blankRun = 0;

  for (let absoluteRow = scanStart - 1; absoluteRow >= scanEnd; absoluteRow -= 1) {
    const localRow = absoluteRow - sourceY;
    if (isCanvasRowBlank(imageData.data, canvas.width, localRow, sampleStep)) {
      blankRun += 1;
      if (blankRun >= PDF_SPLIT_MIN_BLANK_ROWS) {
        return Math.max(1, localRow + PDF_SPLIT_MIN_BLANK_ROWS);
      }
    } else {
      blankRun = 0;
    }
  }

  return safeMaxHeight;
}

function PdfQuestionContent({
  lot,
  question,
  questionIndex,
  width,
  fontSize,
  mermaidSvg,
  mermaidError,
}: {
  lot: PaperPracticeLot;
  question: QuizQuestion;
  questionIndex: number;
  width: number;
  fontSize: number;
  mermaidSvg: string;
  mermaidError: string;
}) {
  const questionText = normalizePdfText(question.question_text);
  const questionTextMd = normalizePdfText(question.question_text_md);
  const questionTextMermaid = normalizePdfText(question.question_text_mermaid);

  return (
    <div
      className="paper-practice-pdf-question"
      style={{
        width,
        background: '#ffffff',
        color: '#0f172a',
        fontFamily: '"M PLUS 1p", "Hiragino Sans", "Yu Gothic", sans-serif',
        fontSize,
        lineHeight: 1.5,
      }}
    >
      <div className="paper-practice-pdf-question__meta">
        <div>{getLotDisplayTitle(lot)} / ロット内 {questionIndex + 1}問目</div>
        <div>{question.subject}{question.category ? ` / ${question.category}` : ''}</div>
      </div>

      {questionText && (
        <div className="paper-practice-pdf-question__body">
          {questionText}
        </div>
      )}

      {questionTextMd && (
        <div className="paper-practice-pdf-question__markdown question-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={markdownRehypePlugins} components={markdownComponents}>
            {questionTextMd}
          </ReactMarkdown>
        </div>
      )}

      {questionTextMermaid && (
        <div className={`paper-practice-pdf-question__mermaid ${mermaidError ? 'paper-practice-pdf-question__mermaid--error' : ''}`}>
          {mermaidSvg ? (
            <div dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
          ) : (
            <>
              <div className="paper-practice-pdf-question__mermaid-error">
                {mermaidError || 'Mermaid図を描画できませんでした。'}
              </div>
              <pre>{questionTextMermaid}</pre>
            </>
          )}
        </div>
      )}

      <div className="paper-practice-pdf-question__choices">
        {question.choices.map((choice, choiceIndex) => (
          <div key={`${choice.label}-${choiceIndex}`} className="paper-practice-pdf-question__choice">
            <span className="paper-practice-pdf-question__choice-label">{choiceDisplayLabel(choiceIndex, choice.label)}.</span>
            <span>{choice.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PdfExplanationContent({
  lot,
  question,
  questionIndex,
  width,
  fontSize,
}: {
  lot: PaperPracticeLot;
  question: QuizQuestion;
  questionIndex: number;
  width: number;
  fontSize: number;
}) {
  const explanationText = normalizePdfText(question.explanation?.text) || 'この問題の解説はありません。';
  const customExplanation = normalizePdfText(question.custom_explanation);
  const answerIndex = question.choices.findIndex((choice) => choice.label === question.answer);
  const answerChoice = answerIndex >= 0 ? question.choices[answerIndex] : undefined;

  return (
    <div
      className="paper-practice-pdf-question"
      style={{
        width,
        background: '#ffffff',
        color: '#0f172a',
        fontFamily: '"M PLUS 1p", "Hiragino Sans", "Yu Gothic", sans-serif',
        fontSize,
        lineHeight: 1.5,
      }}
    >
      <div className="paper-practice-pdf-question__meta">
        <div>{getLotDisplayTitle(lot)} / ロット内 {questionIndex + 1}問目の解説</div>
        <div>{question.subject}{question.category ? ` / ${question.category}` : ''}</div>
      </div>

      <div className="paper-practice-pdf-question__answer">
        正解: {answerIndex >= 0 ? choiceDisplayLabel(answerIndex, question.answer) : question.answer}
        {answerChoice ? `. ${answerChoice.text}` : ''}
      </div>

      <div className="paper-practice-pdf-question__markdown question-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={markdownRehypePlugins} components={markdownComponents}>
          {explanationText}
        </ReactMarkdown>
      </div>

      {customExplanation && (
        <div className="paper-practice-pdf-question__custom">
          <div className="paper-practice-pdf-question__custom-title">mymemo</div>
          <div className="paper-practice-pdf-question__markdown question-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={markdownRehypePlugins} components={markdownComponents}>
              {customExplanation}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function PaperReviewCard({
  item,
  isReviewLaterRegistered,
  isUpdatingReviewLater,
  onRegisterReviewLater,
}: {
  item: GradedAnswer;
  isReviewLaterRegistered: boolean;
  isUpdatingReviewLater: boolean;
  onRegisterReviewLater: () => void;
}) {
  const selectedChoice = item.question.choices.find((choice) => choice.label === item.selectedAnswer);
  const correctChoice = item.question.choices.find((choice) => choice.label === item.question.answer);
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">ロット内 {item.lotNumber}問目</div>
          <div className="mt-1 text-xs text-slate-500">{item.question.subject}{item.question.category ? ` / ${item.question.category}` : ''}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRegisterReviewLater}
            disabled={isReviewLaterRegistered || isUpdatingReviewLater}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isReviewLaterRegistered
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100'
            } disabled:cursor-not-allowed disabled:opacity-70`}
          >
            {isUpdatingReviewLater ? '登録中...' : isReviewLaterRegistered ? '後で確認済み' : '後で確認へ登録'}
          </button>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${item.isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
            {item.isCorrect ? '正解' : '不正解'}
          </div>
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-7 text-slate-800">{item.question.question_text}</p>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="text-xs font-semibold text-slate-500">選択</div>
          <div className="mt-1 break-words text-slate-800">{selectedChoice ? `${item.selectedAnswer}. ${selectedChoice.text}` : item.selectedAnswer || '未入力'}</div>
        </div>
        <div className="min-w-0 rounded-lg bg-emerald-50 p-3">
          <div className="text-xs font-semibold text-emerald-700">正解</div>
          <div className="mt-1 break-words text-emerald-950">{correctChoice ? `${item.question.answer}. ${correctChoice.text}` : item.question.answer}</div>
        </div>
      </div>
      <div className="mt-4 border-t border-slate-200 pt-4">
        <h4 className="text-base font-semibold text-primary-new">解説</h4>
        <div className="question-markdown prose prose-sm mt-2 max-w-none text-slate-700">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={markdownRehypePlugins} components={markdownComponents}>
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
  const [includeCoverPage, setIncludeCoverPage] = useState(false);
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
  const [reviewKind, setReviewKind] = useState<PaperPracticeReviewKind>('incorrect');
  const [reviewIndex, setReviewIndex] = useState(0);
  const [gradingScope, setGradingScope] = useState<PaperPracticeGradingScope>('answered_only');
  const [reviewLaterKeys, setReviewLaterKeys] = useState<string[]>([]);
  const [updatingReviewLaterKey, setUpdatingReviewLaterKey] = useState<string | null>(null);
  const [reviewLaterMessage, setReviewLaterMessage] = useState('');
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

  const fetchReviewLaterKeys = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/review-later`);
      if (!response.ok) return;
      const data: Array<{ subject: string; problem_id: string }> = await response.json();
      setReviewLaterKeys(data.map((item) => `${item.subject}::${item.problem_id}`));
    } catch (fetchError) {
      console.error(fetchError);
    }
  }, []);

  useEffect(() => {
    void fetchReviewLaterKeys();
  }, [fetchReviewLaterKeys]);

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
    setGradingScope('answered_only');
    setReviewLaterMessage('');
    setError('');
  };

  const closeAnswerModal = () => {
    if (isSubmittingAnswers) return;
    setAnswerLot(null);
    setAnswers({});
    setGradedAnswers([]);
    setModalStep('answer');
    setReviewLaterMessage('');
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
    setReviewLaterMessage('');
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
      const { default: html2canvas } = await import('html2canvas');
      const fontBinary = await loadPdfFontBinaryString();
      const isLandscapeTwo = layout === 'landscape-two';
      const isSingleSidePair = layout === 'single-side-pair';
      const pdf = new jsPDF({
        orientation: isLandscapeTwo ? 'landscape' : 'portrait',
        unit: 'px',
        format: isLandscapeTwo ? [PAPER_LANDSCAPE_WIDTH, PAPER_LANDSCAPE_HEIGHT] : [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT],
        compress: true,
      });
      pdf.addFileToVFS(PDF_FONT_FILE_NAME, fontBinary);
      pdf.addFont(PDF_FONT_FILE_NAME, PDF_FONT_NAME, 'normal');
      pdf.setFont(PDF_FONT_NAME, 'normal');
      const continuationLineColors = buildPdfContinuationLineColors(lot.questions.length);
      const hasCoverPage = includeCoverPage;

      if (hasCoverPage) {
        const pageWidth = isLandscapeTwo ? PAPER_LANDSCAPE_WIDTH : PAPER_PAGE_WIDTH;
        const pageHeight = isLandscapeTwo ? PAPER_LANDSCAPE_HEIGHT : PAPER_PAGE_HEIGHT;
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        const titleX = 62;
        const titleTop = 92;
        const titleFontSize = 29;
        const titleLineHeight = titleFontSize * 1.4;
        pdf.setFontSize(titleFontSize);
        pdf.setTextColor(15, 23, 42);
        const titleLines = pdf.splitTextToSize(`紙演習 ${getLotDisplayTitle(lot)}`, pageWidth - titleX - 40) as string[];
        titleLines.forEach((line, index) => {
          pdf.text(line, titleX, titleTop + index * titleLineHeight);
        });

        const [accentRed, accentGreen, accentBlue] = PDF_COVER_ACCENT_RGB;
        pdf.setFillColor(accentRed, accentGreen, accentBlue);
        pdf.rect(46, titleTop - titleFontSize, 6, titleLineHeight * titleLines.length + 4, 'F');

        pdf.setFontSize(18);
        pdf.setTextColor(51, 65, 85);
        const metaLines = [
          `作成日時: ${formatDateTime(lot.created_at)}`,
          `科目: ${lot.subjects.join(', ')}`,
          `問題数: ${lot.count}問`,
          `出力日時: ${formatDateTime(new Date().toISOString())}`,
        ];
        let metaY = titleTop + titleLineHeight * titleLines.length + 26;
        for (const metaLine of metaLines) {
          const wrappedLines = pdf.splitTextToSize(metaLine, pageWidth - titleX - 40) as string[];
          for (const wrappedLine of wrappedLines) {
            pdf.text(wrappedLine, titleX, metaY);
            metaY += 26;
          }
        }
      }

      const drawRenderedElement = async (
        element: React.ReactElement,
        x: number,
        y: number,
        width: number,
        height: number,
        addOverflowPage: () => void,
        continuationLineColor: PdfRgbColor,
      ) => {
        const canvas = await renderElementToCanvas(html2canvas, element, width);
        const pixelsPerPdfUnit = canvas.width / width;
        const maxSliceHeightPx = Math.max(1, Math.floor(height * pixelsPerPdfUnit));
        const willOverflow = canvas.height > maxSliceHeightPx;
        let sourceY = 0;
        let didOverflow = false;

        while (sourceY < canvas.height) {
          if (sourceY > 0) {
            didOverflow = true;
            addOverflowPage();
          }

          const sliceHeightPx = findReasonableCanvasSliceHeight(canvas, sourceY, maxSliceHeightPx);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeightPx;
          const context = sliceCanvas.getContext('2d');
          if (!context) {
            throw new Error('PDF用の問題画像を分割できませんでした。');
          }
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          context.drawImage(
            canvas,
            0,
            sourceY,
            canvas.width,
            sliceHeightPx,
            0,
            0,
            canvas.width,
            sliceHeightPx,
          );

          const renderHeight = sliceHeightPx / pixelsPerPdfUnit;
          if (willOverflow) {
            const [red, green, blue] = continuationLineColor;
            pdf.setFillColor(red, green, blue);
            pdf.rect(Math.max(0, x - 9), y, PDF_CONTINUATION_LINE_WIDTH, height, 'F');
          }
          pdf.addImage(sliceCanvas, 'PNG', x, y, width, renderHeight, undefined, 'FAST');
          sourceY += sliceHeightPx;
        }

        return didOverflow;
      };

      const drawQuestion = async (
        question: QuizQuestion,
        questionIndex: number,
        x: number,
        y: number,
        width: number,
        height: number,
        maxFontSize: number,
        _minFontSize: number,
        addOverflowPage: () => void,
        continuationLineColor: PdfRgbColor,
      ) => {
        const mermaidResult = await renderQuestionMermaidSvg(
          normalizePdfText(question.question_text_mermaid),
          `${lot.id}-${question.id}-${questionIndex}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
        );
        return drawRenderedElement(
          <PdfQuestionContent
            lot={lot}
            question={question}
            questionIndex={questionIndex}
            width={width}
            fontSize={maxFontSize}
            mermaidSvg={mermaidResult.svg}
            mermaidError={mermaidResult.error}
          />,
          x,
          y,
          width,
          height,
          addOverflowPage,
          continuationLineColor,
        );
      };

      if (isLandscapeTwo) {
        let currentPanelIndex = 0;
        let hasCreatedLandscapePage = hasCoverPage;

        const prepareLandscapePage = (shouldAddPage: boolean) => {
          if (shouldAddPage) {
            pdf.addPage([PAPER_LANDSCAPE_WIDTH, PAPER_LANDSCAPE_HEIGHT], 'landscape');
          }
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, PAPER_LANDSCAPE_WIDTH, PAPER_LANDSCAPE_HEIGHT, 'F');
          pdf.setDrawColor(226, 232, 240);
          pdf.line(PAPER_LANDSCAPE_WIDTH / 2, 0, PAPER_LANDSCAPE_WIDTH / 2, PAPER_LANDSCAPE_HEIGHT);
          hasCreatedLandscapePage = true;
        };

        for (const [questionIndex, question] of lot.questions.entries()) {
          setPdfProgress(`PDFを生成中... ${questionIndex + 1} / ${lot.questions.length}`);
          if (currentPanelIndex === 0) {
            prepareLandscapePage(hasCreatedLandscapePage);
          }
          const panelWidth = PAPER_LANDSCAPE_WIDTH / 2;
          const didOverflow = await drawQuestion(
            question,
            questionIndex,
            currentPanelIndex * panelWidth + 12,
            18,
            panelWidth - 24,
            PAPER_LANDSCAPE_HEIGHT - 32,
            PDF_MAX_FONT_SIZE - PDF_LANDSCAPE_FONT_SIZE_REDUCTION,
            PDF_MIN_FONT_SIZE - PDF_LANDSCAPE_FONT_SIZE_REDUCTION,
            () => {
              prepareLandscapePage(true);
            },
            continuationLineColors[questionIndex] ?? [190, 242, 100],
          );
          currentPanelIndex = didOverflow || currentPanelIndex === 1 ? 0 : 1;
        }
      } else if (isSingleSidePair) {
        const paintPortraitBackground = () => {
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT, 'F');
        };
        const addPortraitPage = () => {
          pdf.addPage([PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], 'portrait');
          paintPortraitBackground();
        };
        // 片面印刷前提で問題ページ→解説ページの順に出力する。
        // 1問1枚に収まる場合は奇数枚目=問題・偶数枚目=解説になり、
        // 1問が複数ページに跨った場合はその分だけ後続がずれる。

        for (const [questionIndex, question] of lot.questions.entries()) {
          setPdfProgress(`PDFを生成中... ${questionIndex + 1} / ${lot.questions.length}`);
          if (questionIndex === 0 && !hasCoverPage) {
            paintPortraitBackground();
          } else {
            addPortraitPage();
          }
          await drawQuestion(
            question,
            questionIndex,
            16,
            24,
            PAPER_PAGE_WIDTH - 32,
            PAPER_PAGE_HEIGHT - 34,
            PDF_MAX_FONT_SIZE - PDF_PORTRAIT_FONT_SIZE_REDUCTION,
            PDF_MIN_FONT_SIZE,
            addPortraitPage,
            continuationLineColors[questionIndex] ?? [190, 242, 100],
          );

          addPortraitPage();
          await drawRenderedElement(
            <PdfExplanationContent
              lot={lot}
              question={question}
              questionIndex={questionIndex}
              width={PAPER_PAGE_WIDTH - 32}
              fontSize={PDF_MAX_FONT_SIZE - PDF_PORTRAIT_FONT_SIZE_REDUCTION}
            />,
            16,
            24,
            PAPER_PAGE_WIDTH - 32,
            PAPER_PAGE_HEIGHT - 34,
            addPortraitPage,
            continuationLineColors[questionIndex] ?? [190, 242, 100],
          );
        }
      } else {
        for (const [questionIndex, question] of lot.questions.entries()) {
          if (questionIndex > 0 || hasCoverPage) {
            pdf.addPage([PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], 'portrait');
          }
          setPdfProgress(`PDFを生成中... ${questionIndex + 1} / ${lot.questions.length}`);
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT, 'F');
          await drawQuestion(
            question,
            questionIndex,
            16,
            24,
            PAPER_PAGE_WIDTH - 32,
            PAPER_PAGE_HEIGHT - 34,
            PDF_MAX_FONT_SIZE - PDF_PORTRAIT_FONT_SIZE_REDUCTION,
            PDF_MIN_FONT_SIZE,
            () => {
              pdf.addPage([PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], 'portrait');
              pdf.setFillColor(255, 255, 255);
              pdf.rect(0, 0, PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT, 'F');
            },
            continuationLineColors[questionIndex] ?? [190, 242, 100],
          );
        }
      }

      const suffix = isLandscapeTwo ? 'A4横2問' : isSingleSidePair ? 'A4縦片面_問題解説' : 'A4縦1問';
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
    if (gradingScope === 'answered_only' && answeredCount === 0) {
      setError('採点対象の入力がありません。');
      return;
    }
    if (gradingScope === 'all' && missingNumbers.length > 0) {
      const shouldContinue = window.confirm(
        `未入力の問題があります: ${missingNumbers.join(', ')}\n\n未入力は不正解として実績に含めます。続行しますか？`
      );
      if (!shouldContinue) return;
    }
    if (gradingScope !== 'all' && missingNumbers.length === answerLot.questions.length) {
      setError(`未入力の問題があります: ${missingNumbers.join(', ')}`);
      return;
    }

    try {
      setIsSubmittingAnswers(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/paper-practice/lots/${encodeURIComponent(answerLot.id)}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, grading_scope: gradingScope }),
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
    () => gradedAnswers.filter((item) => (
      reviewKind === 'all' ? true : reviewKind === 'incorrect' ? !item.isCorrect : item.isCorrect
    )),
    [gradedAnswers, reviewKind],
  );
  const currentReviewItem = currentReviewItems[Math.min(reviewIndex, Math.max(0, currentReviewItems.length - 1))];
  const correctCount = gradedAnswers.filter((item) => item.isCorrect).length;
  const incorrectCount = gradedAnswers.length - correctCount;
  const answeredCount = answerLot ? answerLot.questions.filter((question) => answers[question.id]).length : 0;
  const accuracy = gradedAnswers.length > 0 ? Math.round((correctCount / gradedAnswers.length) * 100) : 0;

  const startReview = (kind: PaperPracticeReviewKind) => {
    setReviewKind(kind);
    setReviewIndex(0);
    setReviewLaterMessage('');
    setModalStep('review');
  };

  const registerReviewLater = async (item: GradedAnswer) => {
    const reviewKey = `${item.question.subject}::${item.question.id}`;
    if (reviewLaterKeys.includes(reviewKey) || updatingReviewLaterKey) return;
    try {
      setUpdatingReviewLaterKey(reviewKey);
      setReviewLaterMessage('');
      const response = await fetch(`${API_BASE_URL}/review-later`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: item.question.subject, problem_id: item.question.id }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '後で確認への登録に失敗しました。');
      }
      setReviewLaterKeys((current) => Array.from(new Set([...current, reviewKey])));
      setReviewLaterMessage(`ロット内 ${item.lotNumber}問目を後で確認へ登録しました。`);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : '後で確認への登録に失敗しました。');
    } finally {
      setUpdatingReviewLaterKey(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">紙演習モード</h2>
          <p className="mt-1 text-sm text-slate-500">ロット一覧</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/commute-practice"
            className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-primary-new hover:bg-blue-100"
          >
            通勤演習管理
          </Link>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={includeCoverPage}
              onChange={(event) => setIncludeCoverPage(event.target.checked)}
              className="h-4 w-4"
            />
            PDFに表紙を追加
          </label>
          <button
            type="button"
            onClick={() => void fetchLots()}
            disabled={isLoading || isCreatingLot}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            更新
          </button>
        </div>
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
                <div className="grid grid-cols-2 gap-2 sm:w-[36rem] sm:grid-cols-6">
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
                    onClick={() => void exportLotPdf(lot, 'single-side-pair')}
                    disabled={isExportingPdf || deletingLotId === lot.id}
                    title="片面印刷用: 奇数枚目に問題・選択肢、偶数枚目に解説を割り当てます"
                    className="rounded-md border border-slate-700 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    PDF片面
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
          <div className="flex h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl sm:h-[92dvh] sm:max-h-[56rem]">
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
                  <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div>入力済み {answeredCount} / {answerLot.questions.length}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 ${gradingScope === 'answered_only' ? 'border-primary-new bg-blue-50 text-primary-new' : 'border-slate-200 bg-white text-slate-700'}`}>
                        <input
                          type="radio"
                          name="paper-grading-scope"
                          value="answered_only"
                          checked={gradingScope === 'answered_only'}
                          onChange={() => setGradingScope('answered_only')}
                          className="h-4 w-4"
                        />
                        <span className="text-xs font-semibold">入力済みだけ実績</span>
                      </label>
                      <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 ${gradingScope === 'all' ? 'border-primary-new bg-blue-50 text-primary-new' : 'border-slate-200 bg-white text-slate-700'}`}>
                        <input
                          type="radio"
                          name="paper-grading-scope"
                          value="all"
                          checked={gradingScope === 'all'}
                          onChange={() => setGradingScope('all')}
                          className="h-4 w-4"
                        />
                        <span className="text-xs font-semibold">全問を実績</span>
                      </label>
                    </div>
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
                      onClick={() => startReview('all')}
                      disabled={gradedAnswers.length === 0}
                      className="rounded-md bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      問題順に解説を確認
                    </button>
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
                        onClick={() => startReview('all')}
                        disabled={gradedAnswers.length === 0}
                        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${reviewKind === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                      >
                        問題順
                      </button>
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
                  {reviewLaterMessage && (
                    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      {reviewLaterMessage}
                    </div>
                  )}
                  {currentReviewItem ? (
                    <div className="space-y-3">
                      <PaperReviewCard
                        item={currentReviewItem}
                        isReviewLaterRegistered={reviewLaterKeys.includes(`${currentReviewItem.question.subject}::${currentReviewItem.question.id}`)}
                        isUpdatingReviewLater={updatingReviewLaterKey === `${currentReviewItem.question.subject}::${currentReviewItem.question.id}`}
                        onRegisterReviewLater={() => void registerReviewLater(currentReviewItem)}
                      />
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
                  {isSubmittingAnswers ? '採点中...' : gradingScope === 'answered_only' ? '入力済みだけ採点' : '全問を採点'}
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
