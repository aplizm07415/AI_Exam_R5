
import React, { useState } from 'react';
import { FileUpIcon, LoaderIcon, CheckCircleIcon, TrashIcon, BrainCircuitIcon } from '../components/icons.tsx';

const API_BASE_URL = "http://127.0.0.1:8000/api";

interface UploadPageProps {
  onUploadSuccess: (subject: string) => void;
  startAnalysis: (subject: string) => Promise<void>;
  analysisState: { subject: string; status: 'idle' | 'polling' | 'complete' | 'error' };
}

export default function UploadPage({ onUploadSuccess, startAnalysis, analysisState }: UploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isUploaded, setIsUploaded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setFile(event.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !subjectName.trim()) {
      setError('ファイルを選択し、科目名を入力してください。');
      return;
    }
    setError('');
    setStatus('');
    setIsUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('subject', subjectName.trim());

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) { throw new Error(result.detail || 'アップロードに失敗しました。'); }
      
      setStatus(`「${subjectName.trim()}」のアップロード完了。総問題数: ${result.total_problems}`);
      setIsUploaded(true);
      onUploadSuccess(subjectName.trim());
    } catch (e: any) {
      setError(e.message || 'アップロード中にエラーが発生しました。');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyze = async () => {
    const subject = subjectName.trim();
    if (!subject) return;

    setError('');
    
    try {
      await startAnalysis(subject);
    } catch (e: any) {
      setError(e.message || 'AI分析の開始に失敗しました。');
    }
  };
  
  const resetForm = () => {
    setFile(null);
    setSubjectName('');
    setStatus('');
    setError('');
    setIsUploaded(false);
  };

  const isCurrentlyAnalyzing = analysisState.subject === subjectName.trim() && analysisState.status === 'polling';
  const analysisCompleteForSubject = analysisState.subject === subjectName.trim() && analysisState.status === 'complete';
  const analysisErrorForSubject = analysisState.subject === subjectName.trim() && analysisState.status === 'error';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white">データ管理</h2>
        <p className="text-gray-400 mt-2">問題データをアップロードし、科目ごとに統合してAI分析を実行します。</p>
      </div>

      <div className="bg-gray-800 rounded-xl shadow-lg p-6 md:p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div className="space-y-4">
            <label className="block text-lg font-semibold text-gray-200">ステップ1: アップロード</label>
            <div>
              <label htmlFor="subjectName" className="block text-sm font-medium text-gray-400 mb-1">科目名</label>
              <input type="text" id="subjectName" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="例: 「〇〇能力試験」" className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" disabled={isUploaded || isUploading || isCurrentlyAnalyzing} />
            </div>
            <div>
              <label htmlFor="file-upload" className="block text-sm font-medium text-gray-400 mb-1">問題ファイル (.json)</label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md">
                <div className="space-y-1 text-center">
                  <FileUpIcon className="mx-auto h-12 w-12 text-gray-500" />
                  <div className="flex text-sm text-gray-400">
                    <label htmlFor="file-upload" className="relative cursor-pointer bg-gray-800 rounded-md font-medium text-indigo-400 hover:text-indigo-300 focus-within:outline-none">
                      <span>ファイルを選択</span>
                      <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".json" onChange={handleFileChange} disabled={isUploaded || isUploading || isCurrentlyAnalyzing} />
                    </label>
                    <p className="pl-1">またはドラッグ＆ドロップ</p>
                  </div>
                  <p className="text-xs text-gray-500">{file ? file.name : '単一のJSONファイル'}</p>
                </div>
              </div>
            </div>
            <button onClick={handleUpload} disabled={!file || !subjectName.trim() || isUploaded || isUploading || isCurrentlyAnalyzing} className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500">
              {isUploading ? <LoaderIcon className="w-5 h-5" /> : null}
              <span>{isUploading ? 'アップロード中...' : 'データをアップロード'}</span>
            </button>
          </div>

          <div className="space-y-4">
            <label className="block text-lg font-semibold text-gray-200">ステップ2: AI分析</label>
            <div className="bg-gray-700/50 p-4 rounded-lg h-full flex flex-col justify-center items-center text-center">
              <p className="text-gray-400 mb-4">データをアップロードした後、AI分析を開始して解説やキーワードを生成できます。</p>
              <button onClick={handleAnalyze} disabled={!isUploaded || isCurrentlyAnalyzing} className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500">
                {isCurrentlyAnalyzing ? <LoaderIcon className="w-5 h-5" /> : <BrainCircuitIcon className="w-5 h-5" />}
                <span>{isCurrentlyAnalyzing ? '分析中...' : 'AI分析を開始'}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 min-h-[40px] flex items-center justify-center">
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          {status && !error && !isCurrentlyAnalyzing && ( // アップロードのステータスを表示
            <div className="text-green-400 text-sm text-center flex items-center justify-center gap-2">
              {(isUploading) ? <LoaderIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{status}</span>
            </div>
          )}
          {analysisCompleteForSubject && ( // AI分析完了のステータスを表示
            <div className="text-green-400 text-sm text-center flex items-center justify-center gap-2">
              <CheckCircleIcon className="w-5 h-5" />
              <span>「{analysisState.subject}」のAI分析が完了しました！</span>
            </div>
          )}
          {analysisErrorForSubject && ( // AI分析エラーのステータスを表示
            <div className="text-red-400 text-sm text-center flex items-center justify-center gap-2">
              <span>AI分析中にエラーが発生しました。バックエンドログを確認してください。</span>
            </div>
          )}

          {(isUploaded || isCurrentlyAnalyzing) && !isUploading && (
             <div className="text-center mt-4">
                <button onClick={resetForm} className="text-sm text-gray-400 hover:text-white flex items-center gap-1 mx-auto">
                    <TrashIcon className="w-4 h-4" />
                    別の科目をアップロードする
                </button>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}