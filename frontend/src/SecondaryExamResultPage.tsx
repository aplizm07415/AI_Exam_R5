import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { BarChartIcon, LoaderIcon, PencilIcon } from './components/icons';
import {
  askSecondaryExamOralViva,
  fetchSecondaryExamDetail,
  fetchSecondaryExamResult,
} from './secondaryExam/api';
import type {
  SecondaryAttemptHistoryItem,
  SecondaryExamDetailResponse,
  SecondaryGradeResult,
  SecondaryOralVivaTurn,
  SecondaryQuestionPromptPacket,
} from './secondaryExam/types';

type PrintPlacement = 'auto' | 'break-before' | 'keep-with-previous';

type PrintBlockConfig = {
  id: string;
  title: string;
  include: boolean;
  placement: PrintPlacement;
  kind: 'summary' | 'history' | 'question' | 'oral-viva';
  questionKey?: string;
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return '未実施';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPoints(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function createDefaultPrintBlocks({
  questionPackets,
  includeHistory,
  includeOralViva,
}: {
  questionPackets: SecondaryQuestionPromptPacket[];
  includeHistory: boolean;
  includeOralViva: boolean;
}) {
  const blocks: PrintBlockConfig[] = [
    {
      id: 'summary',
      title: 'SUMMARY',
      include: true,
      placement: 'auto',
      kind: 'summary',
    },
  ];

  if (includeHistory) {
    blocks.push({
      id: 'score-history',
      title: 'SCORE HISTORY',
      include: false,
      placement: 'auto',
      kind: 'history',
    });
  }

  questionPackets.forEach((packet, index) => {
    const questionKey = typeof packet.question_key === 'string' && packet.question_key.trim()
      ? packet.question_key
      : `q${index + 1}`;
    blocks.push({
      id: `question:${questionKey}`,
      title: questionKey.toUpperCase(),
      include: true,
      placement: index === 0 ? 'auto' : 'break-before',
      kind: 'question',
      questionKey,
    });
  });

  if (includeOralViva) {
    blocks.push({
      id: 'oral-viva',
      title: 'ORAL VIVA',
      include: false,
      placement: 'break-before',
      kind: 'oral-viva',
    });
  }

  return blocks;
}

function mergePrintBlocks(previous: PrintBlockConfig[], nextDefaults: PrintBlockConfig[]) {
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  return nextDefaults.map((item) => {
    const saved = previousMap.get(item.id);
    return saved
      ? {
          ...item,
          include: saved.include,
          placement: saved.placement,
        }
      : item;
  });
}

function moveBlock(configs: PrintBlockConfig[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= configs.length || index < 0 || index >= configs.length) {
    return configs;
  }
  const next = [...configs];
  const [target] = next.splice(index, 1);
  if (!target) {
    return configs;
  }
  next.splice(nextIndex, 0, target);
  return next;
}

function getPlacementLabel(value: PrintPlacement) {
  switch (value) {
    case 'break-before':
      return 'このブロックから新しいページ';
    case 'keep-with-previous':
      return '前ブロックと同じページを優先';
    default:
      return '自動';
  }
}

function QuestionResultCard({
  packet,
  result,
  answerText,
}: {
  packet: SecondaryQuestionPromptPacket;
  result: SecondaryGradeResult['question_results'][number] | undefined;
  answerText: string;
}) {
  if (!result) {
    return null;
  }

  return (
    <article className="secondary-result-question-card rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{packet.question_key}</div>
          <div className="mt-1 text-sm font-semibold leading-7 text-slate-900">{packet.prompt_text_clean}</div>
        </div>
        <div className="rounded-2xl bg-slate-900 px-3 py-2 text-right text-white">
          <div className="text-sm font-semibold">{formatPoints(result.score)} / {formatPoints(result.max_score)}点</div>
          <div className="text-xs text-slate-300">{result.score_percentage}%</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Your Answer</div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">{answerText.trim() ? answerText : '未回答'}</div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2">文字数: {result.char_count}{result.char_limit ? ` / ${result.char_limit}` : ''}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">観点一致: {result.coverage_score}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">設問対応: {result.prompt_score}</div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">良い点</div>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {result.positives.map((item) => (
              <li key={item} className="rounded-xl bg-emerald-50 px-3 py-2">{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">改善ポイント</div>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {result.improvement_points.map((item) => (
              <li key={item} className="rounded-xl bg-rose-50 px-3 py-2">{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700">
        <div className="font-semibold text-sky-700">アドバイス</div>
        <div className="mt-1">{result.advice}</div>
      </div>
    </article>
  );
}

function AttemptHistoryCard({
  attempt,
  selected,
  onSelect,
}: {
  attempt: SecondaryAttemptHistoryItem;
  selected: boolean;
  onSelect: (attemptId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(attempt.attempt_id)}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-sky-500 bg-sky-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{formatPoints(attempt.overall_score)} / {formatPoints(attempt.total_possible_score)}点</div>
          <div className="mt-1 text-xs text-slate-500">{attempt.overall_percentage}% ・ {formatDateTime(attempt.scored_at)}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{attempt.answered_questions} / {attempt.total_questions}設問</div>
          <div>{attempt.cached ? 'キャッシュ再利用' : '新規採点'}</div>
        </div>
      </div>
    </button>
  );
}

function PrintConfigModal({
  isOpen,
  blocks,
  onClose,
  onToggleInclude,
  onPlacementChange,
  onMove,
  onReset,
  onPrint,
}: {
  isOpen: boolean;
  blocks: PrintBlockConfig[];
  onClose: () => void;
  onToggleInclude: (id: string, include: boolean) => void;
  onPlacementChange: (id: string, placement: PrintPlacement) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onReset: () => void;
  onPrint: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="print-config-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="印刷構成の調整">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Print Layout</div>
            <h3 className="mt-1 text-2xl font-semibold text-slate-900">印刷構成を調整</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              ブロックごとに印刷対象、並び順、改ページ方針を調整できます。ページ位置はブラウザ印刷の範囲で反映されます。
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            閉じる
          </button>
        </div>

        <div className="grid gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3 px-6 py-6">
            {blocks.map((block, index) => (
              <div key={block.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Block {index + 1}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-slate-900">{block.title}</div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${block.include ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {block.include ? '印刷する' : '印刷しない'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onMove(index, -1)}
                      disabled={index === 0}
                      className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-40"
                    >
                      上へ
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(index, 1)}
                      disabled={index === blocks.length - 1}
                      className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-40"
                    >
                      下へ
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <label className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">出力対象</span>
                    <input
                      type="checkbox"
                      className="mr-2 h-4 w-4 rounded border-slate-300 align-middle"
                      checked={block.include}
                      onChange={(event) => onToggleInclude(block.id, event.target.checked)}
                    />
                    このブロックを印刷に含める
                  </label>

                  <label className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">配置方針</span>
                    <select
                      value={block.placement}
                      onChange={(event) => onPlacementChange(block.id, event.target.value as PrintPlacement)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="auto">自動</option>
                      <option value="keep-with-previous">前ブロックと同じページを優先</option>
                      <option value="break-before">このブロックから新しいページ</option>
                    </select>
                    <span className="mt-2 block text-xs text-slate-500">{getPlacementLabel(block.placement)}</span>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 bg-slate-900 px-6 py-6 text-slate-100 lg:border-l lg:border-t-0">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Guide</div>
            <h4 className="mt-2 text-lg font-semibold">おすすめの使い方</h4>
            <div className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
              <p>`SUMMARY` を先頭に置いて、各設問は必要なら新しいページから始めると復習しやすくなります。</p>
              <p>`SCORE HISTORY` は比較したいときだけ入れるのがおすすめです。</p>
              <p>長い設問は印刷エンジンの都合で完全固定できないので、その場合は不要ブロックを外すと安定します。</p>
            </div>

            <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm text-slate-200">
              印刷対象: {blocks.filter((item) => item.include).length} / {blocks.length}
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <button type="button" onClick={onPrint} className="rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-200">
                この構成で印刷
              </button>
              <button type="button" onClick={onReset} className="rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">
                初期設定に戻す
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecondaryExamResultPage() {
  const navigate = useNavigate();
  const { attemptId } = useParams<{ attemptId: string }>();
  const [detail, setDetail] = useState<SecondaryExamDetailResponse | null>(null);
  const [result, setResult] = useState<SecondaryGradeResult | null>(null);
  const [selectedHistoryAttemptId, setSelectedHistoryAttemptId] = useState<string | null>(attemptId ?? null);
  const [oralVivaInput, setOralVivaInput] = useState('');
  const [oralVivaConversation, setOralVivaConversation] = useState<SecondaryOralVivaTurn[]>([]);
  const [oralVivaSuggestedFollowups, setOralVivaSuggestedFollowups] = useState<string[]>([]);
  const [oralVivaCitedQuestionKeys, setOralVivaCitedQuestionKeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAskingOralViva, setIsAskingOralViva] = useState(false);
  const [isPrintConfigOpen, setIsPrintConfigOpen] = useState(false);
  const [printBlocks, setPrintBlocks] = useState<PrintBlockConfig[]>([]);
  const [error, setError] = useState('');

  const questionPackets = detail?.bundle.normalized_scoring_input?.question_prompt_packets ?? [];
  const resultHistory = detail?.result_history ?? [];
  const defaultPrintBlocks = useMemo(
    () =>
      createDefaultPrintBlocks({
        questionPackets,
        includeHistory: resultHistory.length > 0,
        includeOralViva: oralVivaConversation.length > 0,
      }),
    [oralVivaConversation.length, questionPackets, resultHistory.length],
  );
  const selectedHistoryAttempt = useMemo(
    () => resultHistory.find((item) => item.attempt_id === selectedHistoryAttemptId) ?? null,
    [resultHistory, selectedHistoryAttemptId],
  );
  const questionResultMap = useMemo(
    () => new Map(result?.question_results.map((item) => [item.question_key, item]) ?? []),
    [result?.question_results],
  );
  const orderedPrintBlocks = useMemo(
    () => printBlocks.filter((item) => item.include),
    [printBlocks],
  );

  const handlePrintReview = () => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const bodyClassName = 'print-secondary-exam-review';
    const cleanup = () => {
      document.body.classList.remove(bodyClassName);
      window.removeEventListener('afterprint', cleanup);
    };

    flushSync(() => {
      setIsPrintConfigOpen(false);
    });
    document.body.classList.add(bodyClassName);
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  useEffect(() => {
    setPrintBlocks((current) => mergePrintBlocks(current, defaultPrintBlocks));
  }, [defaultPrintBlocks]);

  useEffect(() => {
    const load = async () => {
      if (!attemptId) {
        setError('採点結果IDが指定されていません。');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const nextResult = await fetchSecondaryExamResult(attemptId);
        const nextDetail = await fetchSecondaryExamDetail(nextResult.year_label, nextResult.case_no);
        setResult(nextResult);
        setDetail(nextDetail);
        setSelectedHistoryAttemptId(attemptId);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '採点結果の読み込みに失敗しました。');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [attemptId]);

  useEffect(() => {
    const loadSelectedResult = async () => {
      if (!selectedHistoryAttemptId || selectedHistoryAttemptId === result?.attempt_id) {
        return;
      }
      setError('');
      try {
        const nextResult = await fetchSecondaryExamResult(selectedHistoryAttemptId);
        setResult(nextResult);
        setOralVivaConversation([]);
        setOralVivaSuggestedFollowups([]);
        setOralVivaCitedQuestionKeys([]);
        setOralVivaInput('');
        navigate(`/secondary-exam/results/${selectedHistoryAttemptId}`, { replace: true });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '採点結果の読み込みに失敗しました。');
      }
    };
    void loadSelectedResult();
  }, [navigate, result?.attempt_id, selectedHistoryAttemptId]);

  const handleAskOralViva = async (prefilledQuestion?: string) => {
    if (!detail || !result) {
      return;
    }
    const question = (prefilledQuestion ?? oralVivaInput).trim();
    if (!question) {
      return;
    }

    const nextConversation = [...oralVivaConversation, { role: 'user', content: question } satisfies SecondaryOralVivaTurn];
    setOralVivaConversation(nextConversation);
    setOralVivaInput('');
    setIsAskingOralViva(true);
    setError('');

    try {
      const response = await askSecondaryExamOralViva(detail.bundle.year_label, detail.bundle.case_no, {
        attempt_id: result.attempt_id,
        user_message: question,
        conversation: oralVivaConversation,
      });
      setOralVivaConversation((current) => [...current, { role: 'assistant', content: response.assistant_message }]);
      setOralVivaSuggestedFollowups(response.suggested_followups);
      setOralVivaCitedQuestionKeys(response.cited_question_keys);
    } catch (nextError) {
      setOralVivaConversation((current) => current.slice(0, -1));
      setError(nextError instanceof Error ? nextError.message : '口頭試問Q&Aに失敗しました。');
      setOralVivaInput(question);
    } finally {
      setIsAskingOralViva(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error && !detail && !result) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  }

  if (!detail || !result) {
    return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">採点結果が見つかりませんでした。</div>;
  }

  const renderPrintBlock = (block: PrintBlockConfig) => {
    if (block.kind === 'summary') {
      return (
        <section className="print-review-block-card rounded-[1.75rem] border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Summary</div>
              <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                {detail.bundle.year_label} 事例{detail.bundle.case_no} 採点結果
              </h2>
              <div className="mt-3 text-lg font-semibold text-slate-900">
                総合 {formatPoints(result.overall_score)} / {formatPoints(result.total_possible_score)}点
              </div>
              <div className="mt-1 text-sm font-semibold text-sky-700">{result.overall_percentage}%</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right text-sm text-slate-700">
              <div className="font-semibold">{formatDateTime(result.scored_at)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {result.cached ? '同一答案のキャッシュ結果' : result.overall_feedback.used_ai ? 'AI採点を使用' : 'ローカル評価を使用'}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700">
            {result.overall_feedback.summary}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {result.overall_feedback.priority_actions.map((item) => (
              <span key={item} className="rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{item}</span>
            ))}
          </div>
        </section>
      );
    }

    if (block.kind === 'history') {
      return (
        <section className="print-review-block-card rounded-[1.75rem] border border-slate-200 bg-white p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Score History</div>
          <h3 className="mt-1 text-xl font-semibold text-slate-900">履歴ごとの振り返り</h3>
          <div className="mt-4 space-y-3">
            {resultHistory.map((attempt) => (
              <div key={attempt.attempt_id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-slate-900">{formatPoints(attempt.overall_score)} / {formatPoints(attempt.total_possible_score)}点</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(attempt.scored_at)}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{attempt.overall_percentage}%</div>
                    <div>{attempt.answered_questions} / {attempt.total_questions}設問</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (block.kind === 'oral-viva') {
      return (
        <section className="print-review-block-card rounded-[1.75rem] border border-slate-200 bg-white p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Oral Viva</div>
          <h3 className="mt-1 text-xl font-semibold text-slate-900">採点後の口頭試問Q&A</h3>
          <div className="mt-4 space-y-3">
            {oralVivaConversation.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`rounded-2xl px-4 py-3 text-sm leading-7 ${turn.role === 'assistant' ? 'bg-slate-50 text-slate-800' : 'bg-sky-50 text-sky-950'}`}
              >
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {turn.role === 'assistant' ? 'Examiner' : 'You'}
                </div>
                <div className="whitespace-pre-wrap">{turn.content}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    const packet = questionPackets.find((item) => item.question_key === block.questionKey);
    const questionResult = block.questionKey ? questionResultMap.get(block.questionKey) : undefined;
    if (!packet || !questionResult) {
      return null;
    }

    return (
      <QuestionResultCard
        packet={packet}
        result={questionResult}
        answerText={result.answers[packet.question_key] ?? ''}
      />
    );
  };

  return (
    <div className="secondary-result-page">
      <PrintConfigModal
        isOpen={isPrintConfigOpen}
        blocks={printBlocks}
        onClose={() => setIsPrintConfigOpen(false)}
        onToggleInclude={(id, include) => setPrintBlocks((current) => current.map((item) => (item.id === id ? { ...item, include } : item)))}
        onPlacementChange={(id, placement) => setPrintBlocks((current) => current.map((item) => (item.id === id ? { ...item, placement } : item)))}
        onMove={(index, direction) => setPrintBlocks((current) => moveBlock(current, index, direction))}
        onReset={() => setPrintBlocks(defaultPrintBlocks)}
        onPrint={handlePrintReview}
      />

      <div className="secondary-result-screen space-y-6">
      <section className="secondary-result-hero rounded-[2rem] bg-gradient-to-br from-[#0f172a] via-[#12355b] to-[#1d4f91] p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200">Scoring Result</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">{detail.bundle.year_label} 事例{detail.bundle.case_no} 採点結果</h2>
            <p className="mt-3 text-sm leading-7 text-sky-100">
              問題文PDFは表示せず、提出答案とAI採点内容を設問ごとに振り返れます。
            </p>
          </div>
          <div className="print-hidden flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate(`/secondary-exam/results/${result.attempt_id}/explanations`)}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15"
            >
              解説ページへ
            </button>
            <button
              type="button"
              onClick={() => setIsPrintConfigOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-200"
            >
              印刷構成を調整
            </button>
            <button
              type="button"
              onClick={() => navigate(`/secondary-exam?view=dashboard&year=${detail.bundle.year_label}&case=${detail.bundle.case_no}`)}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15"
            >
              <BarChartIcon className="h-4 w-4" />
              管理画面へ戻る
            </button>
            <button
              type="button"
              onClick={() => navigate(`/secondary-exam?view=practice&year=${detail.bundle.year_label}&case=${detail.bundle.case_no}`)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              <PencilIcon className="h-4 w-4" />
              新規で演習する
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="secondary-result-summary rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Summary</div>
            <h3 className="mt-1 text-2xl font-semibold text-slate-900">
              総合 {formatPoints(result.overall_score)} / {formatPoints(result.total_possible_score)}点
            </h3>
            <div className="mt-1 text-sm font-semibold text-sky-700">{result.overall_percentage}%</div>
            <p className="mt-2 text-sm leading-7 text-slate-600">{result.overall_feedback.summary}</p>
          </div>
          <div className="rounded-3xl bg-slate-900 px-5 py-4 text-white">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Scored At</div>
            <div className="mt-2 text-sm font-semibold">{formatDateTime(result.scored_at)}</div>
            <div className="mt-1 text-xs text-slate-300">
              {result.cached ? '同一答案のキャッシュ結果' : result.overall_feedback.used_ai ? 'AI採点を使用' : 'ローカル評価を使用'}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {result.overall_feedback.priority_actions.map((item) => (
            <span key={item} className="rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{item}</span>
          ))}
        </div>
      </section>

      {resultHistory.length > 0 ? (
        <section className="print-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Score History</div>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">履歴ごとの振り返り</h3>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              {resultHistory.length}件
            </div>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3">
              {resultHistory.map((attempt) => (
                <AttemptHistoryCard
                  key={attempt.attempt_id}
                  attempt={attempt}
                  selected={attempt.attempt_id === selectedHistoryAttempt?.attempt_id}
                  onSelect={setSelectedHistoryAttemptId}
                />
              ))}
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              左の履歴を選ぶと、その回の回答内容とAI採点結果をこのページで切り替えて確認できます。
            </div>
          </div>
        </section>
      ) : null}

      <section className="secondary-result-question-list space-y-4">
        {questionPackets.map((packet) => (
          <QuestionResultCard
            key={`${result.attempt_id}-${packet.question_key ?? 'unknown-question'}`}
            packet={packet}
            result={result.question_results.find((item) => item.question_key === packet.question_key)}
            answerText={result.answers[packet.question_key] ?? ''}
          />
        ))}
      </section>

      <section className="print-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Case Oral Viva</div>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">採点後の口頭試問Q&A</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              この採点結果を前提に、設問横断の確認や書き直しポイントを深掘りできます。
            </p>
          </div>
          <div className="rounded-2xl bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-600">
            対象結果: {formatDateTime(result.scored_at)}
          </div>
        </div>

        {oralVivaCitedQuestionKeys.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {oralVivaCitedQuestionKeys.map((questionKey) => (
              <span
                key={questionKey}
                className="rounded-full bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700"
              >
                関連設問 {questionKey}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          {oralVivaConversation.length > 0 ? (
            oralVivaConversation.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                  turn.role === 'assistant' ? 'bg-slate-50 text-slate-800' : 'bg-sky-50 text-sky-950'
                }`}
              >
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {turn.role === 'assistant' ? 'Examiner' : 'You'}
                </div>
                <div className="whitespace-pre-wrap">{turn.content}</div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
              例: 「設問1と設問2で一貫して言うべき強みは？」「今回の答案で最優先の書き直しポイントは？」
            </div>
          )}
        </div>

        {oralVivaSuggestedFollowups.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {oralVivaSuggestedFollowups.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void handleAskOralViva(item)}
                disabled={isAskingOralViva}
                className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-5">
          <textarea
            value={oralVivaInput}
            onChange={(event) => setOralVivaInput(event.target.value)}
            placeholder="この採点結果について確認したいことを入力します。"
            className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleAskOralViva()}
              disabled={isAskingOralViva || !oralVivaInput.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isAskingOralViva ? <LoaderIcon className="h-4 w-4 animate-spin" /> : null}
              {isAskingOralViva ? '回答生成中...' : '質問する'}
            </button>
          </div>
        </div>
      </section>
      </div>

      <div className="print-review-layout">
        {orderedPrintBlocks.map((block) => (
          <div
            key={block.id}
            className={`print-review-block print-placement-${block.placement}`}
          >
            {renderPrintBlock(block)}
          </div>
        ))}
      </div>
    </div>
  );
}
