import React, { useState } from 'react';
import { FileUpIcon, LoaderIcon, CheckCircleIcon } from './components/icons';

const API_BASE_URL = "/api";

interface UploadPageProps {
  onUploadSuccess: () => void;
}

export default function UploadPage({ onUploadSuccess }: UploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
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
      onUploadSuccess();
      setFile(null);
      setSubjectName('');
    } catch (e: any) {
      setError(e.message || 'アップロード中にエラーが発生しました。');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white">データ管理</h2>
        <p className="text-gray-400 mt-2">問題データをアップロードし、科目ごとに統合します。</p>
      </div>

      <div className="bg-gray-800 rounded-xl shadow-lg p-6 md:p-8 space-y-6">
        <div className="space-y-4">
          <div>
            <label htmlFor="subjectName" className="block text-sm font-medium text-gray-400 mb-1">科目名</label>
            <input type="text" id="subjectName" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="例: 「〇〇能力試験」" className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" disabled={isUploading} />
          </div>
          <div>
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-400 mb-1">問題ファイル (.json)</label>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md">
              <div className="space-y-1 text-center">
                <FileUpIcon className="mx-auto h-12 w-12 text-gray-500" />
                <div className="flex text-sm text-gray-400">
                  <label htmlFor="file-upload" className="relative cursor-pointer bg-gray-800 rounded-md font-medium text-indigo-400 hover:text-indigo-300 focus-within:outline-none">
                    <span>ファイルを選択</span>
                    <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".json" onChange={handleFileChange} disabled={isUploading} />
                  </label>
                  <p className="pl-1">またはドラッグ＆ドロップ</p>
                </div>
                <p className="text-xs text-gray-500">{file ? file.name : '単一のJSONファイル'}</p>
              </div>
            </div>
          </div>
          <button onClick={handleUpload} disabled={!file || !subjectName.trim() || isUploading} className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500">
            {isUploading ? <LoaderIcon className="w-5 h-5" /> : <FileUpIcon className="w-5 h-5" />}
            <span>{isUploading ? 'アップロード中...' : 'データをアップロード'}</span>
          </button>
        </div>

        <div className="mt-6 min-h-[40px] flex items-center justify-center">
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          {status && !error && (
            <div className="text-green-400 text-sm text-center flex items-center justify-center gap-2">
              <CheckCircleIcon className="w-5 h-5" />
              <span>{status}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}