import React from 'react';
interface UseSoragakiCanvasProps {
    selectedDate: string;
    isDeviceAllowed: boolean;
    getAuthHeaders: () => {
        [key: string]: string;
    };
}
interface UseSoragakiCanvasResult {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    isLoading: boolean;
    error: string | null;
    clearCanvas: () => void;
    saveSoragaki: () => Promise<void>;
    loadSoragaki: (date: string) => Promise<void>;
}
export declare function useSoragakiCanvas({ selectedDate, isDeviceAllowed, getAuthHeaders }: UseSoragakiCanvasProps): UseSoragakiCanvasResult;
export {};
//# sourceMappingURL=useSoragakiCanvas.d.ts.map