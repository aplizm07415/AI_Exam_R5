import React, { useEffect, useMemo, useState } from 'react';

const API_BASE_URL = '/api';
const PASS_SCORE = 60;

interface Subject {
  name: string;
}

interface PastExamRecordCell {
  attempted_at?: string | null;
  score?: number | null;
}

interface PastExamRecordRow {
  id: string;
  label: string;
  cells: Record<string, PastExamRecordCell>;
}

interface PastExamRecordsBook {
  subject_columns: string[];
  problem_json_mappings: Record<string, string[]>;
  rows: PastExamRecordRow[];
  updated_at?: string | null;
}

interface PastExamRecordsPanelProps {
  subjects: Subject[];
}

const emptyBook: PastExamRecordsBook = {
  subject_columns: [
    '財務・会計',
    '企業経営理論',
    '運営管理',
    '経営法務',
    '経営情報システム',
    '中小企業経営・中小企業政策',
  ],
  problem_json_mappings: {},
  rows: [],
  updated_at: null,
};

function createRecordId() {
  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDateTimeInputValue(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 16);
}

function normalizeScoreInput(value: string) {
  if (value.trim() === '') return null;
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  return Math.max(0, Math.min(100, next));
}

export default function PastExamRecordsPanel({ subjects }: PastExamRecordsPanelProps) {
  const [book, setBook] = useState<PastExamRecordsBook>(emptyBook);
  const [newRowLabel, setNewRowLabel] = useState('');
  const [newSubjectColumn, setNewSubjectColumn] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const completedCellCount = useMemo(() => {
    return book.rows.reduce((count, row) => {
      return count + book.subject_columns.filter((subject) => row.cells[subject]?.score != null).length;
    }, 0);
  }, [book.rows, book.subject_columns]);

  const passedCellCount = useMemo(() => {
    return book.rows.reduce((count, row) => {
      return count + book.subject_columns.filter((subject) => {
        const score = row.cells[subject]?.score;
        return typeof score === 'number' && score >= PASS_SCORE;
      }).length;
    }, 0);
  }, [book.rows, book.subject_columns]);

  const mappedColumnCount = useMemo(() => {
    return book.subject_columns.filter((subject) => (book.problem_json_mappings[subject] ?? []).length > 0).length;
  }, [book.problem_json_mappings, book.subject_columns]);

  useEffect(() => {
    let isMounted = true;

    const loadRecords = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE_URL}/dashboard/past-exam-records`);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || '過去問と模試記録の取得に失敗しました。');
        }
        if (isMounted) {
          setBook(data);
          setIsDirty(false);
        }
      } catch (e: any) {
        if (isMounted) {
          setError(e.message || '過去問と模試記録の取得に失敗しました。');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadRecords();
    return () => {
      isMounted = false;
    };
  }, []);

  const updateBook = (updater: (current: PastExamRecordsBook) => PastExamRecordsBook) => {
    setBook((current) => updater(current));
    setIsDirty(true);
    setMessage('');
  };

  const addRow = () => {
    const label = newRowLabel.trim();
    if (!label) return;
    updateBook((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          id: createRecordId(),
          label,
          cells: {},
        },
      ],
    }));
    setNewRowLabel('');
  };

  const updateRowLabel = (rowId: string, label: string) => {
    updateBook((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.id === rowId ? { ...row, label } : row)),
    }));
  };

  const deleteRow = (rowId: string) => {
    updateBook((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.id !== rowId),
    }));
  };

  const addSubjectColumn = () => {
    const subject = newSubjectColumn.trim();
    if (!subject || book.subject_columns.includes(subject)) return;
    updateBook((current) => ({
      ...current,
      subject_columns: [...current.subject_columns, subject],
    }));
    setNewSubjectColumn('');
  };

  const deleteSubjectColumn = (subject: string) => {
    if (book.subject_columns.length <= 1) return;
    updateBook((current) => {
      const nextMappings = { ...current.problem_json_mappings };
      delete nextMappings[subject];
      return {
        ...current,
        subject_columns: current.subject_columns.filter((column) => column !== subject),
        problem_json_mappings: nextMappings,
        rows: current.rows.map((row) => {
          const nextCells = { ...row.cells };
          delete nextCells[subject];
          return { ...row, cells: nextCells };
        }),
      };
    });
  };

  const updateCell = (
    rowId: string,
    subject: string,
    patch: Partial<PastExamRecordCell>,
  ) => {
    updateBook((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.id !== rowId) return row;
        const currentCell = row.cells[subject] ?? {};
        const nextCell = { ...currentCell, ...patch };
        const nextCells = { ...row.cells, [subject]: nextCell };
        return { ...row, cells: nextCells };
      }),
    }));
  };

  const toggleMappedSubject = (recordSubject: string, problemJsonName: string) => {
    updateBook((current) => {
      const currentMapped = current.problem_json_mappings[recordSubject] ?? [];
      const exists = currentMapped.includes(problemJsonName);
      const nextMapped = exists
        ? currentMapped.filter((name) => name !== problemJsonName)
        : [...currentMapped, problemJsonName];
      const nextMappings = { ...current.problem_json_mappings };
      if (nextMapped.length > 0) {
        nextMappings[recordSubject] = nextMapped;
      } else {
        delete nextMappings[recordSubject];
      }
      return { ...current, problem_json_mappings: nextMappings };
    });
  };

  const saveRecords = async () => {
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/past-exam-records`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(book),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || '過去問と模試記録の保存に失敗しました。');
      }
      setBook(data);
      setIsDirty(false);
      setMessage('保存しました。');
      window.dispatchEvent(new Event('dashboard:pastExamRecordsUpdated'));
    } catch (e: any) {
      setError(e.message || '過去問と模試記録の保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Exam Records</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">過去問と模試記録</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:min-w-[390px]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">入力済み</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{completedCellCount}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs font-semibold text-emerald-700">60点以上</p>
            <p className="mt-1 text-2xl font-bold text-emerald-800">{passedCellCount}</p>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-xs font-semibold text-sky-700">JSON対応</p>
            <p className="mt-1 text-2xl font-bold text-sky-900">{mappedColumnCount}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid flex-1 gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex-1">
              <span className="block text-xs font-semibold text-slate-600">年度・模試名</span>
              <input
                type="text"
                value={newRowLabel}
                onChange={(event) => setNewRowLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addRow();
                  }
                }}
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                placeholder="例: 令和6年度 / TAC模試"
              />
            </label>
            <button
              type="button"
              onClick={addRow}
              disabled={!newRowLabel.trim()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 sm:self-end"
            >
              行を追加
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex-1">
              <span className="block text-xs font-semibold text-slate-600">科目名</span>
              <input
                type="text"
                value={newSubjectColumn}
                onChange={(event) => setNewSubjectColumn(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSubjectColumn();
                  }
                }}
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                placeholder="例: 経済学・経済政策"
              />
            </label>
            <button
              type="button"
              onClick={addSubjectColumn}
              disabled={!newSubjectColumn.trim() || book.subject_columns.includes(newSubjectColumn.trim())}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 sm:self-end"
            >
              科目を追加
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void saveRecords()}
          disabled={isSaving || isLoading || !isDirty}
          className="rounded-md bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-500"
        >
          {isSaving ? '保存中...' : '保存'}
        </button>
      </div>

      {newSubjectColumn.trim() && book.subject_columns.includes(newSubjectColumn.trim()) && (
        <p className="mt-2 text-sm text-amber-700">同じ科目名がすでにあります。</p>
      )}

      {(error || message || isDirty) && (
        <div className="mt-3 text-sm">
          {error && <p className="text-rose-700">{error}</p>}
          {message && <p className="text-emerald-700">{message}</p>}
          {isDirty && !message && !error && <p className="text-slate-500">未保存の変更があります。</p>}
        </div>
      )}

      {!isLoading && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">問題JSONマッピング</p>
              <p className="text-xs text-slate-500">各科目列に対応する問題JSONを保存します。</p>
            </div>
            <p className="text-xs font-semibold text-slate-500">{mappedColumnCount}/{book.subject_columns.length}列</p>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {book.subject_columns.map((recordSubject) => (
              <div key={recordSubject} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-800" title={recordSubject}>{recordSubject}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {(book.problem_json_mappings[recordSubject] ?? []).length}件
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteSubjectColumn(recordSubject)}
                      disabled={book.subject_columns.length <= 1}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                    >
                      削除
                    </button>
                  </div>
                </div>
                <div className="mt-2 max-h-32 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-2">
                  {subjects.length === 0 ? (
                    <p className="text-xs text-slate-500">問題JSONなし</p>
                  ) : (
                    <div className="grid gap-1">
                      {subjects.map((subject) => (
                        <label key={`${recordSubject}-${subject.name}`} className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={(book.problem_json_mappings[recordSubject] ?? []).includes(subject.name)}
                            onChange={() => toggleMappedSubject(recordSubject, subject.name)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span className="truncate" title={subject.name}>{subject.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-500">読み込み中...</div>
        ) : (
          <table className="min-w-[980px] w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-left text-xs font-semibold text-slate-600">
              <tr>
                <th className="w-56 border-b border-slate-200 px-3 py-3">年度・模試</th>
                {book.subject_columns.map((subject) => (
                  <th key={subject} className="min-w-[12rem] border-b border-slate-200 px-3 py-3">
                    {subject}
                  </th>
                ))}
                <th className="w-24 border-b border-slate-200 px-3 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {book.rows.length === 0 ? (
                <tr>
                  <td colSpan={book.subject_columns.length + 2} className="px-3 py-8 text-center text-sm text-slate-500">
                    記録はまだありません。
                  </td>
                </tr>
              ) : (
                book.rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="align-top bg-slate-50 px-3 py-3">
                      <input
                        type="text"
                        value={row.label}
                        onChange={(event) => updateRowLabel(row.id, event.target.value)}
                        className="block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                      />
                    </td>
                    {book.subject_columns.map((subject) => {
                      const cell = row.cells[subject] ?? {};
                      const isPassed = typeof cell.score === 'number' && cell.score >= PASS_SCORE;
                      return (
                        <td
                          key={`${row.id}-${subject}`}
                          className={`align-top px-3 py-3 transition-colors ${
                            isPassed ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-200' : 'bg-white'
                          }`}
                        >
                          <div className="grid gap-2">
                            <input
                              type="datetime-local"
                              value={toDateTimeInputValue(cell.attempted_at)}
                              onChange={(event) => updateCell(row.id, subject, { attempted_at: event.target.value || null })}
                              className="block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={cell.score ?? ''}
                                onChange={(event) => updateCell(row.id, subject, { score: normalizeScoreInput(event.target.value) })}
                                className="block w-24 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                              />
                              <span className={`text-xs font-semibold ${isPassed ? 'text-emerald-700' : 'text-slate-400'}`}>
                                {isPassed ? '60点以上' : '点'}
                              </span>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    <td className="align-top px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => deleteRow(row.id)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
