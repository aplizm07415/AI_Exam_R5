import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import { formatDateTimeJst, getTodayYmdJst } from './utils/date';

const PEN_COLORS = ['#111111', '#1d4ed8', '#0F52BA', '#dc2626', '#059669', '#7c3aed'];
const PEN_WIDTH = 1.3;
const CANVAS_LOGICAL_WIDTH = 2048;
const CANVAS_LOGICAL_HEIGHT = 1536;

type SoragakiRecordSummary = {
  record_id: string;
  saved_at: string;
  learning_date?: string | null;
  page_count: number;
};

type SoragakiRecordPagePayload = {
  page: number;
  data_url: string;
};

type SoragakiRecordPageView = {
  page: number;
  dataUrl: string;
};

const useCurrentDate = () => getTodayYmdJst();

const formatSavedAt = (savedAt: string) => {
  return formatDateTimeJst(savedAt);
};

export default function SoragakiPage() {
  const today = useCurrentDate();
  const [learningDate, setLearningDate] = useState(today);
  const [isDeviceAllowed, setIsDeviceAllowed] = useState(false);

  const [memos, setMemos] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [isMemoLoading, setIsMemoLoading] = useState(false);

  const [records, setRecords] = useState<SoragakiRecordSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedRecordPages, setSelectedRecordPages] = useState<SoragakiRecordPageView[]>([]);
  const [isRecordLoading, setIsRecordLoading] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [loginToken, setLoginToken] = useState('');

  const [pageNumbers, setPageNumbers] = useState<number[]>([1]);
  const [currentPage, setCurrentPage] = useState(1);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [penColor, setPenColor] = useState('#0F52BA');
  const [isDrawing, setIsDrawing] = useState(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pageCacheRef = useRef<Record<number, string | null>>({ 1: null });

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const authFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
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
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsAuthChecking(false);
    }
  }, [authFetch]);

  const login = useCallback(async () => {
    if (!loginToken.trim()) return;
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
    } catch (e) {
      const message = e instanceof Error ? e.message : 'ログインに失敗しました。';
      setError(message);
    } finally {
      setIsAuthSubmitting(false);
    }
  }, [authFetch, loginToken]);

  const logout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } finally {
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
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  const configureContext = useCallback((context: CanvasRenderingContext2D) => {
    context.lineWidth = PEN_WIDTH;
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = penColor;
  }, [penColor]);

  const fillCanvasWhite = useCallback(() => {
    const context = getCanvasContext();
    if (!context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = 'white';
    context.fillRect(0, 0, CANVAS_LOGICAL_WIDTH, CANVAS_LOGICAL_HEIGHT);
    context.restore();
    configureContext(context);
  }, [configureContext, getCanvasContext]);

  const drawDataUrlToCanvas = useCallback((dataUrl: string | null) => {
    fillCanvasWhite();
    if (!dataUrl) return;
    const context = getCanvasContext();
    if (!context) return;

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
    if (!canvas || !context || !isDeviceAllowed) return;
    canvas.width = CANVAS_LOGICAL_WIDTH;
    canvas.height = CANVAS_LOGICAL_HEIGHT;
    context.setTransform(1, 0, 0, 1, 0, 0);
    drawDataUrlToCanvas(pageCacheRef.current[currentPage] ?? null);
  }, [currentPage, drawDataUrlToCanvas, getCanvasContext, isDeviceAllowed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isDeviceAllowed) return;
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

  const getCoords = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
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
    if (!canvas) return;
    pageCacheRef.current[currentPage] = canvas.toDataURL('image/png');
    bumpCacheVersion();
  }, [bumpCacheVersion, currentPage]);

  const createBlankDataUrl = useCallback(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_LOGICAL_WIDTH;
    offscreen.height = CANVAS_LOGICAL_HEIGHT;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    return offscreen.toDataURL('image/png');
  }, []);

  const blobToDataUrl = useCallback((blob: Blob) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
      reader.readAsDataURL(blob);
    });
  }, []);

  const startDrawing = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (isSaving || event.pointerType === 'touch') return;
    if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) return;

    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (!canvas || !context) return;
    configureContext(context);
    activePointerIdRef.current = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = getCoords(event);
    context.beginPath();
    context.moveTo(x, y);
    setIsDrawing(true);
  }, [configureContext, getCanvasContext, getCoords, isSaving]);

  const draw = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (!isDrawing || event.pointerType === 'touch' || activePointerIdRef.current !== event.pointerId) return;
    const context = getCanvasContext();
    if (!context) return;
    const { x, y } = getCoords(event);
    context.lineTo(x, y);
    context.stroke();
  }, [getCanvasContext, getCoords, isDrawing]);

  const stopDrawing = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (activePointerIdRef.current !== event.pointerId) return;
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    context?.closePath();
    if (canvas && activePointerIdRef.current !== null) {
      try {
        canvas.releasePointerCapture(activePointerIdRef.current);
      } catch {
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

  const switchToPage = useCallback((targetPage: number) => {
    if (targetPage === currentPage) return;
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
      if (!response.ok) throw new Error('保存済み一覧の取得に失敗しました。');
      const data: SoragakiRecordSummary[] = await response.json();
      setRecords(data);
      if (!selectedRecordId && data.length > 0) {
        const firstRecord = data[0];
        if (firstRecord) {
          setSelectedRecordId(firstRecord.record_id);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存済み一覧の取得に失敗しました。';
      setError(message);
    }
  }, [authFetch, handleUnauthorized, selectedRecordId]);

  const loadRecordPages = useCallback(async (recordId: string) => {
    setIsRecordLoading(true);
    setError(null);
    try {
      const pagesResponse = await authFetch(`/api/soragaki/records/${recordId}/pages`);
      if (pagesResponse.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!pagesResponse.ok) throw new Error('保存済みデータのページ一覧取得に失敗しました。');
      const pages: number[] = await pagesResponse.json();

      const loaded: SoragakiRecordPageView[] = [];
      for (const page of pages) {
        const imageResponse = await authFetch(`/api/soragaki/records/${recordId}?page=${page}`);
        if (imageResponse.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!imageResponse.ok) throw new Error(`保存済みページの取得に失敗しました。 page=${page}`);
        const imageBlob = await imageResponse.blob();
        const dataUrl = await blobToDataUrl(imageBlob);
        loaded.push({ page, dataUrl });
      }
      setSelectedRecordPages(loaded);
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存済みデータの取得に失敗しました。';
      setError(message);
    } finally {
      setIsRecordLoading(false);
    }
  }, [authFetch, blobToDataUrl, handleUnauthorized]);

  useEffect(() => {
    if (!isAuthenticated || !isDeviceAllowed) return;
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
      const payloadPages: SoragakiRecordPagePayload[] = [];
      for (const page of pageNumbers) {
        const cached = pageCacheRef.current[page];
        const dataUrl = cached ?? createBlankDataUrl();
        if (!dataUrl) continue;
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
      const created: SoragakiRecordSummary = await response.json();
      await fetchRecords();
      setSelectedRecordId(created.record_id);
      initializeDraft();
      alert(`保存しました。${formatSavedAt(created.saved_at)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存に失敗しました。';
      setError(message);
      alert(`エラー: ${message}`);
    } finally {
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
      if (!memoResponse.ok) throw new Error('メモの取得に失敗しました。');
      const memoText = await memoResponse.text();
      setMemos(memoText);

      if (!memoText) return;
      const keywordsResponse = await authFetch('/api/soragaki/generate-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_text: memoText }),
      });
      if (keywordsResponse.status === 401) {
        handleUnauthorized();
        throw new Error('認証エラーが発生しました。再ログインしてください。');
      }
      if (!keywordsResponse.ok) throw new Error('キーワードの生成に失敗しました。');
      const keywordsData: string[] = await keywordsResponse.json();
      setKeywords(keywordsData);
    } catch (e) {
      const message = e instanceof Error ? e.message : '処理に失敗しました。';
      setError(message);
      alert(`エラー: ${message}`);
    } finally {
      setIsMemoLoading(false);
    }
  }, [authFetch, handleUnauthorized, learningDate]);

  const selectedRecord = useMemo(
    () => records.find((r) => r.record_id === selectedRecordId) ?? null,
    [records, selectedRecordId],
  );

  if (!isDeviceAllowed) {
    return (
      <div className="p-4 md:p-8 text-center">
        <h1 className="text-3xl font-bold text-dark mb-6">空描き</h1>
        <p className="text-gray-600">この機能は、iPadまたはタブレット、PCなどの大画面デバイスでのみ利用可能です。</p>
      </div>
    );
  }

  if (isAuthChecking) {
    return (
      <div className="p-4 md:p-8">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6">
          <LoadingSpinner />
          <p className="text-center text-sm text-gray-600 mt-3">認証状態を確認しています...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-8">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6 space-y-4">
          <h1 className="text-2xl font-bold text-dark">空描き ログイン</h1>
          <p className="text-sm text-gray-600">サーバー側セッションで認証します。アクセストークンを入力してください。</p>
          <input
            type="password"
            value={loginToken}
            onChange={(e) => setLoginToken(e.target.value)}
            className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
            placeholder="Access Token"
          />
          <button
            onClick={login}
            className="w-full px-4 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 disabled:bg-gray-300"
            disabled={isAuthSubmitting || !loginToken.trim()}
          >
            {isAuthSubmitting ? 'ログイン中...' : 'ログイン'}
          </button>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 select-none" style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-3xl font-bold text-dark mr-auto">空描き</h1>
        <button
          onClick={logout}
          className="px-4 py-2 bg-slate-600 text-white font-semibold rounded-md shadow-sm hover:bg-slate-700 disabled:bg-gray-300"
          disabled={isSaving}
        >
          ログアウト
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="p-4 bg-white rounded-xl shadow">
            <h2 className="text-lg font-bold text-gray-800 mb-3">保存済み一覧（参照のみ）</h2>
            <div className="flex flex-wrap gap-2">
              {records.map((record) => (
                <button
                  key={record.record_id}
                  onClick={() => setSelectedRecordId(record.record_id)}
                  className={`px-3 py-2 rounded-md text-sm border ${
                    selectedRecordId === record.record_id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:border-gray-500'
                  }`}
                >
                  {formatSavedAt(record.saved_at)}
                </button>
              ))}
              {records.length === 0 && <p className="text-sm text-gray-500">保存済みデータはまだありません。</p>}
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl shadow">
            <h2 className="text-lg font-bold text-gray-800 mb-2">キーワード</h2>
            <div className="flex items-center gap-2 mb-3">
              <label htmlFor="learning-date" className="text-sm font-semibold">学習日:</label>
              <input
                id="learning-date"
                type="date"
                value={learningDate}
                onChange={(e) => setLearningDate(e.target.value)}
                className="block bg-white border border-gray-300 rounded-md shadow-sm py-1 px-2 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
              />
            </div>
            <button
              onClick={fetchMemosAndKeywords}
              className="w-full px-4 py-2 mb-4 bg-green-500 text-white font-semibold rounded-md shadow-sm hover:bg-green-600 disabled:bg-gray-300"
              disabled={isMemoLoading}
            >
              {isMemoLoading ? '生成中...' : 'キーワードを生成'}
            </button>
            {isMemoLoading && <LoadingSpinner />}
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw, i) => (
                <span key={`${kw}-${i}`} className="px-3 py-1 bg-blue-100 text-primary-new rounded-full text-sm font-medium">
                  {kw}
                </span>
              ))}
              {!isMemoLoading && keywords.length === 0 && (
                <p className="text-sm text-gray-500">ボタンを押して、学習内容からキーワードを生成します。</p>
              )}
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl shadow">
            <details>
              <summary className="text-lg font-bold text-gray-800 cursor-pointer">参照元My Memo</summary>
              <textarea
                readOnly
                value={memos || 'キーワードを生成すると、ここに参照元のメモが表示されます。'}
                className="mt-2 w-full h-48 p-2 border border-gray-200 rounded-md bg-gray-50 font-mono text-sm"
              />
            </details>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="p-4 bg-white rounded-xl shadow">
            <h2 className="text-lg font-bold text-gray-800 mb-2">選択中の保存データ</h2>
            {selectedRecord && (
              <p className="text-sm text-gray-600 mb-3">
                保存日時: {formatSavedAt(selectedRecord.saved_at)} / ページ数: {selectedRecord.page_count}
              </p>
            )}
            {isRecordLoading ? (
              <LoadingSpinner />
            ) : selectedRecordPages.length === 0 ? (
              <p className="text-sm text-gray-500">左の一覧から保存済みデータを選択すると表示されます。</p>
            ) : (
              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                {selectedRecordPages.map((item) => (
                  <div key={item.page} className="border border-gray-200 rounded-lg p-2">
                    <p className="text-xs text-gray-600 mb-1">Page {item.page}</p>
                    <img src={item.dataUrl} alt={`record-page-${item.page}`} className="w-full h-auto rounded bg-white" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 bg-white rounded-xl shadow">
            <h2 className="text-lg font-bold text-gray-800 mb-3">新規作成（保存後は編集不可）</h2>
            <div className="flex flex-wrap gap-2 mb-3 items-center">
              <button
                onClick={saveDraftAsRecord}
                className="px-4 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 disabled:bg-gray-300"
                disabled={isSaving || isDrawing}
              >
                {isSaving ? '保存中...' : 'この下書きを保存'}
              </button>
              <button
                onClick={clearCurrentPage}
                className="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300 disabled:bg-gray-300"
                disabled={isSaving || isDrawing}
              >
                クリア
              </button>
              <button
                onClick={addPage}
                className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-md shadow-sm hover:bg-emerald-700 disabled:bg-gray-300"
                disabled={isSaving || isDrawing}
              >
                ページ追加
              </button>
              <button
                onClick={openNativeSoragakiApp}
                className="px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md shadow-sm hover:bg-cyan-700 disabled:bg-gray-300"
                disabled={isSaving || isDrawing}
              >
                iPadアプリで開く
              </button>
              <div className="flex items-center gap-1 px-2 py-1 border rounded-md bg-white text-xs font-semibold text-gray-700">ペン</div>
              <div className="flex items-center gap-1 px-2 py-1 border rounded-md bg-white">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setPenColor(color)}
                    className={`w-6 h-6 rounded-full border ${penColor === color ? 'ring-2 ring-offset-1 ring-blue-500' : 'border-gray-300'}`}
                    style={{ backgroundColor: color }}
                    aria-label={`color-${color}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => switchToPage(Math.max(1, currentPage - 1))}
                  className="px-3 py-2 bg-gray-100 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                  disabled={isSaving || isDrawing || currentPage <= 1}
                >
                  前へ
                </button>
                <span className="text-sm font-semibold text-gray-700 min-w-24 text-center">{currentPage} / {pageNumbers.length}</span>
                <button
                  onClick={() => switchToPage(Math.min(pageNumbers.length, currentPage + 1))}
                  className="px-3 py-2 bg-gray-100 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                  disabled={isSaving || isDrawing || currentPage >= pageNumbers.length}
                >
                  次へ
                </button>
              </div>
            </div>

            <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded-lg overflow-x-auto">
              <div className="flex gap-2 min-w-max" data-cache-version={cacheVersion}>
                {pageNumbers.map((page) => {
                  const thumb = pageCacheRef.current[page];
                  const isCurrent = page === currentPage;
                  return (
                    <button
                      key={page}
                      onClick={() => switchToPage(page)}
                      disabled={isSaving}
                      className={`relative w-20 h-16 border rounded-md overflow-hidden shrink-0 ${isCurrent ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300 hover:border-gray-500'}`}
                    >
                      {thumb ? (
                        <img src={thumb} alt={`draft-page-${page}`} className="w-full h-full object-cover bg-white" />
                      ) : (
                        <div className="w-full h-full bg-white" />
                      )}
                      <span className="absolute bottom-0 right-0 text-[10px] px-1 py-0.5 bg-black/70 text-white">{page}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative w-full aspect-[4/3] bg-white rounded-xl shadow-lg">
              {isSaving && <div className="absolute inset-0 flex justify-center items-center bg-white/50"><LoadingSpinner /></div>}
              <canvas
                ref={canvasRef}
                className="w-full h-full rounded-xl"
                style={{ touchAction: 'none', overscrollBehavior: 'contain', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onPointerLeave={stopDrawing}
              />
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      </div>
    </div>
  );
}
