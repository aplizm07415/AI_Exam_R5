import React, { useState, useRef, useEffect, useCallback } from 'react';
import LoadingSpinner from './components/LoadingSpinner';

// A simple hook to get the current date in YYYY-MM-DD format
const useCurrentDate = () => {
  return new Date().toISOString().split('T')[0];
};

export default function SoragakiPage() {

  const today = useCurrentDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeviceAllowed, setIsDeviceAllowed] = useState(false);

  // --- State for Stage 2 & 3 ---
  const [memos, setMemos] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [isMemoLoading, setIsMemoLoading] = useState(false);

  // --- App Access Token (User needs to replace this with their actual token from .env.local) ---
  const APP_ACCESS_TOKEN = "REDACTED_CREDENTIAL";
  // IMPORTANT: Replace "YOUR_APP_ACCESS_TOKEN_HERE" with the same random string
  // you added to your .env.local file for APP_ACCESS_TOKEN.

  const getAuthHeaders = useCallback(() => {
    if (!APP_ACCESS_TOKEN) { // Only check if the token is empty or null/undefined
      alert("セキュリティトークンが設定されていません。SoragakiPage.tsxのAPP_ACCESS_TOKENを更新してください。");
      throw new Error("Security token not configured.");
    }
    return {
      'Authorization': `Bearer ${APP_ACCESS_TOKEN}`
    };
  }, [APP_ACCESS_TOKEN]);

  // --- Device Check ---
  useEffect(() => {
    const isIPad = /iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
    const isLargeScreen = window.innerWidth >= 768;
    if (isIPad || isLargeScreen) {
      setIsDeviceAllowed(true);
    }
  }, []);

  // --- Canvas Drawing Logic ---
  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (canvas && context) {
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "black";
      context.lineWidth = 2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
    }
  }, [getCanvasContext, isDeviceAllowed]);

  const getCoords = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (event.nativeEvent instanceof MouseEvent) {
      return { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
    }
    if (event.nativeEvent instanceof TouchEvent && event.nativeEvent.touches[0]) {
      const touch = event.nativeEvent.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: 0, y: 0 };
  };

  const startDrawing = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    const context = getCanvasContext();
    if (!context) return;
    const { x, y } = getCoords(event);
    context.beginPath();
    context.moveTo(x, y);
    setIsDrawing(true);
  }, [getCanvasContext]);

  const draw = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const context = getCanvasContext();
    if (!context) return;
    const { x, y } = getCoords(event);
    context.lineTo(x, y);
    context.stroke();
  }, [isDrawing, getCanvasContext]);

  const stopDrawing = useCallback(() => {
    const context = getCanvasContext();
    if (!context) return;
    context.closePath();
    setIsDrawing(false);
  }, [getCanvasContext]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (canvas && context) {
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [getCanvasContext]);

  // --- API Interaction ---
  const loadSoragaki = useCallback(async (date: string) => {
    setIsLoading(true);
    setError(null);
    clearCanvas();
    try {
      const response = await fetch(`/api/soragaki/${date}`, {
        headers: getAuthHeaders(),
      });
      if (response.status === 404) {
        console.log(`No soragaki found for ${date}`);
        return;
      }
      if (!response.ok) {
        throw new Error('空描きデータの読み込みに失敗しました。');
      }
      const imageBlob = await response.blob();
      const imageUrl = URL.createObjectURL(imageBlob);
      const img = new Image();
      img.onload = () => {
        const context = getCanvasContext();
        if (context) context.drawImage(img, 0, 0);
        URL.revokeObjectURL(imageUrl);
      };
      img.src = imageUrl;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [getCanvasContext, clearCanvas]);

  useEffect(() => {
    if (selectedDate && isDeviceAllowed) {
      loadSoragaki(selectedDate);
      setMemos('');
      setKeywords([]);
    }
  }, [selectedDate, loadSoragaki, isDeviceAllowed]);

  const saveSoragaki = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsLoading(true);
    setError(null);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch(`/api/soragaki/${selectedDate}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...getAuthHeaders(),
        },
        body: dataUrl,
      });

      if (!response.ok) throw new Error('空描きデータの保存に失敗しました。');
      alert('保存しました！');
    } catch (e: any) {
      setError(e.message);
      alert(`エラー: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMemosAndKeywords = async () => {
    setIsMemoLoading(true);
    setMemos('');
    setKeywords([]);
    try {
      // 1. Fetch aggregated memos
      const memoResponse = await fetch(`/api/soragaki/memos/${selectedDate}`, {
        headers: getAuthHeaders(),
      });
      if (!memoResponse.ok) {
        throw new Error('メモの取得に失敗しました。');
      }
      const memoText = await memoResponse.text();
      setMemos(memoText);

      // 2. If memos exist, call Gemini to get keywords
      if (memoText) {
        const keywordsResponse = await fetch('/api/soragaki/generate-keywords', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ memo_text: memoText }),
        });
        if (!keywordsResponse.ok) {
          throw new Error('キーワードの生成に失敗しました。');
        }
        const keywordsData: string[] = await keywordsResponse.json();
        setKeywords(keywordsData);
      }
    } catch (e: any) {
      alert(`エラー: ${e.message}`);
    } finally {
      setIsMemoLoading(false);
    }
  };

  if (!isDeviceAllowed) {
    return (
      <div className="p-4 md:p-8 text-center">
        <h1 className="text-3xl font-bold text-dark mb-6">空描き</h1>
        <p className="text-gray-600">この機能は、iPadまたはタブレット、PCなどの大画面デバイスでのみ利用可能です。</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <h1 className="text-3xl font-bold text-dark mb-4 md:mb-0">空描き</h1>
        <div className="flex flex-col md:flex-row gap-4 items-center p-4 bg-white rounded-xl shadow">
          <label htmlFor="soragaki-date" className="font-semibold">学習日:</label>
          <input
            type="date"
            id="soragaki-date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="block bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Keywords and Memos */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-4 bg-white rounded-xl shadow">
            <button
              onClick={fetchMemosAndKeywords}
              className="w-full px-4 py-2 mb-4 bg-green-500 text-white font-semibold rounded-md shadow-sm hover:bg-green-600 disabled:bg-gray-300"
              disabled={isMemoLoading}
            >
              {isMemoLoading ? '生成中...' : 'キーワードを生成'}
            </button>
            <h2 className="text-lg font-bold text-gray-800 mb-2">キーワード</h2>
            {isMemoLoading && <LoadingSpinner />}
            <div className="flex flex-wrap gap-2">
              {keywords.length > 0 && keywords[0] === "この日のMy Memoはありませんでした" ? (
                <>
                  <p className="w-full text-center text-gray-500 mb-2">{keywords[0]}</p>
                  {keywords.slice(1).map((kw, i) => (
                    <span key={i} className="px-3 py-1 bg-blue-100 text-primary-new rounded-full text-sm font-medium">
                      {kw}
                    </span>
                  ))}
                </>
              ) : (
                keywords.map((kw, i) => (
                  <span key={i} className="px-3 py-1 bg-blue-100 text-primary-new rounded-full text-sm font-medium">
                    {kw}
                  </span>
                ))
              )}
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
                value={memos || "キーワードを生成すると、ここに参照元のメモが表示されます。"}
                className="mt-2 w-full h-48 p-2 border border-gray-200 rounded-md bg-gray-50 font-mono text-sm"
              />
            </details>
          </div>
        </div>

        {/* Right Column: Canvas */}
        <div className="lg:col-span-2">
          <div className="flex gap-2 mb-2">
            <button
              onClick={saveSoragaki}
              className="px-4 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 disabled:bg-gray-300"
              disabled={isLoading}
            >
              {isLoading ? '保存中...' : 'この空描きを保存'}
            </button>
            <button
              onClick={clearCanvas}
              className="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300"
            >
              クリア
            </button>
          </div>
          <div className="relative w-full aspect-[4/3] bg-white rounded-xl shadow-lg">
            {isLoading && <div className="absolute inset-0 flex justify-center items-center bg-white/50"><LoadingSpinner /></div>}
            <canvas
              ref={canvasRef}
              width={1024}
              height={768}
              className="w-full h-full rounded-xl"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
}
