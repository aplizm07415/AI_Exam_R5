import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { formatDateTimeJst } from './utils/date';
const API_BASE_URL = '/api';
const formatDateTime = (iso) => {
    return formatDateTimeJst(iso);
};
const formatFileSize = (bytes) => {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const parseTags = (input) => input
    .split(/[\n,，]/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
const photoFileUrl = (photoId) => `${API_BASE_URL}/photos/${encodeURIComponent(photoId)}/file`;
function PhotoViewerModal({ photo, onClose, }) {
    const isImage = photo.content_type.startsWith('image/');
    const isPdf = photo.content_type === 'application/pdf';
    useEffect(() => {
        const onKeydown = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        window.addEventListener('keydown', onKeydown);
        return () => window.removeEventListener('keydown', onKeydown);
    }, [onClose]);
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);
    return (_jsx("div", { className: "fixed inset-0 z-50 bg-black/70 p-2 sm:p-4", onClick: onClose, role: "dialog", "aria-modal": "true", "aria-label": "\u753B\u50CF\u30D3\u30E5\u30FC\u30A2", children: _jsxs("div", { className: "mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-base font-semibold text-gray-900", children: photo.display_name }), _jsx("p", { className: "truncate text-xs text-gray-500", children: photo.original_filename })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [isImage && _jsx("span", { className: "text-xs text-gray-500", children: "\u30B9\u30DE\u30DB\u306F\u30D4\u30F3\u30C1\u64CD\u4F5C\u3067\u62E1\u5927/\u7E2E\u5C0F" }), _jsx("button", { type: "button", onClick: onClose, className: "rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-black", children: "\u9589\u3058\u308B" })] })] }), _jsx("div", { className: "flex-1 overflow-auto bg-gray-100", children: isImage ? (_jsx("div", { className: "flex min-h-full min-w-full items-center justify-center p-2 sm:p-4", style: { touchAction: 'pan-x pan-y pinch-zoom' }, children: _jsx("img", { src: photoFileUrl(photo.id), alt: photo.display_name, className: "h-auto w-auto max-w-full max-h-[70vh] rounded-lg shadow-lg sm:max-h-[78vh]" }) })) : isPdf ? (_jsx("iframe", { src: photoFileUrl(photo.id), title: photo.display_name, className: "h-full w-full" })) : (_jsx("div", { className: "flex h-full items-center justify-center p-6", children: _jsxs("div", { className: "max-w-md rounded-xl bg-white p-6 text-center shadow", children: [_jsx("p", { className: "text-sm text-gray-600", children: "\u3053\u306E\u5F62\u5F0F\u306F\u30E2\u30FC\u30C0\u30EB\u5185\u30D7\u30EC\u30D3\u30E5\u30FC\u672A\u5BFE\u5FDC\u3067\u3059\u3002" }), _jsx("a", { href: photoFileUrl(photo.id), target: "_blank", rel: "noreferrer", className: "mt-4 inline-flex rounded-md bg-primary-new px-4 py-2 text-sm font-medium text-white hover:bg-blue-700", children: "\u5225\u30BF\u30D6\u3067\u958B\u304F" })] }) })) })] }) }));
}
function PhotoCard({ photo, editing, onChangeEditing, onSave, onStartEdit, onCancelEdit, onOpen, }) {
    return (_jsxs("div", { className: "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm", children: [_jsx("button", { type: "button", onClick: onOpen, className: "group block w-full bg-gray-100", children: photo.content_type.startsWith('image/') ? (_jsx("img", { src: photoFileUrl(photo.id), alt: photo.display_name, className: "h-44 w-full object-cover transition duration-200 group-hover:scale-[1.02]", loading: "lazy" })) : (_jsx("div", { className: "flex h-44 items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200", children: _jsxs("div", { className: "text-center", children: [_jsx("p", { className: "text-lg font-semibold text-gray-700", children: photo.content_type === 'application/pdf' ? 'PDF' : 'FILE' }), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "\u30AF\u30EA\u30C3\u30AF\u3067\u958B\u304F" })] }) })) }), _jsxs("div", { className: "space-y-3 p-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500", children: "\u8868\u793A\u540D" }), editing.isEditing ? (_jsx("input", { type: "text", value: editing.displayName, onChange: (e) => onChangeEditing({ ...editing, displayName: e.target.value }), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100" })) : (_jsx("div", { className: "w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800", children: photo.display_name }))] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500", children: "\u30BF\u30B0" }), editing.isEditing ? (_jsxs(_Fragment, { children: [_jsx("input", { type: "text", value: editing.tagsText, onChange: (e) => onChangeEditing({ ...editing, tagsText: e.target.value }), placeholder: "\u4F8B: \u8CA1\u52D9, CVP, \u904E\u53BB\u554F", className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100" }), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "\u30AB\u30F3\u30DE\u533A\u5207\u308A\u3067\u5165\u529B" })] })) : (_jsx("div", { className: "w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500", children: "\u7DE8\u96C6\u30DC\u30BF\u30F3\u62BC\u4E0B\u3067\u5909\u66F4" }))] }), _jsx("div", { className: "flex flex-wrap gap-2", children: photo.tags.length > 0 ? (photo.tags.map((tag) => (_jsxs("span", { className: "rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700", children: ["#", tag] }, `${photo.id}-${tag}`)))) : (_jsx("span", { className: "text-xs text-gray-400", children: "\u30BF\u30B0\u672A\u8A2D\u5B9A" })) }), _jsxs("div", { className: "space-y-1 text-xs text-gray-500", children: [_jsxs("p", { children: ["\u5143\u30D5\u30A1\u30A4\u30EB: ", photo.original_filename] }), _jsxs("p", { children: ["\u5BB9\u91CF: ", formatFileSize(photo.size_bytes), " / ", photo.content_type] }), _jsxs("p", { children: ["\u66F4\u65B0: ", formatDateTime(photo.updated_at)] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: onOpen, className: "flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u958B\u304F" }), editing.isEditing ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: onCancelEdit, disabled: editing.saving, className: "flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60", children: "\u30AD\u30E3\u30F3\u30BB\u30EB" }), _jsx("button", { type: "button", onClick: onSave, disabled: editing.saving, className: "flex-1 rounded-md bg-primary-new px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60", children: editing.saving ? '保存中...' : '保存' })] })) : (_jsx("button", { type: "button", onClick: onStartEdit, className: "flex-1 rounded-md bg-primary-new px-3 py-2 text-sm font-medium text-white hover:bg-blue-700", children: "\u7DE8\u96C6" }))] })] })] }));
}
export default function PhotoPage() {
    const [photos, setPhotos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [displayName, setDisplayName] = useState('');
    const [tagsText, setTagsText] = useState('');
    const [uploading, setUploading] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState(null);
    const [editingMap, setEditingMap] = useState({});
    const [tagFilter, setTagFilter] = useState('');
    const syncEditingState = (items) => {
        setEditingMap((prev) => {
            const next = {};
            for (const item of items) {
                const existing = prev[item.id];
                next[item.id] = existing ?? {
                    displayName: item.display_name,
                    tagsText: item.tags.join(', '),
                    saving: false,
                    isEditing: false,
                };
            }
            return next;
        });
    };
    const fetchPhotos = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/photos`);
            if (!response.ok) {
                throw new Error(`一覧取得失敗 (${response.status})`);
            }
            const data = (await response.json());
            setPhotos(data);
            syncEditingState(data);
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : '写真一覧の取得に失敗しました。');
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void fetchPhotos();
    }, []);
    useEffect(() => {
        syncEditingState(photos);
    }, [photos]);
    const filteredPhotos = useMemo(() => {
        const keyword = tagFilter.trim().toLowerCase();
        if (!keyword)
            return photos;
        return photos.filter((photo) => {
            const matchesTag = photo.tags.some((tag) => tag.toLowerCase().includes(keyword));
            const matchesDisplayName = photo.display_name.toLowerCase().includes(keyword);
            return matchesTag || matchesDisplayName;
        });
    }, [photos, tagFilter]);
    const groupedFilteredPhotos = useMemo(() => {
        const groups = new Map();
        for (const photo of filteredPhotos) {
            const key = photo.upload_batch_id ?? `single-${photo.id}`;
            const existing = groups.get(key);
            if (existing) {
                existing.items.push(photo);
                if (photo.upload_count && photo.upload_count > existing.expectedCount) {
                    existing.expectedCount = photo.upload_count;
                }
            }
            else {
                groups.set(key, {
                    key,
                    batchId: photo.upload_batch_id ?? null,
                    uploadedAt: photo.uploaded_at,
                    expectedCount: photo.upload_count ?? 1,
                    items: [photo],
                });
            }
        }
        return Array.from(groups.values())
            .map((group) => ({
            ...group,
            items: [...group.items].sort((a, b) => {
                const ai = a.upload_index ?? 9999;
                const bi = b.upload_index ?? 9999;
                if (ai !== bi)
                    return ai - bi;
                return a.display_name.localeCompare(b.display_name);
            }),
        }))
            .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }, [filteredPhotos]);
    const handleFileChange = (files) => {
        const nextFiles = files ? Array.from(files) : [];
        setSelectedFiles(nextFiles);
        if (nextFiles.length > 0 && !displayName.trim()) {
            if (nextFiles.length === 1) {
                setDisplayName(nextFiles[0].name.replace(/\.[^.]+$/, ''));
            }
            else {
                setDisplayName(nextFiles[0].name.replace(/\.[^.]+$/, '') + ' セット');
            }
        }
    };
    const handleUpload = async (event) => {
        event.preventDefault();
        if (selectedFiles.length === 0) {
            alert('アップロードするファイルを1つ以上選択してください。');
            return;
        }
        if (!displayName.trim()) {
            alert('一覧表示用の表示名を入力してください。');
            return;
        }
        setUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            for (const file of selectedFiles) {
                formData.append('files', file);
            }
            formData.append('display_name', displayName.trim());
            formData.append('tags_json', JSON.stringify(parseTags(tagsText)));
            const response = await fetch(`${API_BASE_URL}/photos`, {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || `アップロード失敗 (${response.status})`);
            }
            const created = (await response.json());
            setPhotos((prev) => [...created, ...prev]);
            clearSelection();
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : 'アップロードに失敗しました。');
        }
        finally {
            setUploading(false);
        }
    };
    const clearSelection = () => {
        setSelectedFiles([]);
        setDisplayName('');
        setTagsText('');
        const input = document.getElementById('photo-upload-input');
        if (input)
            input.value = '';
    };
    const handleSave = async (photo) => {
        const editing = editingMap[photo.id];
        if (!editing)
            return;
        const nextName = editing.displayName.trim();
        if (!nextName) {
            alert('表示名を入力してください。');
            return;
        }
        setEditingMap((prev) => ({
            ...prev,
            [photo.id]: { ...prev[photo.id], saving: true },
        }));
        try {
            const response = await fetch(`${API_BASE_URL}/photos/${encodeURIComponent(photo.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    display_name: nextName,
                    tags: parseTags(editing.tagsText),
                }),
            });
            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || `保存失敗 (${response.status})`);
            }
            const updated = (await response.json());
            setPhotos((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            if (selectedPhoto?.id === updated.id) {
                setSelectedPhoto(updated);
            }
            setEditingMap((prev) => ({
                ...prev,
                [photo.id]: {
                    displayName: updated.display_name,
                    tagsText: updated.tags.join(', '),
                    saving: false,
                    isEditing: false,
                },
            }));
        }
        catch (e) {
            console.error(e);
            alert(e instanceof Error ? e.message : '保存に失敗しました。');
        }
        finally {
            setEditingMap((prev) => ({
                ...prev,
                [photo.id]: { ...(prev[photo.id] ?? editing), saving: false },
            }));
        }
    };
    const startEdit = (photo) => {
        setEditingMap((prev) => ({
            ...prev,
            [photo.id]: {
                displayName: photo.display_name,
                tagsText: photo.tags.join(', '),
                saving: false,
                isEditing: true,
            },
        }));
    };
    const cancelEdit = (photo) => {
        setEditingMap((prev) => ({
            ...prev,
            [photo.id]: {
                displayName: photo.display_name,
                tagsText: photo.tags.join(', '),
                saving: false,
                isEditing: false,
            },
        }));
    };
    return (_jsxs("div", { className: "mx-auto max-w-7xl space-y-8", children: [_jsxs("div", { className: "grid gap-6 lg:grid-cols-[1.1fr_1.9fr]", children: [_jsxs("section", { className: "rounded-2xl bg-white p-6 shadow", children: [_jsx("h2", { className: "text-xl font-bold text-dark", children: "Photo\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9" }), _jsx("p", { className: "mt-2 text-sm text-gray-600", children: "Blob\u306B\u4FDD\u5B58\u3059\u308B\u753B\u50CF/\u30D5\u30A1\u30A4\u30EB\u306B\u5BFE\u3057\u3066\u3001\u4E00\u89A7\u8868\u793A\u7528\u306E\u8868\u793A\u540D\u3068\u30BF\u30B0\u3092\u8A2D\u5B9A\u3067\u304D\u307E\u3059\u3002" }), _jsxs("form", { className: "mt-5 space-y-4", onSubmit: handleUpload, children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "photo-upload-input", className: "mb-1 block text-sm font-medium text-gray-700", children: "\u30D5\u30A1\u30A4\u30EB" }), _jsx("input", { id: "photo-upload-input", type: "file", multiple: true, onChange: (e) => handleFileChange(e.target.files), className: "block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" }), selectedFiles.length > 0 && (_jsxs("div", { className: "mt-2 space-y-1 text-xs text-gray-500", children: [_jsxs("p", { children: ["\u9078\u629E\u4E2D: ", selectedFiles.length, " \u4EF6"] }), selectedFiles.slice(0, 3).map((file) => (_jsxs("p", { children: ["- ", file.name, " (", formatFileSize(file.size), ")"] }, `${file.name}-${file.size}`))), selectedFiles.length > 3 && _jsxs("p", { children: ["...\u307B\u304B ", selectedFiles.length - 3, " \u4EF6"] })] }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "photo-display-name", className: "mb-1 block text-sm font-medium text-gray-700", children: "\u4E00\u89A7\u8868\u793A\u540D\uFF08\u8907\u6570\u9078\u629E\u6642\u306F\u9023\u756A\u3092\u81EA\u52D5\u4ED8\u4E0E\uFF09" }), _jsx("input", { id: "photo-display-name", type: "text", value: displayName, onChange: (e) => setDisplayName(e.target.value), placeholder: "\u4F8B: CVP\u5206\u6790\u306E\u624B\u66F8\u304D\u307E\u3068\u3081", className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "photo-tags", className: "mb-1 block text-sm font-medium text-gray-700", children: "\u30BF\u30B0" }), _jsx("input", { id: "photo-tags", type: "text", value: tagsText, onChange: (e) => setTagsText(e.target.value), placeholder: "\u4F8B: \u8CA1\u52D9, \u8A08\u7B97, \u904E\u53BB\u554F", className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100" }), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "\u30AB\u30F3\u30DE\u533A\u5207\u308A\uFF08\u5F8C\u304B\u3089\u4FEE\u6B63\u53EF\u80FD\uFF09" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: clearSelection, disabled: uploading || selectedFiles.length === 0, className: "inline-flex w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60", children: "\u9078\u629E\u30AF\u30EA\u30A2" }), _jsx("button", { type: "submit", disabled: uploading, className: "inline-flex w-full items-center justify-center rounded-md bg-primary-new px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60", children: uploading ? 'アップロード中...' : 'アップロード' })] })] })] }), _jsxs("section", { className: "rounded-2xl bg-white p-6 shadow", children: [_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-dark", children: "\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u4E00\u89A7" }), _jsx("p", { className: "text-sm text-gray-600", children: "\u8868\u793A\u540D\u30FB\u30BF\u30B0\u306F\u30AB\u30FC\u30C9\u4E0A\u3067\u7DE8\u96C6\u3057\u3066\u4FDD\u5B58\u3067\u304D\u307E\u3059\u3002" })] }), _jsxs("div", { className: "flex w-full gap-2 sm:w-auto", children: [_jsx("input", { type: "text", value: tagFilter, onChange: (e) => setTagFilter(e.target.value), placeholder: "\u30BF\u30B0 / \u8868\u793A\u540D\u3067\u7D5E\u308A\u8FBC\u307F", className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-52" }), _jsx("button", { type: "button", onClick: () => void fetchPhotos(), className: "rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u518D\u8AAD\u8FBC" })] })] }), error && (_jsx("div", { className: "mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700", children: error })), loading ? (_jsx("div", { className: "mt-6 text-sm text-gray-500", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })) : groupedFilteredPhotos.length === 0 ? (_jsx("div", { className: "mt-6 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500", children: photos.length === 0 ? 'まだアップロードがありません。' : '条件に合う写真がありません。' })) : (_jsx("div", { className: "mt-6 space-y-6", children: groupedFilteredPhotos.map((group) => (_jsxs("section", { className: "rounded-2xl border border-gray-200 bg-gray-50/60 p-4", children: [_jsx("div", { className: "mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between", children: _jsxs("div", { children: [_jsxs("p", { className: "text-sm font-semibold text-gray-800", children: [group.batchId ? '一括アップロード' : '単体アップロード', ' ', "(", group.items.length, group.expectedCount > group.items.length ? ` / ${group.expectedCount}` : '', "\u679A\u8868\u793A)"] }), _jsxs("p", { className: "text-xs text-gray-500", children: ["\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u65E5\u6642: ", formatDateTime(group.uploadedAt)] })] }) }), _jsx("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", children: group.items.map((photo) => {
                                                const editing = editingMap[photo.id] ?? {
                                                    displayName: photo.display_name,
                                                    tagsText: photo.tags.join(', '),
                                                    saving: false,
                                                    isEditing: false,
                                                };
                                                return (_jsx(PhotoCard, { photo: photo, editing: editing, onChangeEditing: (next) => setEditingMap((prev) => ({ ...prev, [photo.id]: next })), onSave: () => void handleSave(photo), onStartEdit: () => startEdit(photo), onCancelEdit: () => cancelEdit(photo), onOpen: () => setSelectedPhoto(photo) }, photo.id));
                                            }) })] }, group.key))) }))] })] }), selectedPhoto && (_jsx(PhotoViewerModal, { photo: selectedPhoto, onClose: () => setSelectedPhoto(null) }))] }));
}
//# sourceMappingURL=PhotoPage.js.map