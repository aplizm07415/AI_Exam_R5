import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { PencilIcon } from './components/icons';
import { fetchSecondaryExamDetail, fetchSecondaryExamResult } from './secondaryExam/api';
import type {
  SecondaryExamDetailResponse,
  SecondaryGradeResult,
  SecondaryQuestionPromptPacket,
} from './secondaryExam/types';

type StructuredBlock =
  | { kind: 'heading'; content: string }
  | { kind: 'paragraph'; content: string };

function normalizeOcrText(value: string) {
  const blocks = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      const compact = line.replace(/\s+/g, '');
      if (!compact) {
        return true;
      }
      if (/^[\-－]?\d+[\-－]?$/.test(compact)) {
        return false;
      }
      if (/^事例[ⅠⅡⅢⅣ1-4]+$/.test(compact)) {
        return false;
      }
      if (/^(事|例|[ⅠⅡⅢⅣ])$/.test(compact)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .split(/\n{2,}/)
    .map((block) => block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/([一-龠ぁ-んァ-ヶー々〇Ａ-Ｚａ-ｚ０-９ⅠⅡⅢⅣ])\s+(?=[一-龠ぁ-んァ-ヶー々〇Ａ-Ｚａ-ｚ０-９ⅠⅡⅢⅣ])/g, '$1')
      .replace(/\s+([、。）」』】％])+/g, '$1')
      .replace(/([（「『【])\s+/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean);

  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(（設問\s*\d+）)/g, '\n\n$1\n')
    .replace(/([（(][1-4][)）]\s*[^\n]+)/g, '\n\n$1\n')
    .replace(/(●[^\n]+)/g, '\n\n$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatRichText(value: unknown) {
  if (typeof value === 'string') {
    return normalizeOcrText(value);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${typeof item === 'string' ? normalizeOcrText(item) : JSON.stringify(item)}`)
      .join('\n');
  }
  return '';
}

function parseStructuredBlocks(content: string): StructuredBlock[] {
  return content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^(（設問\s*\d+）|[（(][1-4][)）]\s*.+|●.+)$/.test(block)) {
        return { kind: 'heading', content: block } as StructuredBlock;
      }
      return { kind: 'paragraph', content: block } as StructuredBlock;
    });
}

function getChecklistItems(packet: SecondaryQuestionPromptPacket) {
  const rubricCandidates = Array.isArray(packet.rubric_candidates) ? packet.rubric_candidates : [];
  return rubricCandidates.flatMap((item) => item.checklist_items ?? []);
}

function findRubricForPacket(detail: SecondaryExamDetailResponse, packet: SecondaryQuestionPromptPacket) {
  const rubrics = detail.bundle.rubrics ?? [];
  return rubrics.find((item) => String(item.question_no ?? item.question ?? '') === String(packet.question_no))
    ?? rubrics.find((item) => typeof item.question === 'string' && item.question.includes(String(packet.question_no)));
}

function findExplanationForPacket(detail: SecondaryExamDetailResponse, packet: SecondaryQuestionPromptPacket) {
  const explanations = detail.bundle.explanations ?? [];
  return explanations.find((item) => String(item.question_no ?? '') === String(packet.question_no));
}

function ExplanationSection({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  if (!content.trim()) {
    return null;
  }

  const blocks = parseStructuredBlocks(content);
  return (
    <section className="rounded-2xl bg-slate-50 px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</div>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-700">
        {blocks.map((block, index) => (
          block.kind === 'heading' ? (
            <div key={`${title}:${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-900">
              {block.content}
            </div>
          ) : (
            <p key={`${title}:${index}`} className="whitespace-pre-wrap">
              {block.content}
            </p>
          )
        ))}
      </div>
    </section>
  );
}

function ChecklistSection({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl bg-amber-50 px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">採点観点</div>
      <ul className="mt-2 space-y-2 text-sm leading-7 text-slate-700">
        {items.map((item) => (
          <li key={item} className="rounded-xl bg-white/70 px-3 py-2">{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default function SecondaryExamExplanationPage() {
  const navigate = useNavigate();
  const { attemptId } = useParams<{ attemptId: string }>();
  const [detail, setDetail] = useState<SecondaryExamDetailResponse | null>(null);
  const [result, setResult] = useState<SecondaryGradeResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

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
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '解説ページの読み込みに失敗しました。');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [attemptId]);

  const explanationCards = useMemo(() => {
    if (!detail) {
      return [];
    }

    const packets = detail.bundle.normalized_scoring_input?.question_prompt_packets ?? [];
    return packets.map((packet) => {
      const rubric = findRubricForPacket(detail, packet);
      const explanation = findExplanationForPacket(detail, packet);
      const checklistItems = [
        ...((rubric?.採点観点 ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)),
        ...getChecklistItems(packet),
        ...((packet.calculation_breakdown?.scoring_checkpoints ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)),
      ];

      return {
        packet,
        modelAnswer: formatRichText(rubric?.模範解答) || formatRichText(explanation?.answer_example_text),
        explanationText:
          formatRichText(rubric?.解説)
          || [explanation?.positioning_text, explanation?.solution_text, explanation?.difficulty_text]
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .join('\n\n')
          || (typeof packet.explanation_candidate === 'string' ? packet.explanation_candidate.trim() : ''),
        checklistItems: Array.from(new Set(checklistItems)),
      };
    }).filter((item) => item.modelAnswer || item.explanationText || item.checklistItems.length > 0);
  }, [detail]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error && !detail) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  }

  if (!detail || !result) {
    return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">解説ページを表示できませんでした。</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-[#172554] via-[#1d4ed8] to-[#60a5fa] p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-100">Explanations</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">{detail.bundle.year_label} 事例{detail.bundle.case_no} 解説・採点観点</h2>
            <p className="mt-3 text-sm leading-7 text-sky-50">
              模範解答、設問別の解説、採点観点をまとめて確認できます。採点結果とは分離して復習用に読めるページです。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate(`/secondary-exam/results/${result.attempt_id}`)}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15"
            >
              <PencilIcon className="h-4 w-4" />
              採点結果へ戻る
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {explanationCards.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          利用可能な解説データが見つかりませんでした。
        </div>
      ) : (
        <>
          <section className="sticky top-16 z-10 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Question Jump</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {explanationCards.map(({ packet }) => (
                <button
                  key={`jump:${packet.question_key}`}
                  type="button"
                  onClick={() => document.getElementById(`explanation-${packet.question_key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                >
                  {packet.question_key}
                </button>
              ))}
            </div>
          </section>

          {explanationCards.map(({ packet, modelAnswer, explanationText, checklistItems }) => (
            <article id={`explanation-${packet.question_key}`} key={packet.question_key} className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{packet.question_key}</div>
                  <h3 className="mt-1 text-xl font-semibold leading-8 text-slate-900">{formatRichText(packet.prompt_text_clean)}</h3>
                </div>
                <div className="rounded-2xl bg-slate-900 px-3 py-2 text-right text-white">
                  <div className="text-sm font-semibold">解説</div>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <ExplanationSection title="模範解答" content={modelAnswer} />
                <ExplanationSection title="整理済み解説" content={explanationText} />
                <ChecklistSection items={checklistItems.map((item) => normalizeOcrText(item))} />
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
