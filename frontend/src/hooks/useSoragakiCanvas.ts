import React, { useState, useRef, useEffect, useCallback } from 'react';

interface UseSoragakiCanvasProps {
  selectedDate: string;
  isDeviceAllowed: boolean;
  getAuthHeaders: () => { [key: string]: string };
}

interface UseSoragakiCanvasResult {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isLoading: boolean;
  error: string | null;
  clearCanvas: () => void;
  saveSoragaki: () => Promise<void>;
  loadSoragaki: (date: string) => Promise<void>;
}

export function useSoragakiCanvas({ selectedDate, isDeviceAllowed, getAuthHeaders }: UseSoragakiCanvasProps): UseSoragakiCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPenActive = useRef(false); // To track if pen is currently in use for palm rejection

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  // Canvas initialization and devicePixelRatio correction
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (canvas && context) {
      const dpi = window.devicePixelRatio;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpi;
      canvas.height = rect.height * dpi;
      context.scale(dpi, dpi);

      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width / dpi, canvas.height / dpi);
      context.strokeStyle = "black";
      context.lineWidth = 2 / dpi;
      context.lineCap = 'round';
      context.lineJoin = 'round';
    }
  }, [getCanvasContext, isDeviceAllowed]);

  const getCoords = useCallback((event: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    return { 
      x: (event.clientX - rect.left), 
      y: (event.clientY - rect.top)
    };
  }, []);

  const startDrawing = useCallback((event: React.PointerEvent) => {
    if (!isDeviceAllowed) return;
    if (isPenActive.current && event.pointerType === 'touch') return;

    const context = getCanvasContext();
    if (!context) return;

    if (event.pointerType === 'pen') {
      isPenActive.current = true;
    }

    const { x, y } = getCoords(event);
    context.beginPath();
    context.moveTo(x, y);
    setIsDrawing(true);
  }, [getCanvasContext, getCoords, isDeviceAllowed]);

  const draw = useCallback((event: React.PointerEvent) => {
    if (!isDrawing) return;
    if (!isDeviceAllowed) return;
    if (isPenActive.current && event.pointerType === 'touch') return;

    const context = getCanvasContext();
    if (!context) return;
    const { x, y } = getCoords(event);
    context.lineTo(x, y);
    context.stroke();
  }, [isDrawing, getCanvasContext, getCoords, isDeviceAllowed]);

  const stopDrawing = useCallback((event: React.PointerEvent) => {
    if (!isDrawing) return;
    if (!isDeviceAllowed) return;

    if (isPenActive.current && event.pointerType === 'pen') {
        isPenActive.current = false;
    }

    const context = getCanvasContext();
    if (!context) return;
    context.closePath();
    setIsDrawing(false);
  }, [isDrawing, getCanvasContext, isDeviceAllowed]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (canvas && context) {
      const dpi = window.devicePixelRatio;
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width / dpi, canvas.height / dpi);
    }
  }, [getCanvasContext]);

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
  }, [getCanvasContext, clearCanvas, getAuthHeaders]);
  
  const saveSoragaki = useCallback(async () => {
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
  }, [selectedDate, getAuthHeaders]);

  return {
    canvasRef,
    isLoading,
    error,
    clearCanvas,
    saveSoragaki,
    loadSoragaki,
  };
}
