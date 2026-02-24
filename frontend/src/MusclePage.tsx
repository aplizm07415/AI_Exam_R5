import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTimeJst, getTodayYmdJst } from './utils/date';

type MuscleRecordMethod = 'duration' | 'reps_weight' | 'running_manual';
type Mode = 'workout' | 'management';

type MuscleAudioItem = {
  id: string;
  display_name: string;
  original_filename: string;
  blob_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
};

type MuscleExercise = {
  id: string;
  name: string;
  record_method: MuscleRecordMethod;
  body_parts: string[];
  audio_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type MuscleRecord = {
  id: string;
  exercise_id: string;
  exercise_name: string;
  record_method: MuscleRecordMethod;
  performed_at: string;
  body_parts: string[];
  duration_seconds?: number | null;
  reps?: number | null;
  weight_kg?: number | null;
  distance_km?: number | null;
  memo: string;
  created_at: string;
  updated_at: string;
};

type ExerciseDraft = {
  id?: string;
  name: string;
  record_method: MuscleRecordMethod;
  body_parts: string[];
  audio_id: string;
  is_active: boolean;
};

type RecordDraft = {
  id?: string;
  exercise_id: string;
  performed_at_local: string;
  duration_seconds: string;
  reps: string;
  weight_kg: string;
  distance_km: string;
  memo: string;
};

const API_BASE_URL = '/api';

const BODY_PARTS_META: Array<{ key: string; label: string; side: 'front' | 'back' }> = [
  { key: 'neck', label: '首', side: 'front' },
  { key: 'shoulders', label: '肩', side: 'front' },
  { key: 'chest', label: '胸', side: 'front' },
  { key: 'biceps', label: '上腕(前)', side: 'front' },
  { key: 'forearms', label: '前腕', side: 'front' },
  { key: 'abs', label: '腹直筋', side: 'front' },
  { key: 'obliques', label: '腹斜筋', side: 'front' },
  { key: 'quads', label: '大腿前', side: 'front' },
  { key: 'calves', label: 'ふくらはぎ', side: 'back' },
  { key: 'hamstrings', label: '大腿後', side: 'back' },
  { key: 'glutes', label: '臀部', side: 'back' },
  { key: 'lower_back', label: '腰', side: 'back' },
  { key: 'upper_back', label: '背中', side: 'back' },
  { key: 'triceps', label: '上腕(後)', side: 'back' },
];

const METHOD_LABEL: Record<MuscleRecordMethod, string> = {
  duration: '秒数',
  reps_weight: '回数・重量',
  running_manual: 'ランニング(手入力)',
};

const defaultExerciseDraft = (): ExerciseDraft => ({
  name: '',
  record_method: 'duration',
  body_parts: [],
  audio_id: '',
  is_active: true,
});

const toDateTimeLocalInput = (iso?: string | null) => {
  const dt = iso ? new Date(iso) : new Date();
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
};

const defaultRecordDraft = (exerciseId = ''): RecordDraft => ({
  exercise_id: exerciseId,
  performed_at_local: toDateTimeLocalInput(),
  duration_seconds: '',
  reps: '',
  weight_kg: '',
  distance_km: '',
  memo: '',
});

const formatDuration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};

const recordSummaryText = (record: MuscleRecord) => {
  if (record.record_method === 'duration') return `${record.duration_seconds ?? 0} 秒`;
  if (record.record_method === 'reps_weight') {
    const reps = record.reps ?? 0;
    const w = record.weight_kg;
    return w && w > 0 ? `${reps} 回 / ${w} kg` : `${reps} 回`;
  }
  const distance = record.distance_km ?? 0;
  const duration = record.duration_seconds ? ` / ${formatDuration(record.duration_seconds)}` : '';
  return `${distance} km${duration}`;
};

const estimateRecordScore = (record: MuscleRecord) => {
  if (record.record_method === 'duration') return (record.duration_seconds ?? 0) / 30;
  if (record.record_method === 'reps_weight') return (record.reps ?? 0) * Math.max(1, (record.weight_kg ?? 0) / 10 || 1);
  return (record.distance_km ?? 0) * 25 + (record.duration_seconds ?? 0) / 60;
};

