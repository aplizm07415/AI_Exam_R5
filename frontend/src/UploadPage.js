import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { FileUpIcon, LoaderIcon, CheckCircleIcon } from './components/icons';
const API_BASE_URL = "/api";
export default function UploadPage({ onUploadSuccess }) {
    const [file, setFile] = useState(null);
    const [subjectName, setSubjectName] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const handleFileChange = (event) => {
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
            if (!response.ok) {
                throw new Error(result.detail || 'アップロードに失敗しました。');
            }
            setStatus(`「${subjectName.trim()}」のアップロード完了。総問題数: ${result.total_problems}`);
            onUploadSuccess();
            setFile(null);
            setSubjectName('');
        }
        catch (e) {
            setError(e.message || 'アップロード中にエラーが発生しました。');
        }
        finally {
            setIsUploading(false);
        }
    };
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs("div", { className: "bg-gray-800 rounded-xl shadow-lg p-6 md:p-8 space-y-6", children: [_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "subjectName", className: "block text-sm font-medium text-gray-400 mb-1", children: "\u79D1\u76EE\u540D" }), _jsx("input", { type: "text", id: "subjectName", value: subjectName, onChange: (e) => setSubjectName(e.target.value), placeholder: "\u4F8B: \u300C\u3007\u3007\u80FD\u529B\u8A66\u9A13\u300D", className: "w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500", disabled: isUploading })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "file-upload", className: "block text-sm font-medium text-gray-400 mb-1", children: "\u554F\u984C\u30D5\u30A1\u30A4\u30EB (.json)" }), _jsx("div", { className: "mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md", children: _jsxs("div", { className: "space-y-1 text-center", children: [_jsx(FileUpIcon, { className: "mx-auto h-12 w-12 text-gray-500" }), _jsxs("div", { className: "flex text-sm text-gray-400", children: [_jsxs("label", { htmlFor: "file-upload", className: "relative cursor-pointer bg-gray-800 rounded-md font-medium text-indigo-400 hover:text-indigo-300 focus-within:outline-none", children: [_jsx("span", { children: "\u30D5\u30A1\u30A4\u30EB\u3092\u9078\u629E" }), _jsx("input", { id: "file-upload", name: "file-upload", type: "file", className: "sr-only", accept: ".json", onChange: handleFileChange, disabled: isUploading })] }), _jsx("p", { className: "pl-1", children: "\u307E\u305F\u306F\u30C9\u30E9\u30C3\u30B0\uFF06\u30C9\u30ED\u30C3\u30D7" })] }), _jsx("p", { className: "text-xs text-gray-500", children: file ? file.name : '単一のJSONファイル' })] }) })] }), _jsxs("button", { onClick: handleUpload, disabled: !file || !subjectName.trim() || isUploading, className: "w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500", children: [isUploading ? _jsx(LoaderIcon, { className: "w-5 h-5" }) : _jsx(FileUpIcon, { className: "w-5 h-5" }), _jsx("span", { children: isUploading ? 'アップロード中...' : 'データをアップロード' })] })] }), _jsxs("div", { className: "mt-6 min-h-[40px] flex items-center justify-center", children: [error && _jsx("p", { className: "text-red-400 text-sm text-center", children: error }), status && !error && (_jsxs("div", { className: "text-green-400 text-sm text-center flex items-center justify-center gap-2", children: [_jsx(CheckCircleIcon, { className: "w-5 h-5" }), _jsx("span", { children: status })] }))] })] }) }));
}
//# sourceMappingURL=UploadPage.js.map