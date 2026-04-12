import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { FileTextIcon, PhotoIcon } from './components/icons';
import SectionHeading from './components/SectionHeading';
import { fetchCustomExplanationLibrary } from './secondaryExam/api';
import type { CustomExplanationLibraryItem } from './secondaryExam/types';
import mplusRegularFontUrl from './assets/fonts/MPLUS1p-Regular.ttf';

function buildMarkdown(items: CustomExplanationLibraryItem[], includeQuestionText: boolean) {
  const lines: string[] = ['# mymemo Export', ''];
  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.subject} / ${item.problem_id}`);
    if (item.category) {
      lines.push(`- カテゴリ: ${item.category}`);
    }
    if (includeQuestionText) {
      lines.push(`- 問題文: ${item.question_text.replace(/\s+/g, ' ').trim()}`);
    }
    lines.push('');
    lines.push(item.custom_explanation.trim() || '（メモ未入力）');
    lines.push('');
  });
  return lines.join('\n');
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type CustomExplanationLibraryView = 'hub' | 'memo' | 'images';

interface CustomExplanationLibraryPageProps {
  view?: CustomExplanationLibraryView;
}

function loadImageSize(imageUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => {
      reject(new Error('画像の読み込みに失敗しました。'));
    };
    image.src = imageUrl;
  });
}

function detectImageFormat(imageUrl: string) {
  const matched = imageUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
  const rawFormat = matched?.[1]?.toUpperCase();
  if (rawFormat === 'JPG') {
    return 'JPEG';
  }
  return rawFormat === 'PNG' || rawFormat === 'JPEG' || rawFormat === 'WEBP' ? rawFormat : 'PNG';
}

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

export default function CustomExplanationLibraryPage({
  view = 'hub',
}: CustomExplanationLibraryPageProps) {
  const [items, setItems] = useState<CustomExplanationLibraryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isExportingImages, setIsExportingImages] = useState(false);
  const [imageExportProgress, setImageExportProgress] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [showQuestionText, setShowQuestionText] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const payload = await fetchCustomExplanationLibrary();
        setItems(payload.items);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'mymemo一覧の取得に失敗しました。');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const availableSubjects = useMemo(
    () => Array.from(new Set(items.map((item) => item.subject))).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  useEffect(() => {
    if (availableSubjects.length === 0) {
      setSelectedSubjects([]);
      return;
    }

    setSelectedSubjects((current) => {
      const next = current.filter((subject) => availableSubjects.includes(subject));
      return next.length > 0 ? next : availableSubjects;
    });
  }, [availableSubjects]);

  const memoItems = useMemo(
    () => items.filter((item) => item.custom_explanation.trim().length > 0),
    [items],
  );

  const filteredMemoItems = useMemo(
    () => memoItems.filter((item) => selectedSubjects.includes(item.subject)),
    [memoItems, selectedSubjects],
  );

  const memoItemsBySubject = useMemo(
    () => selectedSubjects
      .map((subject) => ({
        subject,
        items: filteredMemoItems.filter((item) => item.subject === subject),
      }))
      .filter((group) => group.items.length > 0),
    [filteredMemoItems, selectedSubjects],
  );

  const imageItems = useMemo(
    () => items.flatMap((item) => item.custom_explanation_image_data_urls.map((imageUrl, index) => ({
      key: `${item.problem_id}:${index}`,
      subject: item.subject,
      problemId: item.problem_id,
      questionText: item.question_text,
      imageUrl,
    }))),
    [items],
  );

  const filteredImageItems = useMemo(
    () => imageItems.filter((item) => selectedSubjects.includes(item.subject)),
    [imageItems, selectedSubjects],
  );

  const imageItemsBySubject = useMemo(
    () => selectedSubjects
      .map((subject) => ({
        subject,
        items: filteredImageItems.filter((item) => item.subject === subject),
      }))
      .filter((group) => group.items.length > 0),
    [filteredImageItems, selectedSubjects],
  );

  const toggleSubject = (subject: string) => {
    setSelectedSubjects((current) => (
      current.includes(subject)
        ? current.filter((item) => item !== subject)
        : [...current, subject].sort((a, b) => a.localeCompare(b))
    ));
  };

  const exportImagesAsPdf = async () => {
    if (filteredImageItems.length === 0 || isExportingImages) {
      return;
    }

    setIsExportingImages(true);
    setImageExportProgress('PDFを準備しています...');

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
      const marginX = 10;
      const marginTop = 10;
      const marginBottom = 12;
      const contentWidth = pageWidth - marginX * 2;
      const usableHeight = pageHeight - marginTop - marginBottom;

      for (const [index, item] of filteredImageItems.entries()) {
        if (index > 0) {
          pdf.addPage('a4', 'portrait');
        }

        setImageExportProgress(`PDFを生成中... ${index + 1} / ${filteredImageItems.length}`);

        const titleLines = [`${item.subject} / ${item.problemId}`];
        if (showQuestionText) {
          titleLines.push(...pdf.splitTextToSize(item.questionText, contentWidth));
        }

        pdf.setFontSize(10);

        let cursorY = marginTop;
        titleLines.forEach((line) => {
          pdf.text(line, marginX, cursorY);
          cursorY += 5;
        });

        const imageTop = showQuestionText ? cursorY + 1 : cursorY;
        const { width, height } = await loadImageSize(item.imageUrl);
        const heightScale = (usableHeight - (imageTop - marginTop)) / height;
        const widthScale = contentWidth / width;
        const scale = Math.min(widthScale, heightScale);
        const renderWidth = width * scale;
        const renderHeight = height * scale;

        pdf.addImage(
          item.imageUrl,
          detectImageFormat(item.imageUrl),
          marginX,
          imageTop,
          renderWidth,
          renderHeight,
          undefined,
          'FAST',
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
      }

      pdf.save(`supplement-images-${new Date().toISOString().slice(0, 10)}.pdf`);
      setImageExportProgress('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '補足画像PDFの生成に失敗しました。');
    } finally {
      setIsExportingImages(false);
      setImageExportProgress('');
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const isMemoView = view === 'memo';
  const isImageView = view === 'images';
  const showHubCards = view === 'hub';

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-[#1f2937] via-[#0f766e] to-[#99f6e4] p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Memo Library"
            title={isMemoView ? 'mymemo一覧' : isImageView ? '解説補足画像一覧' : 'mymemo / 解説補足画像'}
            description={
              isMemoView
                ? '保存済みのメモを、科目で絞り込みながら一覧と出力にまとめています。'
                : isImageView
                  ? '保存済みの補足画像を、科目で絞り込みながら一覧と PDF 出力にまとめています。'
                  : '保存済みのメモと補足画像を横断で確認し、そのまま出力できます。'
            }
            titleClassName="text-3xl md:text-4xl text-white"
            className="max-w-3xl"
            toneClassName="text-emerald-100"
          />
          <div className="flex flex-wrap gap-3">
            <Link
              to="/dashboard"
              className="rounded-full border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15"
            >
              ダッシュボードへ戻る
            </Link>
            {isMemoView ? (
              <button
                type="button"
                onClick={() => downloadTextFile('mymemo-export.md', buildMarkdown(filteredMemoItems, showQuestionText), 'text/markdown;charset=utf-8')}
                disabled={filteredMemoItems.length === 0}
                className="rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                mymemoを出力
              </button>
            ) : null}
            {isImageView ? (
              <button
                type="button"
                onClick={() => { void exportImagesAsPdf(); }}
                disabled={filteredImageItems.length === 0 || isExportingImages}
                className="rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExportingImages ? 'PDF生成中...' : '補足画像をPDF出力'}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}
      {isImageView && imageExportProgress ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {imageExportProgress}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Saved Memo</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{filteredMemoItems.length}</div>
          <div className="mt-1 text-sm text-slate-500">選択中科目の mymemo 保存件数</div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Supplement Images</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{filteredImageItems.length}</div>
          <div className="mt-1 text-sm text-slate-500">選択中科目の解説補足画像枚数</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          to="/dashboard/custom-explanations"
          className={`motion-card rounded-3xl border p-5 shadow-sm ${
            showHubCards ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Overview</div>
          <div className="mt-2">
            <div className="heading-2 text-lg font-semibold">一覧トップ</div>
          </div>
          <div className="mt-1 text-sm opacity-80">mymemo と補足画像の入口</div>
        </Link>
        <Link
          to="/dashboard/custom-explanations/memos"
          className={`motion-card rounded-3xl border p-5 shadow-sm ${
            isMemoView ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Memo</div>
          <div className="mt-2">
            <div className="heading-2 text-lg font-semibold">mymemo一覧</div>
          </div>
          <div className="mt-1 text-sm opacity-80">メモだけを表示して出力</div>
        </Link>
        <Link
          to="/dashboard/custom-explanations/images"
          className={`motion-card rounded-3xl border p-5 shadow-sm ${
            isImageView ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Images</div>
          <div className="mt-2">
            <div className="heading-2 text-lg font-semibold">解説補足画像一覧</div>
          </div>
          <div className="mt-1 text-sm opacity-80">画像だけを表示して PDF 出力</div>
        </Link>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Display Control</div>
            <h3 className="heading-2 mt-2 text-lg font-semibold text-slate-900">表示対象の切り替え</h3>
            <p className="mt-1 text-sm text-slate-500">チェックした科目だけを表示し、出力対象にも反映します。</p>
          </div>
          <label className="inline-flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={showQuestionText}
              onChange={(event) => setShowQuestionText(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            問題文を表示する
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {availableSubjects.map((subject) => (
            <label key={subject} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={selectedSubjects.includes(subject)}
                onChange={() => toggleSubject(subject)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
              {subject}
            </label>
          ))}
        </div>
      </section>

      {showHubCards ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <Link to="/dashboard/custom-explanations/memos" className="motion-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-900 p-3 text-white"><FileTextIcon className="h-5 w-5" /></div>
              <div>
                <h3 className="heading-2 text-xl font-semibold text-slate-900">mymemo一覧へ</h3>
                <p className="text-sm text-slate-500">長文メモだけをまとめて確認できます。</p>
              </div>
            </div>
            <div className="mt-4 text-sm leading-7 text-slate-600">
              選択中科目の保存メモは <span className="font-semibold text-slate-900">{filteredMemoItems.length} 件</span> です。
            </div>
            <div className="mt-6 inline-flex items-center text-sm font-semibold text-slate-900">
              <span className="motion-button-text">mymemo一覧へ進む</span>
            </div>
          </Link>
          <Link to="/dashboard/custom-explanations/images" className="motion-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-sky-600 p-3 text-white"><PhotoIcon className="h-5 w-5" /></div>
              <div>
                <h3 className="heading-2 text-xl font-semibold text-slate-900">解説補足画像一覧へ</h3>
                <p className="text-sm text-slate-500">画像だけを見ながら PDF 出力できます。</p>
              </div>
            </div>
            <div className="mt-4 text-sm leading-7 text-slate-600">
              選択中科目の補足画像は <span className="font-semibold text-slate-900">{filteredImageItems.length} 枚</span> です。
            </div>
            <div className="mt-6 inline-flex items-center text-sm font-semibold text-sky-700">
              <span className="motion-button-text">補足画像一覧へ進む</span>
            </div>
          </Link>
        </section>
      ) : null}

      {isMemoView ? (
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-900 p-3 text-white"><FileTextIcon className="h-5 w-5" /></div>
          <div>
            <h3 className="heading-2 text-xl font-semibold text-slate-900">mymemo一覧</h3>
            <p className="text-sm text-slate-500">保存済みのメモだけをまとめています。</p>
          </div>
        </div>
        {filteredMemoItems.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            選択中の科目に保存済みの mymemo はありません。
          </div>
        ) : (
          memoItemsBySubject.map((group) => (
            <section key={`memo:${group.subject}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Subject</div>
                  <h4 className="heading-2 mt-1 text-lg font-semibold text-slate-900">{group.subject}</h4>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  {group.items.length}件
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {group.items.map((item) => (
                  <article key={`${item.subject}:${item.problem_id}`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      <span>{item.problem_id}</span>
                      {item.category ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600 normal-case tracking-normal">{item.category}</span> : null}
                    </div>
                    {showQuestionText ? (
                      <h4 className="mt-3 text-lg font-semibold leading-8 text-slate-900">{item.question_text}</h4>
                    ) : null}
                    <div className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700">
                      {item.custom_explanation}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </section>
      ) : null}

      {isImageView ? (
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-sky-600 p-3 text-white"><PhotoIcon className="h-5 w-5" /></div>
          <div>
            <h3 className="heading-2 text-xl font-semibold text-slate-900">解説補足画像一覧</h3>
            <p className="text-sm text-slate-500">PDF出力時は画像をページ上部から順に配置します。</p>
          </div>
        </div>
        {filteredImageItems.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            選択中の科目に保存済みの解説補足画像はありません。
          </div>
        ) : (
          imageItemsBySubject.map((group) => (
            <section key={`image:${group.subject}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Subject</div>
                  <h4 className="heading-2 mt-1 text-lg font-semibold text-slate-900">{group.subject}</h4>
                </div>
                <div className="rounded-full bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-700">
                  {group.items.length}枚
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {group.items.map((item) => (
                  <article key={item.key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{item.problemId}</div>
                    {showQuestionText ? (
                      <div className="mt-2 text-sm font-semibold leading-7 text-slate-900">{item.questionText}</div>
                    ) : null}
                    <img
                      src={item.imageUrl}
                      alt={`${item.problemId} supplement`}
                      loading="lazy"
                      decoding="async"
                      className={`${showQuestionText ? 'mt-4' : 'mt-3'} w-full rounded-2xl border border-slate-200 bg-slate-50 object-contain`}
                    />
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </section>
      ) : null}

    </div>
  );
}