function HeatCell({ label, score, maxScore }: { label: string; score: number; maxScore: number }) {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const bg = ratio === 0 ? 'rgba(229,231,235,0.65)' : `rgba(239,68,68,${0.18 + ratio * 0.72})`;
  const color = ratio > 0.45 ? '#fff' : '#374151';
  return (
    <div className="rounded-lg border border-white/60 p-3 shadow-sm" style={{ backgroundColor: bg, color }}>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 text-lg font-semibold">{score.toFixed(score >= 10 ? 0 : 1)}</div>
    </div>
  );
}

function BodyHeatmap({ records }: { records: MuscleRecord[] }) {
  const { scores, maxScore, undertrained } = useMemo(() => {
    const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const map = new Map<string, number>();
    for (const part of BODY_PARTS_META) map.set(part.key, 0);
    for (const record of records) {
      const time = new Date(record.performed_at).getTime();
      if (!Number.isFinite(time) || time < since) continue;
      const score = estimateRecordScore(record);
      for (const p of record.body_parts) {
        map.set(p, (map.get(p) ?? 0) + score);
      }
    }
    const values = Array.from(map.values());
    const max = values.length > 0 ? Math.max(...values) : 0;
    const under = BODY_PARTS_META
      .map((p) => ({ label: p.label, value: map.get(p.key) ?? 0 }))
      .sort((a, b) => a.value - b.value)
      .slice(0, 4);
    return { scores: map, maxScore: max, undertrained: under };
  }, [records]);

  const front = BODY_PARTS_META.filter((b) => b.side === 'front');
  const back = BODY_PARTS_META.filter((b) => b.side === 'back');

  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-800">身体ヒートマップ（直近14日）</h3>
          <p className="text-xs text-gray-500">記録量ベースの簡易スコア。初版の目安表示です。</p>
        </div>
        <div className="text-xs text-gray-500">最近弱い部位: {undertrained.map((u) => u.label).join(' / ')}</div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Front</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {front.map((part) => (
              <HeatCell key={part.key} label={part.label} score={scores.get(part.key) ?? 0} maxScore={maxScore} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Back</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {back.map((part) => (
              <HeatCell key={part.key} label={part.label} score={scores.get(part.key) ?? 0} maxScore={maxScore} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MusclePage() {
  const [mode, setMode] = useState<Mode>('workout');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exercises, setExercises] = useState<MuscleExercise[]>([]);
  const [records, setRecords] = useState<MuscleRecord[]>([]);
  const [audios, setAudios] = useState<MuscleAudioItem[]>([]);

  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [workoutMemo, setWorkoutMemo] = useState('');
  const [workoutReps, setWorkoutReps] = useState('');
  const [workoutWeight, setWorkoutWeight] = useState('');
  const [workoutRunDistance, setWorkoutRunDistance] = useState('');
  const [workoutRunMinutes, setWorkoutRunMinutes] = useState('');
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);

  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStartedAtMs, setTimerStartedAtMs] = useState<number | null>(null);
  const [timerElapsedMs, setTimerElapsedMs] = useState(0);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const [exerciseDraft, setExerciseDraft] = useState<ExerciseDraft>(defaultExerciseDraft());
  const [isSavingExercise, setIsSavingExercise] = useState(false);

  const [audioUploadFile, setAudioUploadFile] = useState<File | null>(null);
  const [audioUploadName, setAudioUploadName] = useState('');
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);

  const [recordDraft, setRecordDraft] = useState<RecordDraft>(defaultRecordDraft());
  const [isSavingRecordDraft, setIsSavingRecordDraft] = useState(false);

  const activeExercises = useMemo(() => exercises.filter((e) => e.is_active), [exercises]);
  const selectedExercise = useMemo(
    () => exercises.find((e) => e.id === selectedExerciseId) ?? activeExercises[0] ?? null,
    [exercises, activeExercises, selectedExerciseId]
  );

  useEffect(() => {
    if (selectedExercise && selectedExercise.id !== selectedExerciseId) {
      setSelectedExerciseId(selectedExercise.id);
    }
  }, [selectedExercise, selectedExerciseId]);

  useEffect(() => {
    if (recordDraft.exercise_id) return;
    if (activeExercises[0]) {
      setRecordDraft((prev) => ({ ...prev, exercise_id: activeExercises[0]!.id }));
    }
  }, [activeExercises, recordDraft.exercise_id]);

  const loadAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [exRes, recRes, audioRes] = await Promise.all([
        fetch(`${API_BASE_URL}/muscle/exercises?include_inactive=true`),
        fetch(`${API_BASE_URL}/muscle/records?limit=500`),
        fetch(`${API_BASE_URL}/muscle/audios`),
      ]);
      if (!exRes.ok || !recRes.ok || !audioRes.ok) {
        throw new Error('Muscleデータの取得に失敗しました。');
      }
      const [exData, recData, audioData] = await Promise.all([
        exRes.json() as Promise<MuscleExercise[]>,
        recRes.json() as Promise<MuscleRecord[]>,
        audioRes.json() as Promise<MuscleAudioItem[]>,
      ]);
      setExercises(exData);
      setRecords(recData);
      setAudios(audioData);
      if (!selectedExerciseId && exData.find((x) => x.is_active)) {
        setSelectedExerciseId(exData.find((x) => x.is_active)?.id ?? '');
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Muscleデータの取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      if (timerStartedAtMs) {
        setTimerElapsedMs(Date.now() - timerStartedAtMs);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [timerRunning, timerStartedAtMs]);

  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
    };
  }, []);

  const resetWorkoutInputs = () => {
    setWorkoutMemo('');
    setWorkoutReps('');
    setWorkoutWeight('');
    setWorkoutRunDistance('');
    setWorkoutRunMinutes('');
  };

  const postWorkoutRecord = async (payload: {
    exercise_id: string;
    duration_seconds?: number;
    reps?: number;
    weight_kg?: number;
    distance_km?: number;
    memo?: string;
  }) => {
    const response = await fetch(`${API_BASE_URL}/muscle/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || '記録の保存に失敗しました。');
    }
    const created = (await response.json()) as MuscleRecord;
    setRecords((prev) => [created, ...prev]);
    return created;
  };

  const stopAndSaveDuration = async () => {
    if (!selectedExercise || selectedExercise.record_method !== 'duration' || timerStartedAtMs === null) return;
    const elapsedSec = Math.max(1, Math.round((Date.now() - timerStartedAtMs) / 1000));
    setTimerRunning(false);
    setTimerStartedAtMs(null);
    setTimerElapsedMs(0);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current = null;
    }

    setIsSavingWorkout(true);
    setError(null);
    try {
      await postWorkoutRecord({
        exercise_id: selectedExercise.id,
        duration_seconds: elapsedSec,
        memo: workoutMemo.trim(),
      });
      resetWorkoutInputs();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : '秒数記録の保存に失敗しました。');
    } finally {
      setIsSavingWorkout(false);
    }
  };

  const startDuration = async () => {
    if (!selectedExercise || selectedExercise.record_method !== 'duration') return;
    setError(null);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    if (selectedExercise.audio_id) {
      const player = new Audio(`${API_BASE_URL}/muscle/audios/${encodeURIComponent(selectedExercise.audio_id)}/file`);
      player.preload = 'auto';
      audioPlayerRef.current = player;
      try {
        await player.play();
      } catch (e) {
        console.warn('Audio playback failed, continuing timer.', e);
      }
    }
    setTimerStartedAtMs(Date.now());
    setTimerElapsedMs(0);
    setTimerRunning(true);
  };

  const saveCurrentWorkoutManually = async () => {
    if (!selectedExercise) return;
    setIsSavingWorkout(true);
    setError(null);
    try {
      if (selectedExercise.record_method === 'reps_weight') {
        const reps = Number(workoutReps);
        const weight = workoutWeight.trim() ? Number(workoutWeight) : undefined;
        if (!Number.isFinite(reps) || reps < 0) throw new Error('回数を入力してください。');
        const payload: {
          exercise_id: string;
          reps: number;
          weight_kg?: number;
          memo?: string;
        } = {
          exercise_id: selectedExercise.id,
          reps,
          memo: workoutMemo.trim(),
        };
        if (weight !== undefined) payload.weight_kg = weight;
        await postWorkoutRecord(payload);
      } else if (selectedExercise.record_method === 'running_manual') {
        const distance = Number(workoutRunDistance);
        const minutes = workoutRunMinutes.trim() ? Number(workoutRunMinutes) : undefined;
        if (!Number.isFinite(distance) || distance <= 0) throw new Error('距離(km)を入力してください。');
        const payload: {
          exercise_id: string;
          distance_km: number;
          duration_seconds?: number;
          memo?: string;
        } = {
          exercise_id: selectedExercise.id,
          distance_km: distance,
          memo: workoutMemo.trim(),
        };
        if (minutes !== undefined && Number.isFinite(minutes)) {
          payload.duration_seconds = Math.max(0, Math.round(minutes * 60));
        }
        await postWorkoutRecord(payload);
      }
      resetWorkoutInputs();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : '記録保存に失敗しました。');
    } finally {
      setIsSavingWorkout(false);
    }
  };

  const handleSaveExercise = async () => {
    if (!exerciseDraft.name.trim()) {
      alert('種目名を入力してください。');
      return;
    }
    setIsSavingExercise(true);
    try {
      const url = exerciseDraft.id
        ? `${API_BASE_URL}/muscle/exercises/${encodeURIComponent(exerciseDraft.id)}`
        : `${API_BASE_URL}/muscle/exercises`;
      const method = exerciseDraft.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: exerciseDraft.name.trim(),
          record_method: exerciseDraft.record_method,
          body_parts: exerciseDraft.body_parts,
          audio_id: exerciseDraft.record_method === 'duration' ? (exerciseDraft.audio_id || null) : null,
          is_active: exerciseDraft.is_active,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || '種目保存に失敗しました。');
      }
      const saved = (await res.json()) as MuscleExercise;
      setExercises((prev) => {
        const exists = prev.some((x) => x.id === saved.id);
        return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
      });
      if (!selectedExerciseId && saved.is_active) setSelectedExerciseId(saved.id);
      setExerciseDraft(defaultExerciseDraft());
    } catch (e) {
      alert(e instanceof Error ? e.message : '種目保存に失敗しました。');
    } finally {
      setIsSavingExercise(false);
    }
  };

  const handleDeleteExercise = async (exercise: MuscleExercise) => {
    if (!window.confirm(`種目「${exercise.name}」を削除しますか？`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/muscle/exercises/${encodeURIComponent(exercise.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました。');
      setExercises((prev) => prev.filter((x) => x.id !== exercise.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました。');
    }
  };

  const handleUploadAudio = async () => {
    if (!audioUploadFile) {
      alert('音源ファイルを選択してください。');
      return;
    }
    const name = audioUploadName.trim() || audioUploadFile.name;
    setIsUploadingAudio(true);
    try {
      const fd = new FormData();
      fd.append('file', audioUploadFile);
      fd.append('display_name', name);
      const res = await fetch(`${API_BASE_URL}/muscle/audios`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as MuscleAudioItem;
      setAudios((prev) => [created, ...prev]);
      setAudioUploadFile(null);
      setAudioUploadName('');
      const input = document.getElementById('muscle-audio-upload-input') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (e) {
      alert(e instanceof Error ? e.message : '音源アップロードに失敗しました。');
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const currentRecordMethod: MuscleRecordMethod | null = selectedExercise?.record_method ?? null;
  const timerDisplaySeconds = timerRunning && timerStartedAtMs ? Math.round((Date.now() - timerStartedAtMs) / 1000) : Math.round(timerElapsedMs / 1000);

  const recentRecords = useMemo(() => records.slice(0, 20), [records]);

  const saveRecordDraft = async () => {
    if (!recordDraft.exercise_id) {
      alert('種目を選択してください。');
      return;
    }
    const exercise = exercises.find((e) => e.id === recordDraft.exercise_id);
    if (!exercise) {
      alert('種目が見つかりません。');
      return;
    }
    const payload: Record<string, unknown> = {
      exercise_id: recordDraft.exercise_id,
      performed_at: recordDraft.performed_at_local ? new Date(recordDraft.performed_at_local).toISOString() : new Date().toISOString(),
      memo: recordDraft.memo,
    };
    if (exercise.record_method === 'duration') {
      payload.duration_seconds = Number(recordDraft.duration_seconds || '0');
    } else if (exercise.record_method === 'reps_weight') {
      payload.reps = Number(recordDraft.reps || '0');
      if (recordDraft.weight_kg.trim()) payload.weight_kg = Number(recordDraft.weight_kg);
    } else if (exercise.record_method === 'running_manual') {
      payload.distance_km = Number(recordDraft.distance_km || '0');
      if (recordDraft.duration_seconds.trim()) payload.duration_seconds = Number(recordDraft.duration_seconds);
    }

    setIsSavingRecordDraft(true);
    try {
      const url = recordDraft.id
        ? `${API_BASE_URL}/muscle/records/${encodeURIComponent(recordDraft.id)}`
        : `${API_BASE_URL}/muscle/records`;
      const method = recordDraft.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || '履歴保存に失敗しました。');
      }
      const saved = (await res.json()) as MuscleRecord;
      setRecords((prev) => {
        const exists = prev.some((r) => r.id === saved.id);
        const next = exists ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev];
        return [...next].sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime());
      });
      setRecordDraft(defaultRecordDraft(activeExercises[0]?.id ?? ''));
    } catch (e) {
      alert(e instanceof Error ? e.message : '履歴保存に失敗しました。');
    } finally {
      setIsSavingRecordDraft(false);
    }
  };

  const deleteRecord = async (record: MuscleRecord) => {
    if (!window.confirm(`記録を削除しますか？ (${record.exercise_name})`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/muscle/records/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました。');
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      if (recordDraft.id === record.id) setRecordDraft(defaultRecordDraft(activeExercises[0]?.id ?? ''));
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました。');
    }
  };

  const recordDraftExercise = exercises.find((e) => e.id === recordDraft.exercise_id) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Muscle</h2>
            <p className="text-sm text-gray-600">実行と管理を1タブ内で切り替える初版です（GPSは今回対象外）。</p>
          </div>
          <div className="inline-flex rounded-xl bg-gray-200 p-1">
            <button
              type="button"
              onClick={() => setMode('workout')}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === 'workout' ? 'bg-[#e8383d] text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              Workout Mode
            </button>
            <button
              type="button"
              onClick={() => setMode('management')}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === 'management' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              Management Mode
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow">読み込み中...</div>
      ) : (
        <>
          <BodyHeatmap records={records} />

          {mode === 'workout' ? (
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-2xl bg-white p-5 shadow">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">種目</label>
                    <select
                      value={selectedExerciseId}
                      onChange={(e) => {
                        setSelectedExerciseId(e.target.value);
                        if (timerRunning) void stopAndSaveDuration();
                      }}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {activeExercises.length === 0 ? (
                        <option value="">種目を作成してください</option>
                      ) : (
                        activeExercises.map((exercise) => (
                          <option key={exercise.id} value={exercise.id}>
                            {exercise.name} ({METHOD_LABEL[exercise.record_method]})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAll()}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    再読込
                  </button>
                </div>

                {selectedExercise ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700">{METHOD_LABEL[selectedExercise.record_method]}</span>
                        {selectedExercise.body_parts.map((part) => {
                          const label = BODY_PARTS_META.find((x) => x.key === part)?.label ?? part;
                          return <span key={part} className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">#{label}</span>;
                        })}
                      </div>
                    </div>

                    {currentRecordMethod === 'duration' && (
                      <div className="rounded-2xl border border-red-100 bg-red-50/50 p-5">
                        <p className="text-sm font-medium text-gray-700">体幹計測（秒数モード）</p>
                        <p className="mt-3 text-center text-5xl font-bold tracking-tight text-[#e8383d]">{formatDuration(timerDisplaySeconds)}</p>
                        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                          {!timerRunning ? (
                            <button
                              type="button"
                              onClick={() => void startDuration()}
                              disabled={isSavingWorkout}
                              className="flex-1 rounded-xl bg-[#e8383d] px-6 py-4 text-lg font-bold text-white shadow hover:brightness-95 disabled:opacity-60"
                            >
                              スタート
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void stopAndSaveDuration()}
                              disabled={isSavingWorkout}
                              className="flex-1 rounded-xl bg-gray-900 px-6 py-4 text-lg font-bold text-white shadow hover:bg-black disabled:opacity-60"
                            >
                              ストップ（自動保存）
                            </button>
                          )}
                        </div>
                        <div className="mt-4">
                          <label className="mb-1 block text-sm font-medium text-gray-700">メモ（任意）</label>
                          <textarea
                            value={workoutMemo}
                            onChange={(e) => setWorkoutMemo(e.target.value)}
                            rows={2}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            placeholder="フォーム感覚・姿勢メモなど"
                          />
                        </div>
                        {selectedExercise.audio_id && (
                          <p className="mt-2 text-xs text-gray-500">開始時に設定音源を再生し、停止時に終了します。</p>
                        )}
                      </div>
                    )}

                    {currentRecordMethod === 'reps_weight' && (
                      <div className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">回数</label>
                          <input type="number" min={0} value={workoutReps} onChange={(e) => setWorkoutReps(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">重量(kg) 任意</label>
                          <input type="number" min={0} step="0.1" value={workoutWeight} onChange={(e) => setWorkoutWeight(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-sm font-medium text-gray-700">メモ</label>
                          <textarea value={workoutMemo} onChange={(e) => setWorkoutMemo(e.target.value)} rows={2} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div className="sm:col-span-2 flex gap-2">
                          <button type="button" onClick={() => void saveCurrentWorkoutManually()} disabled={isSavingWorkout} className="rounded-md bg-[#e8383d] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60">
                            {isSavingWorkout ? '保存中...' : '記録を保存'}
                          </button>
                          <button type="button" onClick={resetWorkoutInputs} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                            クリア
                          </button>
                        </div>
                      </div>
                    )}

                    {currentRecordMethod === 'running_manual' && (
                      <div className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">距離(km)</label>
                          <div className="flex gap-2">
                            <input type="number" min={0} step="0.01" value={workoutRunDistance} onChange={(e) => setWorkoutRunDistance(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {[1, 3, 5, 10].map((d) => (
                              <button key={d} type="button" onClick={() => setWorkoutRunDistance(String(d))} className="rounded-full border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">
                                {d}km
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">時間(分) 任意</label>
                          <input type="number" min={0} step="0.1" value={workoutRunMinutes} onChange={(e) => setWorkoutRunMinutes(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-sm font-medium text-gray-700">メモ</label>
                          <textarea value={workoutMemo} onChange={(e) => setWorkoutMemo(e.target.value)} rows={2} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="コース、体調、ペース感など" />
                        </div>
                        <div className="sm:col-span-2 flex gap-2">
                          <button type="button" onClick={() => void saveCurrentWorkoutManually()} disabled={isSavingWorkout} className="rounded-md bg-[#e8383d] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60">
                            {isSavingWorkout ? '保存中...' : '記録を保存'}
                          </button>
                          <button type="button" onClick={resetWorkoutInputs} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                            クリア
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                    まず Management Mode で種目を追加してください。
                  </div>
                )}
              </section>

              <section className="rounded-2xl bg-white p-5 shadow">
                <h3 className="text-lg font-bold text-gray-800">最近の記録</h3>
                <p className="text-xs text-gray-500">直近20件</p>
                {recentRecords.length === 0 ? (
                  <p className="mt-4 text-sm text-gray-500">記録がありません。</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {recentRecords.map((record) => (
                      <div key={record.id} className="rounded-xl border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-800">{record.exercise_name}</p>
                            <p className="text-xs text-gray-500">{formatDateTimeJst(record.performed_at)}</p>
                          </div>
                          <span className="text-xs font-semibold text-[#e8383d]">{recordSummaryText(record)}</span>
                        </div>
                        {record.memo && <p className="mt-2 text-xs text-gray-600">{record.memo}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <section className="rounded-2xl bg-white p-5 shadow">
                  <h3 className="text-lg font-bold text-gray-800">種目管理</h3>
                  <p className="text-xs text-gray-500">記録方式・効く部位・秒数モード音源を設定</p>

                  <div className="mt-4 space-y-4 rounded-xl border border-gray-200 p-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">種目名</label>
                      <input value={exerciseDraft.name} onChange={(e) => setExerciseDraft((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">記録方法</label>
                      <select value={exerciseDraft.record_method} onChange={(e) => setExerciseDraft((p) => ({ ...p, record_method: e.target.value as MuscleRecordMethod }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white">
                        <option value="duration">秒数</option>
                        <option value="reps_weight">回数・重量</option>
                        <option value="running_manual">ランニング(手入力)</option>
                      </select>
                    </div>
                    {exerciseDraft.record_method === 'duration' && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">開始音源（任意）</label>
                        <select value={exerciseDraft.audio_id} onChange={(e) => setExerciseDraft((p) => ({ ...p, audio_id: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white">
                          <option value="">なし</option>
                          {audios.map((audio) => (
                            <option key={audio.id} value={audio.id}>{audio.display_name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">有効部位（14分割・複数可）</label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {BODY_PARTS_META.map((part) => {
                          const checked = exerciseDraft.body_parts.includes(part.key);
                          return (
                            <label key={part.key} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-xs ${checked ? 'border-red-300 bg-red-50 text-red-800' : 'border-gray-200 bg-white text-gray-700'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setExerciseDraft((prev) => ({
                                  ...prev,
                                  body_parts: checked
                                    ? prev.body_parts.filter((x) => x !== part.key)
                                    : [...prev.body_parts, part.key],
                                }))}
                                className="h-3.5 w-3.5"
                              />
                              <span>{part.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={exerciseDraft.is_active} onChange={(e) => setExerciseDraft((p) => ({ ...p, is_active: e.target.checked }))} />
                      <span>有効にする</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void handleSaveExercise()} disabled={isSavingExercise} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">
                        {exerciseDraft.id ? '更新する' : '追加する'}
                      </button>
                      <button type="button" onClick={() => setExerciseDraft(defaultExerciseDraft())} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        クリア
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {exercises.length === 0 ? (
                      <p className="text-sm text-gray-500">種目はまだありません。</p>
                    ) : (
                      exercises
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((exercise) => (
                          <div key={exercise.id} className="rounded-xl border border-gray-200 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">
                                  {exercise.name}
                                  {!exercise.is_active && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">無効</span>}
                                </p>
                                <p className="text-xs text-gray-500">{METHOD_LABEL[exercise.record_method]}</p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {exercise.body_parts.map((part) => (
                                    <span key={`${exercise.id}-${part}`} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                                      {BODY_PARTS_META.find((x) => x.key === part)?.label ?? part}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => setExerciseDraft({
                                  id: exercise.id,
                                  name: exercise.name,
                                  record_method: exercise.record_method,
                                  body_parts: [...exercise.body_parts],
                                  audio_id: exercise.audio_id ?? '',
                                  is_active: exercise.is_active,
                                })} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                  編集
                                </button>
                                <button type="button" onClick={() => void handleDeleteExercise(exercise)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                                  削除
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </section>

                <section className="rounded-2xl bg-white p-5 shadow">
                  <h3 className="text-lg font-bold text-gray-800">音源管理（秒数モード用）</h3>
                  <p className="text-xs text-gray-500">Blob に保存し、秒数モード種目へ紐付けます。</p>

                  <div className="mt-4 space-y-3 rounded-xl border border-gray-200 p-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">音源ファイル</label>
                      <input
                        id="muscle-audio-upload-input"
                        type="file"
                        accept="audio/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setAudioUploadFile(file);
                          if (file && !audioUploadName.trim()) setAudioUploadName(file.name.replace(/\.[^.]+$/, ''));
                        }}
                        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">表示名</label>
                      <input value={audioUploadName} onChange={(e) => setAudioUploadName(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <button type="button" onClick={() => void handleUploadAudio()} disabled={isUploadingAudio} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">
                      {isUploadingAudio ? 'アップロード中...' : '音源アップロード'}
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {audios.length === 0 ? (
                      <p className="text-sm text-gray-500">音源はまだありません。</p>
                    ) : (
                      audios.map((audio) => (
                        <div key={audio.id} className="rounded-xl border border-gray-200 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-gray-800">{audio.display_name}</p>
                              <p className="truncate text-xs text-gray-500">{audio.original_filename}</p>
                            </div>
                            <audio controls preload="none" src={`${API_BASE_URL}/muscle/audios/${encodeURIComponent(audio.id)}/file`} className="max-w-full" />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-2xl bg-white p-5 shadow">
                <h3 className="text-lg font-bold text-gray-800">履歴の追加・修正</h3>
                <p className="text-xs text-gray-500">記録漏れの後追い入力や修正用</p>

                <div className="mt-4 grid gap-6 lg:grid-cols-[1.05fr_1.95fr]">
                  <div className="space-y-4 rounded-xl border border-gray-200 p-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">種目</label>
                      <select
                        value={recordDraft.exercise_id}
                        onChange={(e) => setRecordDraft((p) => ({ ...p, exercise_id: e.target.value }))}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">選択してください</option>
                        {exercises.map((exercise) => (
                          <option key={exercise.id} value={exercise.id}>{exercise.name} ({METHOD_LABEL[exercise.record_method]})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">実施日時</label>
                      <input
                        type="datetime-local"
                        value={recordDraft.performed_at_local}
                        onChange={(e) => setRecordDraft((p) => ({ ...p, performed_at_local: e.target.value }))}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    {recordDraftExercise?.record_method === 'duration' && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">秒数</label>
                        <input type="number" min={0} value={recordDraft.duration_seconds} onChange={(e) => setRecordDraft((p) => ({ ...p, duration_seconds: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                    )}

                    {recordDraftExercise?.record_method === 'reps_weight' && (
                      <>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">回数</label>
                          <input type="number" min={0} value={recordDraft.reps} onChange={(e) => setRecordDraft((p) => ({ ...p, reps: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">重量(kg) 任意</label>
                          <input type="number" min={0} step="0.1" value={recordDraft.weight_kg} onChange={(e) => setRecordDraft((p) => ({ ...p, weight_kg: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                      </>
                    )}

                    {recordDraftExercise?.record_method === 'running_manual' && (
                      <>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">距離(km)</label>
                          <input type="number" min={0} step="0.01" value={recordDraft.distance_km} onChange={(e) => setRecordDraft((p) => ({ ...p, distance_km: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">時間(秒) 任意</label>
                          <input type="number" min={0} value={recordDraft.duration_seconds} onChange={(e) => setRecordDraft((p) => ({ ...p, duration_seconds: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">メモ</label>
                      <textarea value={recordDraft.memo} onChange={(e) => setRecordDraft((p) => ({ ...p, memo: e.target.value }))} rows={3} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void saveRecordDraft()} disabled={isSavingRecordDraft} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">
                        {isSavingRecordDraft ? '保存中...' : (recordDraft.id ? '履歴を更新' : '履歴を追加')}
                      </button>
                      <button type="button" onClick={() => setRecordDraft(defaultRecordDraft(activeExercises[0]?.id ?? ''))} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        クリア
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">履歴一覧（直近500件）</p>
                      <button type="button" onClick={() => void loadAll()} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                        再読込
                      </button>
                    </div>
                    <div className="max-h-[520px] overflow-y-auto space-y-2 pr-1">
                      {records.length === 0 ? (
                        <p className="text-sm text-gray-500">記録がありません。</p>
                      ) : (
                        records.map((record) => (
                          <div key={record.id} className="rounded-xl border border-gray-200 bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-800">{record.exercise_name}</p>
                                <p className="text-xs text-gray-500">{formatDateTimeJst(record.performed_at)} / {METHOD_LABEL[record.record_method]}</p>
                              </div>
                              <p className="text-xs font-semibold text-[#e8383d]">{recordSummaryText(record)}</p>
                            </div>
                            {record.memo && <p className="mt-2 text-xs text-gray-600">{record.memo}</p>}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setRecordDraft({
                                  id: record.id,
                                  exercise_id: record.exercise_id,
                                  performed_at_local: toDateTimeLocalInput(record.performed_at),
                                  duration_seconds: record.duration_seconds != null ? String(record.duration_seconds) : '',
                                  reps: record.reps != null ? String(record.reps) : '',
                                  weight_kg: record.weight_kg != null ? String(record.weight_kg) : '',
                                  distance_km: record.distance_km != null ? String(record.distance_km) : '',
                                  memo: record.memo ?? '',
                                })}
                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                編集
                              </button>
                              <button type="button" onClick={() => void deleteRecord(record)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                                削除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}

      <div className="rounded-2xl bg-white p-4 shadow">
        <p className="text-xs text-gray-500">
          初版メモ: ランニングは手入力方式、GPS/ヘルスケア連携は未実装。保存時刻は backend でUTC保存、画面表示はJSTで表示しています（{getTodayYmdJst()} 時点）。
        </p>
      </div>
    </div>
  );
}
