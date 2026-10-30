import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import { formatDateTimeJst, getTodayYmdJst } from './utils/date';
const PEN_COLORS = ['#111111', '#1d4ed8', '#0F52BA', '#dc2626', '#059669', '#7c3aed'];
const PEN_WIDTH = 1.3;
const CANVAS_LOGICAL_WIDTH = 2048;
const CANVAS_LOGICAL_HEIGHT = 1536;
const useCurrentDate = () => getTodayYmdJst();
const formatSavedAt = (savedAt) => {
    return formatDateTimeJst(savedAt);
};
export default function SoragakiPage() {
    const today = useCurrentDate();
    const [learningDate, setLearningDate] = useState(today);
    const [isDeviceAllowed, setIsDeviceAllowed] = useState(false);
    const [memos, setMemos] = useState('');
    const [keywords, setKeywords] = useState([]);
    const [isMemoLoading, setIsMemoLoading] = useState(false);
    const [records, setRecords] = useState([]);
    const [selectedRecordId, setSelectedRecordId] = useState(null);
    const [selectedRecordPages, setSelectedRecordPages] = useState([]);
    const [isRecordLoading, setIsRecordLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
    const [loginToken, setLoginToken] = useState('');
    const [pageNumbers, setPageNumbers] = useState([1]);
    const [currentPage, setCurrentPage] = useState(1);
    const [cacheVersion, setCacheVersion] = useState(0);
    const [penColor, setPenColor] = useState('#0F52BA');
    const [isDrawing, setIsDrawing] = useState(false);
    const activePointerIdRef = useRef(null);
    const pageCacheRef = useRef({ 1: null });
    const canvasRef = useRef(null);
    const authFetch = useCallback((input, init = {}) => {
        return fetch(input, {
            ...init,
            credentials: 'include',
        });
    }, []);
    const handleUnauthorized = useCallback(() => {
        setIsAuthenticated(false);
        setError('セッションの有効期限が切れました。再ログインしてください。');
    }, []);
    const checkSession = useCallback(async () => {
        setIsAuthChecking(true);
        try {
            const response = await authFetch('/api/auth/session');
            setIsAuthenticated(response.ok);
        }
        catch {
            setIsAuthenticated(false);
        }
        finally {
            setIsAuthChecking(false);
        }
    }, [authFetch]);
    const login = useCallback(async () => {
        if (!loginToken.trim())
            return;
        setIsAuthSubmitting(true);
        setError(null);
        try {
            const response = await authFetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: loginToken.trim() }),
            });
            if (!response.ok) {
                throw new Error('ログインに失敗しました。アクセストークンを確認してください。');
            }
            setIsAuthenticated(true);
            setLoginToken('');
        }
        catch (e) {
            const message = e instanceof Error ? e.message : 'ログインに失敗しました。';
            setError(message);
        }
        finally {
            setIsAuthSubmitting(false);
        }
    }, [authFetch, loginToken]);
    const logout = useCallback(async () => {
        try {
            await authFetch('/api/auth/logout', { method: 'POST' });
        }
        finally {
            setIsAuthenticated(false);
        }
    }, [authFetch]);
    const bumpCacheVersion = useCallback(() => {
        setCacheVersion((prev) => prev + 1);
    }, []);
    useEffect(() => {
        const isIPad = /iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
        const isLargeScreen = window.innerWidth >= 768;
        if (isIPad || isLargeScreen) {
            setIsDeviceAllowed(true);
        }
    }, []);
    useEffect(() => {
        checkSession();
    }, [checkSession]);
    const getCanvasContext = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return null;
        return canvas.getContext('2d');
    }, []);
    const configureContext = useCallback((context) => {
        context.lineWidth = PEN_WIDTH;
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = penColor;
    }, [penColor]);
    const fillCanvasWhite = useCallback(() => {
        const context = getCanvasContext();
        if (!context)
            return;
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = 'white';
        context.fillRect(0, 0, CANVAS_LOGICAL_WIDTH, CANVAS_LOGICAL_HEIGHT);
        context.restore();
        configureContext(context);
    }, [configureContext, getCanvasContext]);
    const drawDataUrlToCanvas = useCallback((dataUrl) => {
        fillCanvasWhite();
        if (!dataUrl)
            return;
        const context = getCanvasContext();
        if (!context)
            return;
        const img = new Image();
        img.onload = () => {
            context.save();
            context.globalAlpha = 1;
            context.globalCompositeOperation = 'source-over';
            context.drawImage(img, 0, 0, CANVAS_LOGICAL_WIDTH, CANVAS_LOGICAL_HEIGHT);
            context.restore();
            configureContext(context);
        };
        img.src = dataUrl;
    }, [configureContext, fillCanvasWhite, getCanvasContext]);
    const resizeAndRestoreCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const context = getCanvasContext();
        if (!canvas || !context || !isDeviceAllowed)
            return;
        canvas.width = CANVAS_LOGICAL_WIDTH;
        canvas.height = CANVAS_LOGICAL_HEIGHT;
        context.setTransform(1, 0, 0, 1, 0, 0);
        drawDataUrlToCanvas(pageCacheRef.current[currentPage] ?? null);
    }, [currentPage, drawDataUrlToCanvas, getCanvasContext, isDeviceAllowed]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !isDeviceAllowed)
            return;
        resizeAndRestoreCanvas();
        const observer = new ResizeObserver(() => {
            resizeAndRestoreCanvas();
        });
        observer.observe(canvas);
        window.addEventListener('orientationchange', resizeAndRestoreCanvas);
        return () => {
            observer.disconnect();
            window.removeEventListener('orientationchange', resizeAndRestoreCanvas);
        };
    }, [isDeviceAllowed, resizeAndRestoreCanvas]);
    const getCoords = useCallback((event) => {
        const canvas = canvasRef.current;
        if (!canvas)
            return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = CANVAS_LOGICAL_WIDTH / rect.width;
        const scaleY = CANVAS_LOGICAL_HEIGHT / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    }, []);
    const snapshotCurrentPage = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        pageCacheRef.current[currentPage] = canvas.toDataURL('image/png');
        bumpCacheVersion();
    }, [bumpCacheVersion, currentPage]);
    const createBlankDataUrl = useCallback(() => {
        const offscreen = document.createElement('canvas');
        offscreen.width = CANVAS_LOGICAL_WIDTH;
        offscreen.height = CANVAS_LOGICAL_HEIGHT;
        const ctx = offscreen.getContext('2d');
        if (!ctx)
            return null;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        return offscreen.toDataURL('image/png');
    }, []);
    const blobToDataUrl = useCallback((blob) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
            reader.readAsDataURL(blob);
        });
    }, []);
    const startDrawing = useCallback((event) => {
        event.preventDefault();
        if (isSaving || event.pointerType === 'touch')
            return;
        if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId)
            return;
        const canvas = canvasRef.current;
        const context = getCanvasContext();
        if (!canvas || !context)
            return;
        configureContext(context);
        activePointerIdRef.current = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        const { x, y } = getCoords(event);
        context.beginPath();
        context.moveTo(x, y);
        setIsDrawing(true);
    }, [configureContext, getCanvasContext, getCoords, isSaving]);
    const draw = useCallback((event) => {
        event.preventDefault();
        if (!isDrawing || event.pointerType === 'touch' || activePointerIdRef.current !== event.pointerId)
            return;
        const context = getCanvasContext();
        if (!context)
            return;
        const { x, y } = getCoords(event);
        context.lineTo(x, y);
        context.stroke();
    }, [getCanvasContext, getCoords, isDrawing]);
    const stopDrawing = useCallback((event) => {
        event.preventDefault();
        if (activePointerIdRef.current !== event.pointerId)
            return;
        const canvas = canvasRef.current;
        const context = getCanvasContext();
        context?.closePath();
        if (canvas && activePointerIdRef.current !== null) {
            try {
                canvas.releasePointerCapture(activePointerIdRef.current);
            }
            catch {
                // no-op
            }
        }
        activePointerIdRef.current = null;
        setIsDrawing(false);
        snapshotCurrentPage();
    }, [getCanvasContext, snapshotCurrentPage]);
    const clearCurrentPage = useCallback(() => {
        pageCacheRef.current[currentPage] = null;
        drawDataUrlToCanvas(null);
        bumpCacheVersion();
    }, [bumpCacheVersion, currentPage, drawDataUrlToCanvas]);
    const switchToPage = useCallback((targetPage) => {
        if (targetPage === currentPage)
            return;
        snapshotCurrentPage();
        setCurrentPage(targetPage);
        drawDataUrlToCanvas(pageCacheRef.current[targetPage] ?? null);
    }, [currentPage, drawDataUrlToCanvas, snapshotCurrentPage]);
    const addPage = useCallback(() => {
        snapshotCurrentPage();
        const nextPage = Math.max(...pageNumbers) + 1;
        pageCacheRef.current[nextPage] = null;
        setPageNumbers((prev) => [...prev, nextPage]);
        setCurrentPage(nextPage);
        drawDataUrlToCanvas(null);
        bumpCacheVersion();
    }, [bumpCacheVersion, drawDataUrlToCanvas, pageNumbers, snapshotCurrentPage]);
    const initializeDraft = useCallback(() => {
        pageCacheRef.current = { 1: null };
        setPageNumbers([1]);
        setCurrentPage(1);
        drawDataUrlToCanvas(null);
        bumpCacheVersion();
    }, [bumpCacheVersion, drawDataUrlToCanvas]);
    const fetchRecords = useCallback(async () => {
        try {
            const response = await authFetch('/api/soragaki/records');
            if (response.status === 401) {
                handleUnauthorized();
                return;
            }
            if (!response.ok)
                throw new Error('保存済み一覧の取得に失敗しました。');
            const data = await response.json();
            setRecords(data);
            if (!selectedRecordId && data.length > 0) {
                const firstRecord = data[0];
                if (firstRecord) {
                    setSelectedRecordId(firstRecord.record_id);
                }
            }
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '保存済み一覧の取得に失敗しました。';
            setError(message);
        }
    }, [authFetch, handleUnauthorized, selectedRecordId]);
    const loadRecordPages = useCallback(async (recordId) => {
        setIsRecordLoading(true);
        setError(null);
        try {
            const pagesResponse = await authFetch(`/api/soragaki/records/${recordId}/pages`);
            if (pagesResponse.status === 401) {
                handleUnauthorized();
                return;
            }
            if (!pagesResponse.ok)
                throw new Error('保存済みデータのページ一覧取得に失敗しました。');
            const pages = await pagesResponse.json();
            const loaded = [];
            for (const page of pages) {
                const imageResponse = await authFetch(`/api/soragaki/records/${recordId}?page=${page}`);
                if (imageResponse.status === 401) {
                    handleUnauthorized();
                    return;
                }
                if (!imageResponse.ok)
                    throw new Error(`保存済みページの取得に失敗しました。 page=${page}`);
                const imageBlob = await imageResponse.blob();
                const dataUrl = await blobToDataUrl(imageBlob);
                loaded.push({ page, dataUrl });
            }
            setSelectedRecordPages(loaded);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '保存済みデータの取得に失敗しました。';
            setError(message);
        }
        finally {
            setIsRecordLoading(false);
        }
    }, [authFetch, blobToDataUrl, handleUnauthorized]);
    useEffect(() => {
        if (!isAuthenticated || !isDeviceAllowed)
            return;
        void fetchRecords();
    }, [fetchRecords, isAuthenticated, isDeviceAllowed]);
    useEffect(() => {
        if (!isAuthenticated || !selectedRecordId) {
            setSelectedRecordPages([]);
            return;
        }
        void loadRecordPages(selectedRecordId);
    }, [isAuthenticated, loadRecordPages, selectedRecordId]);
    const saveDraftAsRecord = useCallback(async () => {
        snapshotCurrentPage();
        setIsSaving(true);
        setError(null);
        try {
            const payloadPages = [];
            for (const page of pageNumbers) {
                const cached = pageCacheRef.current[page];
                const dataUrl = cached ?? createBlankDataUrl();
                if (!dataUrl)
                    continue;
                payloadPages.push({ page, data_url: dataUrl });
            }
            if (payloadPages.length === 0) {
                throw new Error('保存対象のページがありません。');
            }
            const response = await authFetch('/api/soragaki/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    learning_date: learningDate,
                    pages: payloadPages,
                }),
            });
            if (response.status === 401) {
                handleUnauthorized();
                throw new Error('認証エラーが発生しました。再ログインしてください。');
            }
            if (!response.ok) {
                throw new Error('保存に失敗しました。');
            }
            const created = await response.json();
            await fetchRecords();
            setSelectedRecordId(created.record_id);
            initializeDraft();
            alert(`保存しました。${formatSavedAt(created.saved_at)}`);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '保存に失敗しました。';
            setError(message);
            alert(`エラー: ${message}`);
        }
        finally {
            setIsSaving(false);
        }
    }, [authFetch, createBlankDataUrl, fetchRecords, handleUnauthorized, initializeDraft, learningDate, pageNumbers, snapshotCurrentPage]);
    const openNativeSoragakiApp = useCallback(() => {
        const deepLink = `quizapp://soragaki?date=${encodeURIComponent(learningDate)}&base=${encodeURIComponent(window.location.origin + '/api')}`;
        window.location.href = deepLink;
    }, [learningDate]);
    const fetchMemosAndKeywords = useCallback(async () => {
        setIsMemoLoading(true);
        setMemos('');
        setKeywords([]);
        try {
            const memoResponse = await authFetch(`/api/soragaki/memos/${learningDate}`);
            if (memoResponse.status === 401) {
                handleUnauthorized();
                throw new Error('認証エラーが発生しました。再ログインしてください。');
            }
            if (!memoResponse.ok)
                throw new Error('メモの取得に失敗しました。');
            const memoText = await memoResponse.text();
            setMemos(memoText);
            if (!memoText)
                return;
            const keywordsResponse = await authFetch('/api/soragaki/generate-keywords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memo_text: memoText }),
            });
            if (keywordsResponse.status === 401) {
                handleUnauthorized();
                throw new Error('認証エラーが発生しました。再ログインしてください。');
            }
            if (!keywordsResponse.ok)
                throw new Error('キーワードの生成に失敗しました。');
            const keywordsData = await keywordsResponse.json();
            setKeywords(keywordsData);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '処理に失敗しました。';
            setError(message);
            alert(`エラー: ${message}`);
        }
        finally {
            setIsMemoLoading(false);
        }
    }, [authFetch, handleUnauthorized, learningDate]);
    const selectedRecord = useMemo(() => records.find((r) => r.record_id === selectedRecordId) ?? null, [records, selectedRecordId]);
    if (!isDeviceAllowed) {
        return (_jsxs("div", { className: "p-4 md:p-8 text-center", children: [_jsx("h1", { className: "text-3xl font-bold text-dark mb-6", children: "\u7A7A\u63CF\u304D" }), _jsx("p", { className: "text-gray-600", children: "\u3053\u306E\u6A5F\u80FD\u306F\u3001iPad\u307E\u305F\u306F\u30BF\u30D6\u30EC\u30C3\u30C8\u3001PC\u306A\u3069\u306E\u5927\u753B\u9762\u30C7\u30D0\u30A4\u30B9\u3067\u306E\u307F\u5229\u7528\u53EF\u80FD\u3067\u3059\u3002" })] }));
    }
    if (isAuthChecking) {
        return (_jsx("div", { className: "p-4 md:p-8", children: _jsxs("div", { className: "max-w-md mx-auto bg-white rounded-xl shadow p-6", children: [_jsx(LoadingSpinner, {}), _jsx("p", { className: "text-center text-sm text-gray-600 mt-3", children: "\u8A8D\u8A3C\u72B6\u614B\u3092\u78BA\u8A8D\u3057\u3066\u3044\u307E\u3059..." })] }) }));
    }
    if (!isAuthenticated) {
        return (_jsx("div", { className: "p-4 md:p-8", children: _jsxs("div", { className: "max-w-md mx-auto bg-white rounded-xl shadow p-6 space-y-4", children: [_jsx("h1", { className: "text-2xl font-bold text-dark", children: "\u7A7A\u63CF\u304D \u30ED\u30B0\u30A4\u30F3" }), _jsx("p", { className: "text-sm text-gray-600", children: "\u30B5\u30FC\u30D0\u30FC\u5074\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u8A8D\u8A3C\u3057\u307E\u3059\u3002\u30A2\u30AF\u30BB\u30B9\u30C8\u30FC\u30AF\u30F3\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }), _jsx("input", { type: "password", value: loginToken, onChange: (e) => setLoginToken(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new", placeholder: "Access Token" }), _jsx("button", { onClick: login, className: "w-full px-4 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 disabled:bg-gray-300", disabled: isAuthSubmitting || !loginToken.trim(), children: isAuthSubmitting ? 'ログイン中...' : 'ログイン' }), error && _jsx("p", { className: "text-red-500 text-sm", children: error })] }) }));
    }
    return (_jsxs("div", { className: "p-4 md:p-8 select-none", style: { WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }, children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3 mb-6", children: [_jsx("h1", { className: "text-3xl font-bold text-dark mr-auto", children: "\u7A7A\u63CF\u304D" }), _jsx("button", { onClick: logout, className: "px-4 py-2 bg-slate-600 text-white font-semibold rounded-md shadow-sm hover:bg-slate-700 disabled:bg-gray-300", disabled: isSaving, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-8", children: [_jsxs("div", { className: "lg:col-span-1 space-y-6", children: [_jsxs("div", { className: "p-4 bg-white rounded-xl shadow", children: [_jsx("h2", { className: "text-lg font-bold text-gray-800 mb-3", children: "\u4FDD\u5B58\u6E08\u307F\u4E00\u89A7\uFF08\u53C2\u7167\u306E\u307F\uFF09" }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [records.map((record) => (_jsx("button", { onClick: () => setSelectedRecordId(record.record_id), className: `px-3 py-2 rounded-md text-sm border ${selectedRecordId === record.record_id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:border-gray-500'}`, children: formatSavedAt(record.saved_at) }, record.record_id))), records.length === 0 && _jsx("p", { className: "text-sm text-gray-500", children: "\u4FDD\u5B58\u6E08\u307F\u30C7\u30FC\u30BF\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" })] })] }), _jsxs("div", { className: "p-4 bg-white rounded-xl shadow", children: [_jsx("h2", { className: "text-lg font-bold text-gray-800 mb-2", children: "\u30AD\u30FC\u30EF\u30FC\u30C9" }), _jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx("label", { htmlFor: "learning-date", className: "text-sm font-semibold", children: "\u5B66\u7FD2\u65E5:" }), _jsx("input", { id: "learning-date", type: "date", value: learningDate, onChange: (e) => setLearningDate(e.target.value), className: "block bg-white border border-gray-300 rounded-md shadow-sm py-1 px-2 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new" })] }), _jsx("button", { onClick: fetchMemosAndKeywords, className: "w-full px-4 py-2 mb-4 bg-green-500 text-white font-semibold rounded-md shadow-sm hover:bg-green-600 disabled:bg-gray-300", disabled: isMemoLoading, children: isMemoLoading ? '生成中...' : 'キーワードを生成' }), isMemoLoading && _jsx(LoadingSpinner, {}), _jsxs("div", { className: "flex flex-wrap gap-2", children: [keywords.map((kw, i) => (_jsx("span", { className: "px-3 py-1 bg-blue-100 text-primary-new rounded-full text-sm font-medium", children: kw }, `${kw}-${i}`))), !isMemoLoading && keywords.length === 0 && (_jsx("p", { className: "text-sm text-gray-500", children: "\u30DC\u30BF\u30F3\u3092\u62BC\u3057\u3066\u3001\u5B66\u7FD2\u5185\u5BB9\u304B\u3089\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u751F\u6210\u3057\u307E\u3059\u3002" }))] })] }), _jsx("div", { className: "p-4 bg-white rounded-xl shadow", children: _jsxs("details", { children: [_jsx("summary", { className: "text-lg font-bold text-gray-800 cursor-pointer", children: "\u53C2\u7167\u5143My Memo" }), _jsx("textarea", { readOnly: true, value: memos || 'キーワードを生成すると、ここに参照元のメモが表示されます。', className: "mt-2 w-full h-48 p-2 border border-gray-200 rounded-md bg-gray-50 font-mono text-sm" })] }) })] }), _jsxs("div", { className: "lg:col-span-2 space-y-6", children: [_jsxs("div", { className: "p-4 bg-white rounded-xl shadow", children: [_jsx("h2", { className: "text-lg font-bold text-gray-800 mb-2", children: "\u9078\u629E\u4E2D\u306E\u4FDD\u5B58\u30C7\u30FC\u30BF" }), selectedRecord && (_jsxs("p", { className: "text-sm text-gray-600 mb-3", children: ["\u4FDD\u5B58\u65E5\u6642: ", formatSavedAt(selectedRecord.saved_at), " / \u30DA\u30FC\u30B8\u6570: ", selectedRecord.page_count] })), isRecordLoading ? (_jsx(LoadingSpinner, {})) : selectedRecordPages.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u5DE6\u306E\u4E00\u89A7\u304B\u3089\u4FDD\u5B58\u6E08\u307F\u30C7\u30FC\u30BF\u3092\u9078\u629E\u3059\u308B\u3068\u8868\u793A\u3055\u308C\u307E\u3059\u3002" })) : (_jsx("div", { className: "space-y-4 max-h-[55vh] overflow-y-auto pr-1", children: selectedRecordPages.map((item) => (_jsxs("div", { className: "border border-gray-200 rounded-lg p-2", children: [_jsxs("p", { className: "text-xs text-gray-600 mb-1", children: ["Page ", item.page] }), _jsx("img", { src: item.dataUrl, alt: `record-page-${item.page}`, className: "w-full h-auto rounded bg-white" })] }, item.page))) }))] }), _jsxs("div", { className: "p-4 bg-white rounded-xl shadow", children: [_jsx("h2", { className: "text-lg font-bold text-gray-800 mb-3", children: "\u65B0\u898F\u4F5C\u6210\uFF08\u4FDD\u5B58\u5F8C\u306F\u7DE8\u96C6\u4E0D\u53EF\uFF09" }), _jsxs("div", { className: "flex flex-wrap gap-2 mb-3 items-center", children: [_jsx("button", { onClick: saveDraftAsRecord, className: "px-4 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 disabled:bg-gray-300", disabled: isSaving || isDrawing, children: isSaving ? '保存中...' : 'この下書きを保存' }), _jsx("button", { onClick: clearCurrentPage, className: "px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300 disabled:bg-gray-300", disabled: isSaving || isDrawing, children: "\u30AF\u30EA\u30A2" }), _jsx("button", { onClick: addPage, className: "px-4 py-2 bg-emerald-600 text-white font-semibold rounded-md shadow-sm hover:bg-emerald-700 disabled:bg-gray-300", disabled: isSaving || isDrawing, children: "\u30DA\u30FC\u30B8\u8FFD\u52A0" }), _jsx("button", { onClick: openNativeSoragakiApp, className: "px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md shadow-sm hover:bg-cyan-700 disabled:bg-gray-300", disabled: isSaving || isDrawing, children: "iPad\u30A2\u30D7\u30EA\u3067\u958B\u304F" }), _jsx("div", { className: "flex items-center gap-1 px-2 py-1 border rounded-md bg-white text-xs font-semibold text-gray-700", children: "\u30DA\u30F3" }), _jsx("div", { className: "flex items-center gap-1 px-2 py-1 border rounded-md bg-white", children: PEN_COLORS.map((color) => (_jsx("button", { onClick: () => setPenColor(color), className: `w-6 h-6 rounded-full border ${penColor === color ? 'ring-2 ring-offset-1 ring-blue-500' : 'border-gray-300'}`, style: { backgroundColor: color }, "aria-label": `color-${color}` }, color))) }), _jsxs("div", { className: "flex items-center gap-2 ml-auto", children: [_jsx("button", { onClick: () => switchToPage(Math.max(1, currentPage - 1)), className: "px-3 py-2 bg-gray-100 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400", disabled: isSaving || isDrawing || currentPage <= 1, children: "\u524D\u3078" }), _jsxs("span", { className: "text-sm font-semibold text-gray-700 min-w-24 text-center", children: [currentPage, " / ", pageNumbers.length] }), _jsx("button", { onClick: () => switchToPage(Math.min(pageNumbers.length, currentPage + 1)), className: "px-3 py-2 bg-gray-100 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400", disabled: isSaving || isDrawing || currentPage >= pageNumbers.length, children: "\u6B21\u3078" })] })] }), _jsx("div", { className: "mb-3 p-2 bg-gray-50 border border-gray-200 rounded-lg overflow-x-auto", children: _jsx("div", { className: "flex gap-2 min-w-max", "data-cache-version": cacheVersion, children: pageNumbers.map((page) => {
                                                const thumb = pageCacheRef.current[page];
                                                const isCurrent = page === currentPage;
                                                return (_jsxs("button", { onClick: () => switchToPage(page), disabled: isSaving, className: `relative w-20 h-16 border rounded-md overflow-hidden shrink-0 ${isCurrent ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300 hover:border-gray-500'}`, children: [thumb ? (_jsx("img", { src: thumb, alt: `draft-page-${page}`, className: "w-full h-full object-cover bg-white" })) : (_jsx("div", { className: "w-full h-full bg-white" })), _jsx("span", { className: "absolute bottom-0 right-0 text-[10px] px-1 py-0.5 bg-black/70 text-white", children: page })] }, page));
                                            }) }) }), _jsxs("div", { className: "relative w-full aspect-[4/3] bg-white rounded-xl shadow-lg", children: [isSaving && _jsx("div", { className: "absolute inset-0 flex justify-center items-center bg-white/50", children: _jsx(LoadingSpinner, {}) }), _jsx("canvas", { ref: canvasRef, className: "w-full h-full rounded-xl", style: { touchAction: 'none', overscrollBehavior: 'contain', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }, onPointerDown: startDrawing, onPointerMove: draw, onPointerUp: stopDrawing, onPointerCancel: stopDrawing, onPointerLeave: stopDrawing })] })] }), error && _jsx("p", { className: "text-red-500 text-sm", children: error })] })] })] }));
}
//# sourceMappingURL=SoragakiPage.js.map