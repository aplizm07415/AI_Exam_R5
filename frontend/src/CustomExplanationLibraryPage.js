import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { FileTextIcon, PhotoIcon } from './components/icons';
import SectionHeading from './components/SectionHeading';
import { fetchCustomExplanationLibrary } from './secondaryExam/api';
import mplusRegularFontUrl from './assets/fonts/MPLUS1p-Regular.ttf';
function getLibraryItemSortTime(createdAt, updatedAt) {
    const candidate = createdAt || updatedAt;
    if (!candidate) {
        return 0;
    }
    const parsed = Date.parse(candidate);
    return Number.isNaN(parsed) ? 0 : parsed;
}
function sortLibraryItems(items, sortMode) {
    const sorted = [...items];
    sorted.sort((a, b) => {
        if (sortMode === 'created_desc') {
            const timeDiff = getLibraryItemSortTime(b.created_at, b.updated_at) - getLibraryItemSortTime(a.created_at, a.updated_at);
            if (timeDiff !== 0) {
                return timeDiff;
            }
        }
        const subjectDiff = a.subject.localeCompare(b.subject);
        if (subjectDiff !== 0) {
            return subjectDiff;
        }
        return a.problem_id.localeCompare(b.problem_id);
    });
    return sorted;
}
function buildMarkdown(items, includeQuestionText) {
    const lines = ['# mymemo Export', ''];
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
function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}
function loadImageSize(imageUrl) {
    return new Promise((resolve, reject) => {
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
function detectImageFormat(imageUrl) {
    const matched = imageUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
    const rawFormat = matched?.[1]?.toUpperCase();
    if (rawFormat === 'JPG') {
        return 'JPEG';
    }
    return rawFormat === 'PNG' || rawFormat === 'JPEG' || rawFormat === 'WEBP' ? rawFormat : 'PNG';
}
const PDF_FONT_FILE_NAME = 'MPLUS1p-Regular.ttf';
const PDF_FONT_NAME = 'MPLUS1p';
let pdfFontBinaryStringPromise = null;
function arrayBufferToBinaryString(buffer) {
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
export default function CustomExplanationLibraryPage({ view = 'hub', }) {
    const [items, setItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [isExportingImages, setIsExportingImages] = useState(false);
    const [imageExportProgress, setImageExportProgress] = useState('');
    const [selectedSubjects, setSelectedSubjects] = useState([]);
    const [showQuestionText, setShowQuestionText] = useState(true);
    const [sortMode, setSortMode] = useState('subject');
    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            setError('');
            try {
                const payload = await fetchCustomExplanationLibrary();
                setItems(payload.items);
            }
            catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : 'mymemo一覧の取得に失敗しました。');
            }
            finally {
                setIsLoading(false);
            }
        };
        void load();
    }, []);
    const availableSubjects = useMemo(() => Array.from(new Set(items.map((item) => item.subject))).sort((a, b) => a.localeCompare(b)), [items]);
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
    const memoItems = useMemo(() => items.filter((item) => item.custom_explanation.trim().length > 0), [items]);
    const filteredMemoItems = useMemo(() => {
        const filtered = memoItems.filter((item) => selectedSubjects.includes(item.subject));
        return sortLibraryItems(filtered, sortMode);
    }, [memoItems, selectedSubjects, sortMode]);
    const memoItemsBySubject = useMemo(() => {
        const groups = selectedSubjects
            .map((subject) => ({
            subject,
            items: filteredMemoItems.filter((item) => item.subject === subject),
        }))
            .filter((group) => group.items.length > 0);
        if (sortMode === 'created_desc') {
            groups.sort((a, b) => (getLibraryItemSortTime(b.items[0]?.created_at, b.items[0]?.updated_at)
                - getLibraryItemSortTime(a.items[0]?.created_at, a.items[0]?.updated_at)));
        }
        return groups;
    }, [filteredMemoItems, selectedSubjects, sortMode]);
    const imageItems = useMemo(() => items.flatMap((item) => item.custom_explanation_image_data_urls.map((imageUrl, index) => ({
        key: `${item.problem_id}:${index}`,
        subject: item.subject,
        problemId: item.problem_id,
        questionText: item.question_text,
        imageUrl,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
    }))), [items]);
    const filteredImageItems = useMemo(() => {
        const filtered = imageItems.filter((item) => selectedSubjects.includes(item.subject));
        return [...filtered].sort((a, b) => {
            if (sortMode === 'created_desc') {
                const timeDiff = getLibraryItemSortTime(b.createdAt, b.updatedAt)
                    - getLibraryItemSortTime(a.createdAt, a.updatedAt);
                if (timeDiff !== 0) {
                    return timeDiff;
                }
            }
            const subjectDiff = a.subject.localeCompare(b.subject);
            if (subjectDiff !== 0) {
                return subjectDiff;
            }
            return a.key.localeCompare(b.key);
        });
    }, [imageItems, selectedSubjects, sortMode]);
    const imageItemsBySubject = useMemo(() => {
        const groups = selectedSubjects
            .map((subject) => ({
            subject,
            items: filteredImageItems.filter((item) => item.subject === subject),
        }))
            .filter((group) => group.items.length > 0);
        if (sortMode === 'created_desc') {
            groups.sort((a, b) => (getLibraryItemSortTime(b.items[0]?.createdAt ?? null, b.items[0]?.updatedAt ?? null)
                - getLibraryItemSortTime(a.items[0]?.createdAt ?? null, a.items[0]?.updatedAt ?? null)));
        }
        return groups;
    }, [filteredImageItems, selectedSubjects, sortMode]);
    const toggleSubject = (subject) => {
        setSelectedSubjects((current) => (current.includes(subject)
            ? current.filter((item) => item !== subject)
            : [...current, subject].sort((a, b) => a.localeCompare(b))));
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
                pdf.addImage(item.imageUrl, detectImageFormat(item.imageUrl), marginX, imageTop, renderWidth, renderHeight, undefined, 'FAST');
                await new Promise((resolve) => {
                    window.setTimeout(resolve, 0);
                });
            }
            pdf.save(`supplement-images-${new Date().toISOString().slice(0, 10)}.pdf`);
            setImageExportProgress('');
        }
        catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : '補足画像PDFの生成に失敗しました。');
        }
        finally {
            setIsExportingImages(false);
            setImageExportProgress('');
        }
    };
    if (isLoading) {
        return _jsx(LoadingSpinner, {});
    }
    const isMemoView = view === 'memo';
    const isImageView = view === 'images';
    const showHubCards = view === 'hub';
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("section", { className: "rounded-[2rem] bg-gradient-to-br from-[#1f2937] via-[#0f766e] to-[#99f6e4] p-6 text-white shadow-xl md:p-8", children: _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", children: [_jsx(SectionHeading, { eyebrow: "Memo Library", title: isMemoView ? 'mymemo一覧' : isImageView ? '解説補足画像一覧' : 'mymemo / 解説補足画像', description: isMemoView
                                ? '保存済みのメモを、科目で絞り込みながら一覧と出力にまとめています。'
                                : isImageView
                                    ? '保存済みの補足画像を、科目で絞り込みながら一覧と PDF 出力にまとめています。'
                                    : '保存済みのメモと補足画像を横断で確認し、そのまま出力できます。', titleClassName: "text-3xl md:text-4xl text-white", className: "max-w-3xl", toneClassName: "text-emerald-100" }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Link, { to: "/dashboard", className: "rounded-full border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15", children: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u3078\u623B\u308B" }), isMemoView ? (_jsx("button", { type: "button", onClick: () => downloadTextFile('mymemo-export.md', buildMarkdown(filteredMemoItems, showQuestionText), 'text/markdown;charset=utf-8'), disabled: filteredMemoItems.length === 0, className: "rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60", children: "mymemo\u3092\u51FA\u529B" })) : null, isImageView ? (_jsx("button", { type: "button", onClick: () => { void exportImagesAsPdf(); }, disabled: filteredImageItems.length === 0 || isExportingImages, className: "rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60", children: isExportingImages ? 'PDF生成中...' : '補足画像をPDF出力' })) : null] })] }) }), error ? (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })) : null, isImageView && imageExportProgress ? (_jsx("div", { className: "rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800", children: imageExportProgress })) : null, _jsxs("section", { className: "grid gap-4 md:grid-cols-2", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Saved Memo" }), _jsx("div", { className: "mt-2 text-3xl font-bold text-slate-900", children: filteredMemoItems.length }), _jsx("div", { className: "mt-1 text-sm text-slate-500", children: "\u9078\u629E\u4E2D\u79D1\u76EE\u306E mymemo \u4FDD\u5B58\u4EF6\u6570" })] }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Supplement Images" }), _jsx("div", { className: "mt-2 text-3xl font-bold text-slate-900", children: filteredImageItems.length }), _jsx("div", { className: "mt-1 text-sm text-slate-500", children: "\u9078\u629E\u4E2D\u79D1\u76EE\u306E\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u679A\u6570" })] })] }), _jsxs("section", { className: "grid gap-4 md:grid-cols-3", children: [_jsxs(Link, { to: "/dashboard/custom-explanations", className: `motion-card rounded-3xl border p-5 shadow-sm ${showHubCards ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'}`, children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] opacity-70", children: "Overview" }), _jsx("div", { className: "mt-2", children: _jsx("div", { className: "heading-2 text-lg font-semibold", children: "\u4E00\u89A7\u30C8\u30C3\u30D7" }) }), _jsx("div", { className: "mt-1 text-sm opacity-80", children: "mymemo \u3068\u88DC\u8DB3\u753B\u50CF\u306E\u5165\u53E3" })] }), _jsxs(Link, { to: "/dashboard/custom-explanations/memos", className: `motion-card rounded-3xl border p-5 shadow-sm ${isMemoView ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'}`, children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] opacity-70", children: "Memo" }), _jsx("div", { className: "mt-2", children: _jsx("div", { className: "heading-2 text-lg font-semibold", children: "mymemo\u4E00\u89A7" }) }), _jsx("div", { className: "mt-1 text-sm opacity-80", children: "\u30E1\u30E2\u3060\u3051\u3092\u8868\u793A\u3057\u3066\u51FA\u529B" })] }), _jsxs(Link, { to: "/dashboard/custom-explanations/images", className: `motion-card rounded-3xl border p-5 shadow-sm ${isImageView ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-200 bg-white text-slate-900'}`, children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] opacity-70", children: "Images" }), _jsx("div", { className: "mt-2", children: _jsx("div", { className: "heading-2 text-lg font-semibold", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u4E00\u89A7" }) }), _jsx("div", { className: "mt-1 text-sm opacity-80", children: "\u753B\u50CF\u3060\u3051\u3092\u8868\u793A\u3057\u3066 PDF \u51FA\u529B" })] })] }), _jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Display Control" }), _jsx("h3", { className: "heading-2 mt-2 text-lg font-semibold text-slate-900", children: "\u8868\u793A\u5BFE\u8C61\u306E\u5207\u308A\u66FF\u3048" }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: "\u30C1\u30A7\u30C3\u30AF\u3057\u305F\u79D1\u76EE\u3060\u3051\u3092\u8868\u793A\u3057\u3001\u51FA\u529B\u5BFE\u8C61\u306B\u3082\u53CD\u6620\u3057\u307E\u3059\u3002" })] }), _jsxs("label", { className: "inline-flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700", children: [_jsx("input", { type: "checkbox", checked: showQuestionText, onChange: (event) => setShowQuestionText(event.target.checked), className: "h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400" }), "\u554F\u984C\u6587\u3092\u8868\u793A\u3059\u308B"] })] }), _jsxs("div", { className: "mt-4 flex flex-wrap items-center gap-3", children: [_jsx("div", { className: "heading-2 text-sm font-semibold text-slate-900", children: "\u4E26\u3073\u9806" }), _jsx("button", { type: "button", onClick: () => setSortMode('subject'), className: `rounded-full px-4 py-2 text-sm font-semibold transition ${sortMode === 'subject'
                                    ? 'bg-slate-900 text-white'
                                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`, children: "\u79D1\u76EE\u9806" }), _jsx("button", { type: "button", onClick: () => setSortMode('created_desc'), className: `rounded-full px-4 py-2 text-sm font-semibold transition ${sortMode === 'created_desc'
                                    ? 'bg-slate-900 text-white'
                                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`, children: "\u8FFD\u52A0\u9806" })] }), _jsx("div", { className: "mt-4 flex flex-wrap gap-3", children: availableSubjects.map((subject) => (_jsxs("label", { className: "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700", children: [_jsx("input", { type: "checkbox", checked: selectedSubjects.includes(subject), onChange: () => toggleSubject(subject), className: "h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400" }), subject] }, subject))) })] }), showHubCards ? (_jsxs("section", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs(Link, { to: "/dashboard/custom-explanations/memos", className: "motion-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "rounded-2xl bg-slate-900 p-3 text-white", children: _jsx(FileTextIcon, { className: "h-5 w-5" }) }), _jsxs("div", { children: [_jsx("h3", { className: "heading-2 text-xl font-semibold text-slate-900", children: "mymemo\u4E00\u89A7\u3078" }), _jsx("p", { className: "text-sm text-slate-500", children: "\u9577\u6587\u30E1\u30E2\u3060\u3051\u3092\u307E\u3068\u3081\u3066\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002" })] })] }), _jsxs("div", { className: "mt-4 text-sm leading-7 text-slate-600", children: ["\u9078\u629E\u4E2D\u79D1\u76EE\u306E\u4FDD\u5B58\u30E1\u30E2\u306F ", _jsxs("span", { className: "font-semibold text-slate-900", children: [filteredMemoItems.length, " \u4EF6"] }), " \u3067\u3059\u3002"] }), _jsx("div", { className: "mt-6 inline-flex items-center text-sm font-semibold text-slate-900", children: _jsx("span", { className: "motion-button-text", children: "mymemo\u4E00\u89A7\u3078\u9032\u3080" }) })] }), _jsxs(Link, { to: "/dashboard/custom-explanations/images", className: "motion-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "rounded-2xl bg-sky-600 p-3 text-white", children: _jsx(PhotoIcon, { className: "h-5 w-5" }) }), _jsxs("div", { children: [_jsx("h3", { className: "heading-2 text-xl font-semibold text-slate-900", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u4E00\u89A7\u3078" }), _jsx("p", { className: "text-sm text-slate-500", children: "\u753B\u50CF\u3060\u3051\u3092\u898B\u306A\u304C\u3089 PDF \u51FA\u529B\u3067\u304D\u307E\u3059\u3002" })] })] }), _jsxs("div", { className: "mt-4 text-sm leading-7 text-slate-600", children: ["\u9078\u629E\u4E2D\u79D1\u76EE\u306E\u88DC\u8DB3\u753B\u50CF\u306F ", _jsxs("span", { className: "font-semibold text-slate-900", children: [filteredImageItems.length, " \u679A"] }), " \u3067\u3059\u3002"] }), _jsx("div", { className: "mt-6 inline-flex items-center text-sm font-semibold text-sky-700", children: _jsx("span", { className: "motion-button-text", children: "\u88DC\u8DB3\u753B\u50CF\u4E00\u89A7\u3078\u9032\u3080" }) })] })] })) : null, isMemoView ? (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "rounded-2xl bg-slate-900 p-3 text-white", children: _jsx(FileTextIcon, { className: "h-5 w-5" }) }), _jsxs("div", { children: [_jsx("h3", { className: "heading-2 text-xl font-semibold text-slate-900", children: "mymemo\u4E00\u89A7" }), _jsx("p", { className: "text-sm text-slate-500", children: "\u4FDD\u5B58\u6E08\u307F\u306E\u30E1\u30E2\u3060\u3051\u3092\u307E\u3068\u3081\u3066\u3044\u307E\u3059\u3002" })] })] }), filteredMemoItems.length === 0 ? (_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm", children: "\u9078\u629E\u4E2D\u306E\u79D1\u76EE\u306B\u4FDD\u5B58\u6E08\u307F\u306E mymemo \u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (memoItemsBySubject.map((group) => (_jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-3 border-b border-slate-100 pb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Subject" }), _jsx("h4", { className: "heading-2 mt-1 text-lg font-semibold text-slate-900", children: group.subject })] }), _jsxs("div", { className: "rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600", children: [group.items.length, "\u4EF6"] })] }), _jsx("div", { className: "mt-4 space-y-4", children: group.items.map((item) => (_jsxs("article", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: [_jsx("span", { children: item.problem_id }), item.category ? _jsx("span", { className: "rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600 normal-case tracking-normal", children: item.category }) : null] }), showQuestionText ? (_jsx("h4", { className: "mt-3 text-lg font-semibold leading-8 text-slate-900", children: item.question_text })) : null, _jsx("div", { className: "mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700", children: item.custom_explanation })] }, `${item.subject}:${item.problem_id}`))) })] }, `memo:${group.subject}`))))] })) : null, isImageView ? (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "rounded-2xl bg-sky-600 p-3 text-white", children: _jsx(PhotoIcon, { className: "h-5 w-5" }) }), _jsxs("div", { children: [_jsx("h3", { className: "heading-2 text-xl font-semibold text-slate-900", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u4E00\u89A7" }), _jsx("p", { className: "text-sm text-slate-500", children: "PDF\u51FA\u529B\u6642\u306F\u753B\u50CF\u3092\u30DA\u30FC\u30B8\u4E0A\u90E8\u304B\u3089\u9806\u306B\u914D\u7F6E\u3057\u307E\u3059\u3002" })] })] }), filteredImageItems.length === 0 ? (_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm", children: "\u9078\u629E\u4E2D\u306E\u79D1\u76EE\u306B\u4FDD\u5B58\u6E08\u307F\u306E\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (imageItemsBySubject.map((group) => (_jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-3 border-b border-slate-100 pb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Subject" }), _jsx("h4", { className: "heading-2 mt-1 text-lg font-semibold text-slate-900", children: group.subject })] }), _jsxs("div", { className: "rounded-full bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-700", children: [group.items.length, "\u679A"] })] }), _jsx("div", { className: "mt-4 grid gap-4 lg:grid-cols-2", children: group.items.map((item) => (_jsxs("article", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: item.problemId }), showQuestionText ? (_jsx("div", { className: "mt-2 text-sm font-semibold leading-7 text-slate-900", children: item.questionText })) : null, _jsx("img", { src: item.imageUrl, alt: `${item.problemId} supplement`, loading: "lazy", decoding: "async", className: `${showQuestionText ? 'mt-4' : 'mt-3'} w-full rounded-2xl border border-slate-200 bg-slate-50 object-contain` })] }, item.key))) })] }, `image:${group.subject}`))))] })) : null] }));
}
//# sourceMappingURL=CustomExplanationLibraryPage.js.map