import React, { useEffect, useMemo, useState } from 'react';

type PhotoItem = {
  id: string;
  display_name: string;
  original_filename: string;
  blob_name: string;
  content_type: string;
  size_bytes: number;
  tags: string[];
  uploaded_at: string;
  updated_at: string;
  upload_batch_id?: string | null;
  upload_index?: number | null;
  upload_count?: number | null;
};

type EditingState = {
  displayName: string;
  tagsText: string;
  saving: boolean;
  isEditing: boolean;
};

const API_BASE_URL = '/api';

const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ja-JP');
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const parseTags = (input: string): string[] =>
  input
    .split(/[\n,，]/g)
    .map((tag) => tag.trim())
    .filter(Boolean);

const photoFileUrl = (photoId: string) => `${API_BASE_URL}/photos/${encodeURIComponent(photoId)}/file`;

function PhotoViewerModal({
  photo,
  onClose,
}: {
  photo: PhotoItem;
  onClose: () => void;
}) {
  const isImage = photo.content_type.startsWith('image/');
  const isPdf = photo.content_type === 'application/pdf';

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-2 sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="画像ビューア">
      <div
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-gray-900">{photo.display_name}</p>
            <p className="truncate text-xs text-gray-500">{photo.original_filename}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isImage && <span className="text-xs text-gray-500">スマホはピンチ操作で拡大/縮小</span>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-black"
            >
              閉じる
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100">
          {isImage ? (
            <div
              className="flex min-h-full min-w-full items-center justify-center p-2 sm:p-4"
              style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
            >
              <img
                src={photoFileUrl(photo.id)}
                alt={photo.display_name}
                className="h-auto w-auto max-w-full max-h-[70vh] rounded-lg shadow-lg sm:max-h-[78vh]"
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={photoFileUrl(photo.id)}
              title={photo.display_name}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md rounded-xl bg-white p-6 text-center shadow">
                <p className="text-sm text-gray-600">この形式はモーダル内プレビュー未対応です。</p>
                <a
                  href={photoFileUrl(photo.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex rounded-md bg-primary-new px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  別タブで開く
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhotoCard({
  photo,
  editing,
  onChangeEditing,
  onSave,
  onStartEdit,
  onCancelEdit,
  onOpen,
}: {
  photo: PhotoItem;
  editing: EditingState;
  onChangeEditing: (next: EditingState) => void;
  onSave: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onOpen}
        className="group block w-full bg-gray-100"
      >
        {photo.content_type.startsWith('image/') ? (
          <img
            src={photoFileUrl(photo.id)}
            alt={photo.display_name}
            className="h-44 w-full object-cover transition duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-44 items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-700">{photo.content_type === 'application/pdf' ? 'PDF' : 'FILE'}</p>
              <p className="mt-1 text-xs text-gray-500">クリックで開く</p>
            </div>
          </div>
        )}
      </button>

      <div className="space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">表示名</label>
          {editing.isEditing ? (
            <input
              type="text"
              value={editing.displayName}
              onChange={(e) => onChangeEditing({ ...editing, displayName: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          ) : (
            <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
              {photo.display_name}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">タグ</label>
          {editing.isEditing ? (
            <>
              <input
                type="text"
                value={editing.tagsText}
                onChange={(e) => onChangeEditing({ ...editing, tagsText: e.target.value })}
                placeholder="例: 財務, CVP, 過去問"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-xs text-gray-500">カンマ区切りで入力</p>
            </>
          ) : (
            <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              編集ボタン押下で変更
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {photo.tags.length > 0 ? (
            photo.tags.map((tag) => (
              <span key={`${photo.id}-${tag}`} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                #{tag}
              </span>
            ))
          ) : (
            <span className="text-xs text-gray-400">タグ未設定</span>
          )}
        </div>

        <div className="space-y-1 text-xs text-gray-500">
          <p>元ファイル: {photo.original_filename}</p>
          <p>容量: {formatFileSize(photo.size_bytes)} / {photo.content_type}</p>
          <p>更新: {formatDateTime(photo.updated_at)}</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            開く
          </button>
          {editing.isEditing ? (
            <>
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={editing.saving}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={editing.saving}
                className="flex-1 rounded-md bg-primary-new px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editing.saving ? '保存中...' : '保存'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onStartEdit}
              className="flex-1 rounded-md bg-primary-new px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              編集
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PhotoPage() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const [editingMap, setEditingMap] = useState<Record<string, EditingState>>({});
  const [tagFilter, setTagFilter] = useState('');

  const syncEditingState = (items: PhotoItem[]) => {
    setEditingMap((prev) => {
      const next: Record<string, EditingState> = {};
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
      const data = (await response.json()) as PhotoItem[];
      setPhotos(data);
      syncEditingState(data);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : '写真一覧の取得に失敗しました。');
    } finally {
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
    if (!keyword) return photos;
    return photos.filter((photo) => photo.tags.some((tag) => tag.toLowerCase().includes(keyword)));
  }, [photos, tagFilter]);

  const groupedFilteredPhotos = useMemo(() => {
    const groups = new Map<string, { key: string; batchId: string | null; uploadedAt: string; expectedCount: number; items: PhotoItem[] }>();
    for (const photo of filteredPhotos) {
      const key = photo.upload_batch_id ?? `single-${photo.id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(photo);
        if (photo.upload_count && photo.upload_count > existing.expectedCount) {
          existing.expectedCount = photo.upload_count;
        }
      } else {
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
          if (ai !== bi) return ai - bi;
          return a.display_name.localeCompare(b.display_name);
        }),
      }))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }, [filteredPhotos]);

  const handleFileChange = (files: FileList | null) => {
    const nextFiles = files ? Array.from(files) : [];
    setSelectedFiles(nextFiles);
    if (nextFiles.length > 0 && !displayName.trim()) {
      if (nextFiles.length === 1) {
        setDisplayName(nextFiles[0]!.name.replace(/\.[^.]+$/, ''));
      } else {
        setDisplayName(nextFiles[0]!.name.replace(/\.[^.]+$/, '') + ' セット');
      }
    }
  };

  const handleUpload = async (event: React.FormEvent) => {
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
      const created = (await response.json()) as PhotoItem[];
      setPhotos((prev) => [...created, ...prev]);
      clearSelection();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'アップロードに失敗しました。');
    } finally {
      setUploading(false);
    }
  };

  const clearSelection = () => {
    setSelectedFiles([]);
    setDisplayName('');
    setTagsText('');
    const input = document.getElementById('photo-upload-input') as HTMLInputElement | null;
    if (input) input.value = '';
  };

  const handleSave = async (photo: PhotoItem) => {
    const editing = editingMap[photo.id];
    if (!editing) return;
    const nextName = editing.displayName.trim();
    if (!nextName) {
      alert('表示名を入力してください。');
      return;
    }

    setEditingMap((prev) => ({
      ...prev,
      [photo.id]: { ...prev[photo.id]!, saving: true },
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
      const updated = (await response.json()) as PhotoItem;
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
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : '保存に失敗しました。');
    } finally {
      setEditingMap((prev) => ({
        ...prev,
        [photo.id]: { ...(prev[photo.id] ?? editing), saving: false },
      }));
    }
  };

  const startEdit = (photo: PhotoItem) => {
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

  const cancelEdit = (photo: PhotoItem) => {
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

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.9fr]">
        <section className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-xl font-bold text-dark">Photoアップロード</h2>
          <p className="mt-2 text-sm text-gray-600">
            Blobに保存する画像/ファイルに対して、一覧表示用の表示名とタグを設定できます。
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleUpload}>
            <div>
              <label htmlFor="photo-upload-input" className="mb-1 block text-sm font-medium text-gray-700">
                ファイル
              </label>
              <input
                id="photo-upload-input"
                type="file"
                multiple
                onChange={(e) => handleFileChange(e.target.files)}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
              />
              {selectedFiles.length > 0 && (
                <div className="mt-2 space-y-1 text-xs text-gray-500">
                  <p>選択中: {selectedFiles.length} 件</p>
                  {selectedFiles.slice(0, 3).map((file) => (
                    <p key={`${file.name}-${file.size}`}>- {file.name} ({formatFileSize(file.size)})</p>
                  ))}
                  {selectedFiles.length > 3 && <p>...ほか {selectedFiles.length - 3} 件</p>}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="photo-display-name" className="mb-1 block text-sm font-medium text-gray-700">
                一覧表示名（複数選択時は連番を自動付与）
              </label>
              <input
                id="photo-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例: CVP分析の手書きまとめ"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label htmlFor="photo-tags" className="mb-1 block text-sm font-medium text-gray-700">
                タグ
              </label>
              <input
                id="photo-tags"
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="例: 財務, 計算, 過去問"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-xs text-gray-500">カンマ区切り（後から修正可能）</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={clearSelection}
                disabled={uploading || selectedFiles.length === 0}
                className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                選択クリア
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex w-full items-center justify-center rounded-md bg-primary-new px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? 'アップロード中...' : 'アップロード'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-dark">アップロード一覧</h2>
              <p className="text-sm text-gray-600">表示名・タグはカード上で編集して保存できます。</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <input
                type="text"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder="タグで絞り込み"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-52"
              />
              <button
                type="button"
                onClick={() => void fetchPhotos()}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                再読込
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="mt-6 text-sm text-gray-500">読み込み中...</div>
          ) : groupedFilteredPhotos.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              {photos.length === 0 ? 'まだアップロードがありません。' : '条件に合う写真がありません。'}
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {groupedFilteredPhotos.map((group) => (
                <section key={group.key} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {group.batchId ? '一括アップロード' : '単体アップロード'}
                        {' '}
                        ({group.items.length}
                        {group.expectedCount > group.items.length ? ` / ${group.expectedCount}` : ''}
                        枚表示)
                      </p>
                      <p className="text-xs text-gray-500">アップロード日時: {formatDateTime(group.uploadedAt)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.items.map((photo) => {
                      const editing = editingMap[photo.id] ?? {
                        displayName: photo.display_name,
                        tagsText: photo.tags.join(', '),
                        saving: false,
                        isEditing: false,
                      };
                      return (
                        <PhotoCard
                          key={photo.id}
                          photo={photo}
                          editing={editing}
                          onChangeEditing={(next) => setEditingMap((prev) => ({ ...prev, [photo.id]: next }))}
                          onSave={() => void handleSave(photo)}
                          onStartEdit={() => startEdit(photo)}
                          onCancelEdit={() => cancelEdit(photo)}
                          onOpen={() => setSelectedPhoto(photo)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedPhoto && (
        <PhotoViewerModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
      )}
    </div>
  );
}
