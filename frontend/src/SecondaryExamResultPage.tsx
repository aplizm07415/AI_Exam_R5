import React, { useEffect, useMemo, useState } from 'react';
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
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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
    </div>
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
  const [error, setError] = useState('');

  const questionPackets = detail?.bundle.normalized_scoring_input.question_prompt_packets ?? [];
  const resultHistory = detail?.result_history ?? [];
  const selectedHistoryAttempt = useMemo(
    () => resultHistory.find((item) => item.attempt_id === selectedHistoryAttemptId) ?? null,
    [resultHistory, selectedHistoryAttemptId],
  );

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

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-[#0f172a] via-[#12355b] to-[#1d4f91] p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200">Scoring Result</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">{detail.bundle.year_label} 事例{detail.bundle.case_no} 採点結果</h2>
            <p className="mt-3 text-sm leading-7 text-sky-100">
              問題文PDFは表示せず、提出答案とAI採点内容を設問ごとに振り返れます。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
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

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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

      <section className="space-y-4">
        {questionPackets.map((packet) => (
          <QuestionResultCard
            key={`${result.attempt_id}-${packet.question_key}`}
            packet={packet}
            result={result.question_results.find((item) => item.question_key === packet.question_key)}
            answerText={result.answers[packet.question_key] ?? ''}
          />
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
  );
}
