import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTimeJst, getTodayYmdJst } from './utils/date';
const API_BASE_URL = '/api';
const BODY_PARTS_META = [
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
const METHOD_LABEL = {
    duration: '秒数',
    reps_weight: '回数・重量',
    running_manual: 'ランニング(手入力)',
};
const defaultExerciseDraft = () => ({
    name: '',
    record_method: 'duration',
    body_parts: [],
    audio_id: '',
    image_id: '',
    is_active: true,
});
const toDateTimeLocalInput = (iso) => {
    const dt = iso ? new Date(iso) : new Date();
    if (Number.isNaN(dt.getTime()))
        return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}`;
};
const defaultRecordDraft = (exerciseId = '') => ({
    exercise_id: exerciseId,
    performed_at_local: toDateTimeLocalInput(),
    duration_seconds: '',
    reps: '',
    weight_kg: '',
    distance_km: '',
    memo: '',
});
const formatDuration = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
};
const recordSummaryText = (record) => {
    if (record.record_method === 'duration')
        return `${record.duration_seconds ?? 0} 秒`;
    if (record.record_method === 'reps_weight') {
        const reps = record.reps ?? 0;
        const w = record.weight_kg;
        return w && w > 0 ? `${reps} 回 / ${w} kg` : `${reps} 回`;
    }
    const distance = record.distance_km ?? 0;
    const duration = record.duration_seconds ? ` / ${formatDuration(record.duration_seconds)}` : '';
    return `${distance} km${duration}`;
};
const estimateRecordScore = (record) => {
    if (record.record_method === 'duration')
        return (record.duration_seconds ?? 0) / 30;
    if (record.record_method === 'reps_weight')
        return (record.reps ?? 0) * Math.max(1, (record.weight_kg ?? 0) / 10 || 1);
    return (record.distance_km ?? 0) * 25 + (record.duration_seconds ?? 0) / 60;
};
const photoFileUrl = (photoId) => `${API_BASE_URL}/photos/${encodeURIComponent(photoId)}/file`;
function HeatCell({ label, score, maxScore }) {
    const ratio = maxScore > 0 ? score / maxScore : 0;
    const bg = ratio === 0 ? 'rgba(229,231,235,0.65)' : `rgba(239,68,68,${0.18 + ratio * 0.72})`;
    const color = ratio > 0.45 ? '#fff' : '#374151';
    return (_jsxs("div", { className: "rounded-lg border border-white/60 p-3 shadow-sm", style: { backgroundColor: bg, color }, children: [_jsx("div", { className: "text-xs font-medium", children: label }), _jsx("div", { className: "mt-1 text-lg font-semibold", children: score.toFixed(score >= 10 ? 0 : 1) })] }));
}
function BodyHeatmap({ records }) {
    const { scores, maxScore, undertrained } = useMemo(() => {
        const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const map = new Map();
        for (const part of BODY_PARTS_META)
            map.set(part.key, 0);
        for (const record of records) {
            const time = new Date(record.performed_at).getTime();
            if (!Number.isFinite(time) || time < since)
                continue;
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
    return (_jsxs("div", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsxs("div", { className: "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-gray-800", children: "\u8EAB\u4F53\u30D2\u30FC\u30C8\u30DE\u30C3\u30D7\uFF08\u76F4\u8FD114\u65E5\uFF09" }), _jsx("p", { className: "text-xs text-gray-500", children: "\u8A18\u9332\u91CF\u30D9\u30FC\u30B9\u306E\u7C21\u6613\u30B9\u30B3\u30A2\u3002\u521D\u7248\u306E\u76EE\u5B89\u8868\u793A\u3067\u3059\u3002" })] }), _jsxs("div", { className: "text-xs text-gray-500", children: ["\u6700\u8FD1\u5F31\u3044\u90E8\u4F4D: ", undertrained.map((u) => u.label).join(' / ')] })] }), _jsx("div", { className: "mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", children: BODY_PARTS_META.map((part) => (_jsx(HeatCell, { label: part.label, score: scores.get(part.key) ?? 0, maxScore: maxScore }, part.key))) })] }));
}
export default function MusclePage() {
    const [mode, setMode] = useState('workout');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [exercises, setExercises] = useState([]);
    const [records, setRecords] = useState([]);
    const [audios, setAudios] = useState([]);
    const [photos, setPhotos] = useState([]);
    const [selectedExerciseId, setSelectedExerciseId] = useState('');
    const [workoutMemo, setWorkoutMemo] = useState('');
    const [workoutReps, setWorkoutReps] = useState('');
    const [workoutWeight, setWorkoutWeight] = useState('');
    const [workoutRunDistance, setWorkoutRunDistance] = useState('');
    const [workoutRunMinutes, setWorkoutRunMinutes] = useState('');
    const [selectedWorkoutAudioId, setSelectedWorkoutAudioId] = useState('');
    const [isSavingWorkout, setIsSavingWorkout] = useState(false);
    const [timerRunning, setTimerRunning] = useState(false);
    const [timerStartedAtMs, setTimerStartedAtMs] = useState(null);
    const [timerElapsedMs, setTimerElapsedMs] = useState(0);
    const audioPlayerRef = useRef(null);
    const [exerciseDraft, setExerciseDraft] = useState(defaultExerciseDraft());
    const [isSavingExercise, setIsSavingExercise] = useState(false);
    const [audioUploadFile, setAudioUploadFile] = useState(null);
    const [audioUploadName, setAudioUploadName] = useState('');
    const [isUploadingAudio, setIsUploadingAudio] = useState(false);
    const [exerciseImageFile, setExerciseImageFile] = useState(null);
    const [exerciseImageName, setExerciseImageName] = useState('');
    const [isUploadingExerciseImage, setIsUploadingExerciseImage] = useState(false);
    const [recordDraft, setRecordDraft] = useState(defaultRecordDraft());
    const [isSavingRecordDraft, setIsSavingRecordDraft] = useState(false);
    const activeExercises = useMemo(() => exercises.filter((e) => e.is_active), [exercises]);
    const photosById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
    const audiosById = useMemo(() => new Map(audios.map((audio) => [audio.id, audio])), [audios]);
    const selectedExercise = useMemo(() => exercises.find((e) => e.id === selectedExerciseId) ?? activeExercises[0] ?? null, [exercises, activeExercises, selectedExerciseId]);
    useEffect(() => {
        if (selectedExercise && selectedExercise.id !== selectedExerciseId) {
            setSelectedExerciseId(selectedExercise.id);
        }
    }, [selectedExercise, selectedExerciseId]);
    useEffect(() => {
        if (!selectedExercise) {
            setSelectedWorkoutAudioId('');
            return;
        }
        if (selectedExercise.record_method === 'duration') {
            setSelectedWorkoutAudioId(selectedExercise.audio_id ?? '');
            return;
        }
        setSelectedWorkoutAudioId('');
    }, [selectedExercise]);
    useEffect(() => {
        if (recordDraft.exercise_id)
            return;
        if (activeExercises[0]) {
            setRecordDraft((prev) => ({ ...prev, exercise_id: activeExercises[0].id }));
        }
    }, [activeExercises, recordDraft.exercise_id]);
    const loadAll = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [exRes, recRes, audioRes, photoRes] = await Promise.all([
                fetch(`${API_BASE_URL}/muscle/exercises?include_inactive=true`),
                fetch(`${API_BASE_URL}/muscle/records?limit=500`),
                fetch(`${API_BASE_URL}/muscle/audios`),
                fetch(`${API_BASE_URL}/photos`),
            ]);
            if (!exRes.ok || !recRes.ok || !audioRes.ok || !photoRes.ok) {
                throw new Error('Muscleデータの取得に失敗しました。');
            }
            const [exData, recData, audioData, photoData] = await Promise.all([
                exRes.json(),
                recRes.json(),
                audioRes.json(),
                photoRes.json(),
            ]);
            setExercises(exData);
            setRecords(recData);
            setAudios(audioData);
            setPhotos(photoData);
            if (!selectedExerciseId && exData.find((x) => x.is_active)) {
                setSelectedExerciseId(exData.find((x) => x.is_active)?.id ?? '');
            }
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : 'Muscleデータの取得に失敗しました。');
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        void loadAll();
    }, []);
    useEffect(() => {
        if (!timerRunning)
            return;
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
    const stopWorkoutAudio = () => {
        if (!audioPlayerRef.current)
            return;
        audioPlayerRef.current.pause();
        audioPlayerRef.current.currentTime = 0;
        audioPlayerRef.current = null;
    };
    const playSelectedWorkoutAudio = async () => {
        if (!selectedWorkoutAudioId)
            return;
        stopWorkoutAudio();
        const player = new Audio(`${API_BASE_URL}/muscle/audios/${encodeURIComponent(selectedWorkoutAudioId)}/file`);
        player.preload = 'auto';
        audioPlayerRef.current = player;
        try {
            await player.play();
        }
        catch (e) {
            console.warn('Audio playback failed.', e);
        }
    };
    const postWorkoutRecord = async (payload) => {
        const response = await fetch(`${API_BASE_URL}/muscle/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || '記録の保存に失敗しました。');
        }
        const created = (await response.json());
        setRecords((prev) => [created, ...prev]);
        return created;
    };
    const stopAndSaveDuration = async () => {
        if (!selectedExercise || selectedExercise.record_method !== 'duration' || timerStartedAtMs === null)
            return;
        const elapsedSec = Math.max(1, Math.round((Date.now() - timerStartedAtMs) / 1000));
        setTimerRunning(false);
        setTimerStartedAtMs(null);
        setTimerElapsedMs(0);
        stopWorkoutAudio();
        setIsSavingWorkout(true);
        setError(null);
        try {
            await postWorkoutRecord({
                exercise_id: selectedExercise.id,
                duration_seconds: elapsedSec,
                memo: workoutMemo.trim(),
            });
            resetWorkoutInputs();
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : '秒数記録の保存に失敗しました。');
        }
        finally {
            setIsSavingWorkout(false);
        }
    };
    const startDuration = async () => {
        if (!selectedExercise || selectedExercise.record_method !== 'duration')
            return;
        setError(null);
        stopWorkoutAudio();
        if (selectedWorkoutAudioId) {
            try {
                await playSelectedWorkoutAudio();
            }
            catch {
                // no-op
            }
        }
        setTimerStartedAtMs(Date.now());
        setTimerElapsedMs(0);
        setTimerRunning(true);
    };
    const saveCurrentWorkoutManually = async () => {
        if (!selectedExercise)
            return;
        setIsSavingWorkout(true);
        setError(null);
        try {
            if (selectedExercise.record_method === 'reps_weight') {
                const reps = Number(workoutReps);
                const weight = workoutWeight.trim() ? Number(workoutWeight) : undefined;
                if (!Number.isFinite(reps) || reps < 0)
                    throw new Error('回数を入力してください。');
                const payload = {
                    exercise_id: selectedExercise.id,
                    reps,
                    memo: workoutMemo.trim(),
                };
                if (weight !== undefined)
                    payload.weight_kg = weight;
                await postWorkoutRecord(payload);
            }
            else if (selectedExercise.record_method === 'running_manual') {
                const distance = Number(workoutRunDistance);
                const minutes = workoutRunMinutes.trim() ? Number(workoutRunMinutes) : undefined;
                if (!Number.isFinite(distance) || distance <= 0)
                    throw new Error('距離(km)を入力してください。');
                const payload = {
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
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : '記録保存に失敗しました。');
        }
        finally {
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
                    image_id: exerciseDraft.image_id || null,
                    is_active: exerciseDraft.is_active,
                }),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || '種目保存に失敗しました。');
            }
            const saved = (await res.json());
            setExercises((prev) => {
                const exists = prev.some((x) => x.id === saved.id);
                return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
            });
            if (!selectedExerciseId && saved.is_active)
                setSelectedExerciseId(saved.id);
            setExerciseDraft(defaultExerciseDraft());
            setExerciseImageFile(null);
            setExerciseImageName('');
            const input = document.getElementById('muscle-exercise-image-upload-input');
            if (input)
                input.value = '';
        }
        catch (e) {
            alert(e instanceof Error ? e.message : '種目保存に失敗しました。');
        }
        finally {
            setIsSavingExercise(false);
        }
    };
    const handleDeleteExercise = async (exercise) => {
        if (!window.confirm(`種目「${exercise.name}」を削除しますか？`))
            return;
        try {
            const res = await fetch(`${API_BASE_URL}/muscle/exercises/${encodeURIComponent(exercise.id)}`, { method: 'DELETE' });
            if (!res.ok)
                throw new Error('削除に失敗しました。');
            setExercises((prev) => prev.filter((x) => x.id !== exercise.id));
        }
        catch (e) {
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
            if (!res.ok)
                throw new Error(await res.text());
            const created = (await res.json());
            setAudios((prev) => [created, ...prev]);
            setAudioUploadFile(null);
            setAudioUploadName('');
            const input = document.getElementById('muscle-audio-upload-input');
            if (input)
                input.value = '';
        }
        catch (e) {
            alert(e instanceof Error ? e.message : '音源アップロードに失敗しました。');
        }
        finally {
            setIsUploadingAudio(false);
        }
    };
    const handleUploadExerciseImage = async () => {
        if (!exerciseImageFile) {
            alert('画像ファイルを選択してください。');
            return;
        }
        const name = exerciseImageName.trim() || exerciseImageFile.name.replace(/\.[^.]+$/, '');
        setIsUploadingExerciseImage(true);
        try {
            const fd = new FormData();
            fd.append('files', exerciseImageFile);
            fd.append('display_name', name);
            fd.append('tags_json', JSON.stringify(['muscle-exercise']));
            const res = await fetch(`${API_BASE_URL}/photos`, { method: 'POST', body: fd });
            if (!res.ok)
                throw new Error(await res.text());
            const created = (await res.json());
            const first = created[0];
            if (!first)
                throw new Error('画像アップロード結果が不正です。');
            setPhotos((prev) => [first, ...prev]);
            setExerciseDraft((prev) => ({ ...prev, image_id: first.id }));
            setExerciseImageFile(null);
            setExerciseImageName('');
            const input = document.getElementById('muscle-exercise-image-upload-input');
            if (input)
                input.value = '';
        }
        catch (e) {
            alert(e instanceof Error ? e.message : '画像アップロードに失敗しました。');
        }
        finally {
            setIsUploadingExerciseImage(false);
        }
    };
    const currentRecordMethod = selectedExercise?.record_method ?? null;
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
        const payload = {
            exercise_id: recordDraft.exercise_id,
            performed_at: recordDraft.performed_at_local ? new Date(recordDraft.performed_at_local).toISOString() : new Date().toISOString(),
            memo: recordDraft.memo,
        };
        if (exercise.record_method === 'duration') {
            payload.duration_seconds = Number(recordDraft.duration_seconds || '0');
        }
        else if (exercise.record_method === 'reps_weight') {
            payload.reps = Number(recordDraft.reps || '0');
            if (recordDraft.weight_kg.trim())
                payload.weight_kg = Number(recordDraft.weight_kg);
        }
        else if (exercise.record_method === 'running_manual') {
            payload.distance_km = Number(recordDraft.distance_km || '0');
            if (recordDraft.duration_seconds.trim())
                payload.duration_seconds = Number(recordDraft.duration_seconds);
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
            const saved = (await res.json());
            setRecords((prev) => {
                const exists = prev.some((r) => r.id === saved.id);
                const next = exists ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev];
                return [...next].sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime());
            });
            setRecordDraft(defaultRecordDraft(activeExercises[0]?.id ?? ''));
        }
        catch (e) {
            alert(e instanceof Error ? e.message : '履歴保存に失敗しました。');
        }
        finally {
            setIsSavingRecordDraft(false);
        }
    };
    const deleteRecord = async (record) => {
        if (!window.confirm(`記録を削除しますか？ (${record.exercise_name})`))
            return;
        try {
            const res = await fetch(`${API_BASE_URL}/muscle/records/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
            if (!res.ok)
                throw new Error('削除に失敗しました。');
            setRecords((prev) => prev.filter((r) => r.id !== record.id));
            if (recordDraft.id === record.id)
                setRecordDraft(defaultRecordDraft(activeExercises[0]?.id ?? ''));
        }
        catch (e) {
            alert(e instanceof Error ? e.message : '削除に失敗しました。');
        }
    };
    const recordDraftExercise = exercises.find((e) => e.id === recordDraft.exercise_id) ?? null;
    return (_jsxs("div", { className: "mx-auto max-w-7xl space-y-6", children: [_jsxs("div", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsxs("div", { className: "flex flex-col gap-4 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Muscle" }), _jsx("p", { className: "text-sm text-gray-600", children: "\u5B9F\u884C\u3068\u7BA1\u7406\u30921\u30BF\u30D6\u5185\u3067\u5207\u308A\u66FF\u3048\u308B\u521D\u7248\u3067\u3059\uFF08GPS\u306F\u4ECA\u56DE\u5BFE\u8C61\u5916\uFF09\u3002" })] }), _jsxs("div", { className: "inline-flex rounded-xl bg-gray-200 p-1", children: [_jsx("button", { type: "button", onClick: () => setMode('workout'), className: `rounded-lg px-4 py-2 text-sm font-medium ${mode === 'workout' ? 'bg-[#e8383d] text-white' : 'text-gray-700 hover:bg-gray-100'}`, children: "Workout Mode" }), _jsx("button", { type: "button", onClick: () => setMode('management'), className: `rounded-lg px-4 py-2 text-sm font-medium ${mode === 'management' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`, children: "Management Mode" })] })] }), error && _jsx("p", { className: "mt-3 text-sm text-red-600", children: error })] }), isLoading ? (_jsx("div", { className: "rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })) : (_jsxs(_Fragment, { children: [_jsx(BodyHeatmap, { records: records }), mode === 'workout' ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-[1.2fr_0.8fr]", children: [_jsxs("section", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u7A2E\u76EE" }), _jsx("select", { value: selectedExerciseId, onChange: (e) => {
                                                            setSelectedExerciseId(e.target.value);
                                                            if (timerRunning)
                                                                void stopAndSaveDuration();
                                                        }, className: "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm", children: activeExercises.length === 0 ? (_jsx("option", { value: "", children: "\u7A2E\u76EE\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044" })) : (activeExercises.map((exercise) => (_jsxs("option", { value: exercise.id, children: [exercise.name, " (", METHOD_LABEL[exercise.record_method], ")"] }, exercise.id)))) })] }), _jsx("button", { type: "button", onClick: () => void loadAll(), className: "rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u518D\u8AAD\u8FBC" })] }), activeExercises.length > 0 && (_jsx("div", { className: "mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3", children: activeExercises.map((exercise) => {
                                            const isSelected = exercise.id === selectedExerciseId;
                                            const photo = exercise.image_id ? photosById.get(exercise.image_id) : undefined;
                                            return (_jsxs("button", { type: "button", onClick: () => {
                                                    setSelectedExerciseId(exercise.id);
                                                    if (timerRunning)
                                                        void stopAndSaveDuration();
                                                }, className: `flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${isSelected ? 'border-[#e8383d] bg-red-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`, children: [photo ? (_jsx("img", { src: photoFileUrl(photo.id), alt: exercise.name, className: "h-12 w-12 shrink-0 rounded-lg border border-gray-200 bg-white p-1 object-contain" })) : (_jsx("div", { className: "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[11px] font-semibold text-gray-400", children: "No Img" })), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-gray-800", children: exercise.name }), _jsx("p", { className: "text-xs text-gray-500", children: METHOD_LABEL[exercise.record_method] })] })] }, exercise.id));
                                        }) })), selectedExercise ? (_jsxs("div", { className: "mt-4 space-y-4", children: [_jsx("div", { className: "rounded-xl border border-gray-200 bg-gray-50 p-4", children: _jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [selectedExercise.image_id && photosById.get(selectedExercise.image_id) && (_jsx("img", { src: photoFileUrl(selectedExercise.image_id), alt: selectedExercise.name, className: "h-16 w-16 rounded-lg border border-gray-200 bg-white p-1 object-contain" })), _jsx("span", { className: "rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700", children: METHOD_LABEL[selectedExercise.record_method] }), selectedExercise.audio_id && audiosById.get(selectedExercise.audio_id) && (_jsxs("span", { className: "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800", children: ["\u97F3\u6E90: ", audiosById.get(selectedExercise.audio_id)?.display_name] })), selectedExercise.body_parts.map((part) => {
                                                            const label = BODY_PARTS_META.find((x) => x.key === part)?.label ?? part;
                                                            return _jsxs("span", { className: "rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700", children: ["#", label] }, part);
                                                        })] }) }), currentRecordMethod === 'duration' && (_jsxs("div", { className: "rounded-2xl border border-red-100 bg-red-50/50 p-5", children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: "\u4F53\u5E79\u8A08\u6E2C\uFF08\u79D2\u6570\u30E2\u30FC\u30C9\uFF09" }), _jsxs("div", { className: "mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u958B\u59CB\u6642\u306B\u518D\u751F\u3059\u308B\u97F3\u6E90\uFF08\u4EFB\u610F\uFF09" }), _jsxs("select", { value: selectedWorkoutAudioId, onChange: (e) => setSelectedWorkoutAudioId(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white", children: [_jsx("option", { value: "", children: "\u306A\u3057" }), audios.map((audio) => (_jsx("option", { value: audio.id, children: audio.display_name }, audio.id)))] })] }), _jsx("button", { type: "button", onClick: stopWorkoutAudio, className: "rounded-md border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100", children: "\u505C\u6B62" })] }), _jsx("p", { className: "mt-2 text-xs text-gray-500", children: "\u7A2E\u76EE\u306B\u65E2\u5B9A\u97F3\u6E90\u304C\u3042\u308B\u5834\u5408\u306F\u521D\u671F\u9078\u629E\u3055\u308C\u307E\u3059\u3002\u30B9\u30BF\u30FC\u30C8\u3068\u540C\u6642\u306B\u518D\u751F\u3055\u308C\u307E\u3059\u3002" })] }), _jsx("p", { className: "mt-3 text-center text-5xl font-bold tracking-tight text-[#e8383d]", children: formatDuration(timerDisplaySeconds) }), _jsx("div", { className: "mt-5 flex flex-col gap-3 sm:flex-row", children: !timerRunning ? (_jsx("button", { type: "button", onClick: () => void startDuration(), disabled: isSavingWorkout, className: "flex-1 rounded-xl bg-[#e8383d] px-6 py-4 text-lg font-bold text-white shadow hover:brightness-95 disabled:opacity-60", children: "\u30B9\u30BF\u30FC\u30C8" })) : (_jsx("button", { type: "button", onClick: () => void stopAndSaveDuration(), disabled: isSavingWorkout, className: "flex-1 rounded-xl bg-gray-900 px-6 py-4 text-lg font-bold text-white shadow hover:bg-black disabled:opacity-60", children: "\u30B9\u30C8\u30C3\u30D7\uFF08\u81EA\u52D5\u4FDD\u5B58\uFF09" })) }), _jsxs("div", { className: "mt-4", children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u30E1\u30E2\uFF08\u4EFB\u610F\uFF09" }), _jsx("textarea", { value: workoutMemo, onChange: (e) => setWorkoutMemo(e.target.value), rows: 2, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm", placeholder: "\u30D5\u30A9\u30FC\u30E0\u611F\u899A\u30FB\u59FF\u52E2\u30E1\u30E2\u306A\u3069" })] }), selectedWorkoutAudioId && (_jsx("p", { className: "mt-2 text-xs text-gray-500", children: "\u958B\u59CB\u6642\u306B\u9078\u629E\u97F3\u6E90\u3092\u518D\u751F\u3057\u3001\u505C\u6B62\u6642\u306B\u7D42\u4E86\u3057\u307E\u3059\u3002" }))] })), currentRecordMethod === 'reps_weight' && (_jsxs("div", { className: "grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-2", children: [_jsx("div", { className: "sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4", children: _jsxs("div", { className: "grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u518D\u751F\u3059\u308B\u97F3\u6E90\uFF08\u4EFB\u610F\uFF09" }), _jsxs("select", { value: selectedWorkoutAudioId, onChange: (e) => setSelectedWorkoutAudioId(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white", children: [_jsx("option", { value: "", children: "\u306A\u3057" }), audios.map((audio) => (_jsx("option", { value: audio.id, children: audio.display_name }, audio.id)))] })] }), _jsx("button", { type: "button", onClick: () => void playSelectedWorkoutAudio(), disabled: !selectedWorkoutAudioId, className: "rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60", children: "\u518D\u751F" }), _jsx("button", { type: "button", onClick: stopWorkoutAudio, className: "rounded-md border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100", children: "\u505C\u6B62" })] }) }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u56DE\u6570" }), _jsx("input", { type: "number", min: 0, value: workoutReps, onChange: (e) => setWorkoutReps(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u91CD\u91CF(kg) \u4EFB\u610F" }), _jsx("input", { type: "number", min: 0, step: "0.1", value: workoutWeight, onChange: (e) => setWorkoutWeight(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u30E1\u30E2" }), _jsx("textarea", { value: workoutMemo, onChange: (e) => setWorkoutMemo(e.target.value), rows: 2, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { className: "sm:col-span-2 flex gap-2", children: [_jsx("button", { type: "button", onClick: () => void saveCurrentWorkoutManually(), disabled: isSavingWorkout, className: "rounded-md bg-[#e8383d] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60", children: isSavingWorkout ? '保存中...' : '記録を保存' }), _jsx("button", { type: "button", onClick: resetWorkoutInputs, className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u30AF\u30EA\u30A2" })] })] })), currentRecordMethod === 'running_manual' && (_jsxs("div", { className: "grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u8DDD\u96E2(km)" }), _jsx("div", { className: "flex gap-2", children: _jsx("input", { type: "number", min: 0, step: "0.01", value: workoutRunDistance, onChange: (e) => setWorkoutRunDistance(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" }) }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: [1, 3, 5, 10].map((d) => (_jsxs("button", { type: "button", onClick: () => setWorkoutRunDistance(String(d)), className: "rounded-full border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50", children: [d, "km"] }, d))) })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u6642\u9593(\u5206) \u4EFB\u610F" }), _jsx("input", { type: "number", min: 0, step: "0.1", value: workoutRunMinutes, onChange: (e) => setWorkoutRunMinutes(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u30E1\u30E2" }), _jsx("textarea", { value: workoutMemo, onChange: (e) => setWorkoutMemo(e.target.value), rows: 2, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm", placeholder: "\u30B3\u30FC\u30B9\u3001\u4F53\u8ABF\u3001\u30DA\u30FC\u30B9\u611F\u306A\u3069" })] }), _jsxs("div", { className: "sm:col-span-2 flex gap-2", children: [_jsx("button", { type: "button", onClick: () => void saveCurrentWorkoutManually(), disabled: isSavingWorkout, className: "rounded-md bg-[#e8383d] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60", children: isSavingWorkout ? '保存中...' : '記録を保存' }), _jsx("button", { type: "button", onClick: resetWorkoutInputs, className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u30AF\u30EA\u30A2" })] })] }))] })) : (_jsx("div", { className: "mt-4 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500", children: "\u307E\u305A Management Mode \u3067\u7A2E\u76EE\u3092\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }))] }), _jsxs("section", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsx("h3", { className: "text-lg font-bold text-gray-800", children: "\u6700\u8FD1\u306E\u8A18\u9332" }), _jsx("p", { className: "text-xs text-gray-500", children: "\u76F4\u8FD120\u4EF6" }), recentRecords.length === 0 ? (_jsx("p", { className: "mt-4 text-sm text-gray-500", children: "\u8A18\u9332\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("div", { className: "mt-4 space-y-3", children: recentRecords.map((record) => (_jsxs("div", { className: "rounded-xl border border-gray-200 p-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-gray-800", children: record.exercise_name }), _jsx("p", { className: "text-xs text-gray-500", children: formatDateTimeJst(record.performed_at) })] }), _jsx("span", { className: "text-xs font-semibold text-[#e8383d]", children: recordSummaryText(record) })] }), record.memo && _jsx("p", { className: "mt-2 text-xs text-gray-600", children: record.memo })] }, record.id))) }))] })] })) : (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "grid gap-6 xl:grid-cols-2", children: [_jsxs("section", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsx("h3", { className: "text-lg font-bold text-gray-800", children: "\u7A2E\u76EE\u7BA1\u7406" }), _jsx("p", { className: "text-xs text-gray-500", children: "\u8A18\u9332\u65B9\u5F0F\u30FB\u52B9\u304F\u90E8\u4F4D\u30FB\u79D2\u6570\u30E2\u30FC\u30C9\u97F3\u6E90\u3092\u8A2D\u5B9A" }), _jsxs("div", { className: "mt-4 space-y-4 rounded-xl border border-gray-200 p-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u7A2E\u76EE\u540D" }), _jsx("input", { value: exerciseDraft.name, onChange: (e) => setExerciseDraft((p) => ({ ...p, name: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u8A18\u9332\u65B9\u6CD5" }), _jsxs("select", { value: exerciseDraft.record_method, onChange: (e) => setExerciseDraft((p) => ({ ...p, record_method: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white", children: [_jsx("option", { value: "duration", children: "\u79D2\u6570" }), _jsx("option", { value: "reps_weight", children: "\u56DE\u6570\u30FB\u91CD\u91CF" }), _jsx("option", { value: "running_manual", children: "\u30E9\u30F3\u30CB\u30F3\u30B0(\u624B\u5165\u529B)" })] })] }), exerciseDraft.record_method === 'duration' && (_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u958B\u59CB\u97F3\u6E90\uFF08\u4EFB\u610F\uFF09" }), _jsxs("select", { value: exerciseDraft.audio_id, onChange: (e) => setExerciseDraft((p) => ({ ...p, audio_id: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white", children: [_jsx("option", { value: "", children: "\u306A\u3057" }), audios.map((audio) => (_jsx("option", { value: audio.id, children: audio.display_name }, audio.id)))] })] })), _jsxs("div", { className: "space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u7A2E\u76EE\u753B\u50CF\uFF08\u4EFB\u610F\uFF09" }), _jsxs("select", { value: exerciseDraft.image_id, onChange: (e) => setExerciseDraft((p) => ({ ...p, image_id: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white", children: [_jsx("option", { value: "", children: "\u306A\u3057" }), photos.map((photo) => (_jsx("option", { value: photo.id, children: photo.display_name }, photo.id)))] })] }), exerciseDraft.image_id && photosById.get(exerciseDraft.image_id) && (_jsx("img", { src: photoFileUrl(exerciseDraft.image_id), alt: "exercise preview", className: "h-24 w-full max-w-40 rounded-lg border border-gray-200 bg-white p-2 object-contain" })), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u65B0\u3057\u3044\u753B\u50CF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9" }), _jsx("input", { id: "muscle-exercise-image-upload-input", type: "file", accept: "image/*", onChange: (e) => {
                                                                            const file = e.target.files?.[0] ?? null;
                                                                            setExerciseImageFile(file);
                                                                            if (file && !exerciseImageName.trim()) {
                                                                                setExerciseImageName(file.name.replace(/\.[^.]+$/, ''));
                                                                            }
                                                                        }, className: "block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u753B\u50CF\u8868\u793A\u540D" }), _jsx("input", { value: exerciseImageName, onChange: (e) => setExerciseImageName(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("button", { type: "button", onClick: () => void handleUploadExerciseImage(), disabled: isUploadingExerciseImage, className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60", children: isUploadingExerciseImage ? '画像アップロード中...' : '画像をアップロードして選択' })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-2 block text-sm font-medium text-gray-700", children: "\u6709\u52B9\u90E8\u4F4D\uFF0814\u5206\u5272\u30FB\u8907\u6570\u53EF\uFF09" }), _jsx("div", { className: "grid grid-cols-2 gap-2 sm:grid-cols-3", children: BODY_PARTS_META.map((part) => {
                                                                    const checked = exerciseDraft.body_parts.includes(part.key);
                                                                    return (_jsxs("label", { className: `flex cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-xs ${checked ? 'border-red-300 bg-red-50 text-red-800' : 'border-gray-200 bg-white text-gray-700'}`, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => setExerciseDraft((prev) => ({
                                                                                    ...prev,
                                                                                    body_parts: checked
                                                                                        ? prev.body_parts.filter((x) => x !== part.key)
                                                                                        : [...prev.body_parts, part.key],
                                                                                })), className: "h-3.5 w-3.5" }), _jsx("span", { children: part.label })] }, part.key));
                                                                }) })] }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-gray-700", children: [_jsx("input", { type: "checkbox", checked: exerciseDraft.is_active, onChange: (e) => setExerciseDraft((p) => ({ ...p, is_active: e.target.checked })) }), _jsx("span", { children: "\u6709\u52B9\u306B\u3059\u308B" })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => void handleSaveExercise(), disabled: isSavingExercise, className: "rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60", children: exerciseDraft.id ? '更新する' : '追加する' }), _jsx("button", { type: "button", onClick: () => {
                                                                    setExerciseDraft(defaultExerciseDraft());
                                                                    setExerciseImageFile(null);
                                                                    setExerciseImageName('');
                                                                    const input = document.getElementById('muscle-exercise-image-upload-input');
                                                                    if (input)
                                                                        input.value = '';
                                                                }, className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u30AF\u30EA\u30A2" })] })] }), _jsx("div", { className: "mt-4 space-y-2", children: exercises.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u7A2E\u76EE\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" })) : (exercises
                                                    .slice()
                                                    .sort((a, b) => a.name.localeCompare(b.name))
                                                    .map((exercise) => (_jsx("div", { className: "rounded-xl border border-gray-200 p-3", children: _jsxs("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { className: "flex items-start gap-3", children: [exercise.image_id && photosById.get(exercise.image_id) && (_jsx("img", { src: photoFileUrl(exercise.image_id), alt: exercise.name, className: "h-16 w-16 rounded-lg border border-gray-200 bg-white p-1 object-contain" })), _jsxs("div", { children: [_jsxs("p", { className: "text-sm font-semibold text-gray-800", children: [exercise.name, !exercise.is_active && _jsx("span", { className: "ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500", children: "\u7121\u52B9" })] }), _jsx("p", { className: "text-xs text-gray-500", children: METHOD_LABEL[exercise.record_method] }), exercise.audio_id && audiosById.get(exercise.audio_id) && (_jsxs("p", { className: "mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800", children: ["\u97F3\u6E90: ", audiosById.get(exercise.audio_id)?.display_name] })), _jsx("div", { className: "mt-1 flex flex-wrap gap-1", children: exercise.body_parts.map((part) => (_jsx("span", { className: "rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700", children: BODY_PARTS_META.find((x) => x.key === part)?.label ?? part }, `${exercise.id}-${part}`))) })] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setExerciseDraft({
                                                                            id: exercise.id,
                                                                            name: exercise.name,
                                                                            record_method: exercise.record_method,
                                                                            body_parts: [...exercise.body_parts],
                                                                            audio_id: exercise.audio_id ?? '',
                                                                            image_id: exercise.image_id ?? '',
                                                                            is_active: exercise.is_active,
                                                                        }), className: "rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u7DE8\u96C6" }), _jsx("button", { type: "button", onClick: () => void handleDeleteExercise(exercise), className: "rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50", children: "\u524A\u9664" })] })] }) }, exercise.id)))) })] }), _jsxs("section", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsx("h3", { className: "text-lg font-bold text-gray-800", children: "\u97F3\u6E90\u7BA1\u7406\uFF08\u79D2\u6570\u30E2\u30FC\u30C9\u7528\uFF09" }), _jsx("p", { className: "text-xs text-gray-500", children: "Blob \u306B\u4FDD\u5B58\u3057\u3001\u79D2\u6570\u30E2\u30FC\u30C9\u7A2E\u76EE\u3078\u7D10\u4ED8\u3051\u307E\u3059\u3002" }), _jsxs("div", { className: "mt-4 space-y-3 rounded-xl border border-gray-200 p-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u97F3\u6E90\u30D5\u30A1\u30A4\u30EB" }), _jsx("input", { id: "muscle-audio-upload-input", type: "file", accept: "audio/*", onChange: (e) => {
                                                                    const file = e.target.files?.[0] ?? null;
                                                                    setAudioUploadFile(file);
                                                                    if (file && !audioUploadName.trim())
                                                                        setAudioUploadName(file.name.replace(/\.[^.]+$/, ''));
                                                                }, className: "block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u8868\u793A\u540D" }), _jsx("input", { value: audioUploadName, onChange: (e) => setAudioUploadName(e.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("button", { type: "button", onClick: () => void handleUploadAudio(), disabled: isUploadingAudio, className: "rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60", children: isUploadingAudio ? 'アップロード中...' : '音源アップロード' })] }), _jsx("div", { className: "mt-4 space-y-2", children: audios.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u97F3\u6E90\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" })) : (audios.map((audio) => (_jsx("div", { className: "rounded-xl border border-gray-200 p-3", children: _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-gray-800", children: audio.display_name }), _jsx("p", { className: "truncate text-xs text-gray-500", children: audio.original_filename })] }), _jsx("audio", { controls: true, preload: "none", src: `${API_BASE_URL}/muscle/audios/${encodeURIComponent(audio.id)}/file`, className: "max-w-full" })] }) }, audio.id)))) })] })] }), _jsxs("section", { className: "rounded-2xl bg-white p-5 shadow", children: [_jsx("h3", { className: "text-lg font-bold text-gray-800", children: "\u5C65\u6B74\u306E\u8FFD\u52A0\u30FB\u4FEE\u6B63" }), _jsx("p", { className: "text-xs text-gray-500", children: "\u8A18\u9332\u6F0F\u308C\u306E\u5F8C\u8FFD\u3044\u5165\u529B\u3084\u4FEE\u6B63\u7528" }), _jsxs("div", { className: "mt-4 grid gap-6 lg:grid-cols-[1.05fr_1.95fr]", children: [_jsxs("div", { className: "space-y-4 rounded-xl border border-gray-200 p-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u7A2E\u76EE" }), _jsxs("select", { value: recordDraft.exercise_id, onChange: (e) => setRecordDraft((p) => ({ ...p, exercise_id: e.target.value })), className: "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm", children: [_jsx("option", { value: "", children: "\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044" }), exercises.map((exercise) => (_jsxs("option", { value: exercise.id, children: [exercise.name, " (", METHOD_LABEL[exercise.record_method], ")"] }, exercise.id)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u5B9F\u65BD\u65E5\u6642" }), _jsx("input", { type: "datetime-local", value: recordDraft.performed_at_local, onChange: (e) => setRecordDraft((p) => ({ ...p, performed_at_local: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), recordDraftExercise?.record_method === 'duration' && (_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u79D2\u6570" }), _jsx("input", { type: "number", min: 0, value: recordDraft.duration_seconds, onChange: (e) => setRecordDraft((p) => ({ ...p, duration_seconds: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] })), recordDraftExercise?.record_method === 'reps_weight' && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u56DE\u6570" }), _jsx("input", { type: "number", min: 0, value: recordDraft.reps, onChange: (e) => setRecordDraft((p) => ({ ...p, reps: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u91CD\u91CF(kg) \u4EFB\u610F" }), _jsx("input", { type: "number", min: 0, step: "0.1", value: recordDraft.weight_kg, onChange: (e) => setRecordDraft((p) => ({ ...p, weight_kg: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] })] })), recordDraftExercise?.record_method === 'running_manual' && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u8DDD\u96E2(km)" }), _jsx("input", { type: "number", min: 0, step: "0.01", value: recordDraft.distance_km, onChange: (e) => setRecordDraft((p) => ({ ...p, distance_km: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u6642\u9593(\u79D2) \u4EFB\u610F" }), _jsx("input", { type: "number", min: 0, value: recordDraft.duration_seconds, onChange: (e) => setRecordDraft((p) => ({ ...p, duration_seconds: e.target.value })), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] })] })), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-sm font-medium text-gray-700", children: "\u30E1\u30E2" }), _jsx("textarea", { value: recordDraft.memo, onChange: (e) => setRecordDraft((p) => ({ ...p, memo: e.target.value })), rows: 3, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => void saveRecordDraft(), disabled: isSavingRecordDraft, className: "rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60", children: isSavingRecordDraft ? '保存中...' : (recordDraft.id ? '履歴を更新' : '履歴を追加') }), _jsx("button", { type: "button", onClick: () => setRecordDraft(defaultRecordDraft(activeExercises[0]?.id ?? '')), className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50", children: "\u30AF\u30EA\u30A2" })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: "\u5C65\u6B74\u4E00\u89A7\uFF08\u76F4\u8FD1500\u4EF6\uFF09" }), _jsx("button", { type: "button", onClick: () => void loadAll(), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u518D\u8AAD\u8FBC" })] }), _jsx("div", { className: "max-h-[520px] overflow-y-auto space-y-2 pr-1", children: records.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u8A18\u9332\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (records.map((record) => (_jsxs("div", { className: "rounded-xl border border-gray-200 bg-white p-3", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-gray-800", children: record.exercise_name }), _jsxs("p", { className: "text-xs text-gray-500", children: [formatDateTimeJst(record.performed_at), " / ", METHOD_LABEL[record.record_method]] })] }), _jsx("p", { className: "text-xs font-semibold text-[#e8383d]", children: recordSummaryText(record) })] }), record.memo && _jsx("p", { className: "mt-2 text-xs text-gray-600", children: record.memo }), _jsxs("div", { className: "mt-3 flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => setRecordDraft({
                                                                                id: record.id,
                                                                                exercise_id: record.exercise_id,
                                                                                performed_at_local: toDateTimeLocalInput(record.performed_at),
                                                                                duration_seconds: record.duration_seconds != null ? String(record.duration_seconds) : '',
                                                                                reps: record.reps != null ? String(record.reps) : '',
                                                                                weight_kg: record.weight_kg != null ? String(record.weight_kg) : '',
                                                                                distance_km: record.distance_km != null ? String(record.distance_km) : '',
                                                                                memo: record.memo ?? '',
                                                                            }), className: "rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u7DE8\u96C6" }), _jsx("button", { type: "button", onClick: () => void deleteRecord(record), className: "rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50", children: "\u524A\u9664" })] })] }, record.id)))) })] })] })] })] }))] })), _jsx("div", { className: "rounded-2xl bg-white p-4 shadow", children: _jsxs("p", { className: "text-xs text-gray-500", children: ["\u521D\u7248\u30E1\u30E2: \u30E9\u30F3\u30CB\u30F3\u30B0\u306F\u624B\u5165\u529B\u65B9\u5F0F\u3001GPS/\u30D8\u30EB\u30B9\u30B1\u30A2\u9023\u643A\u306F\u672A\u5B9F\u88C5\u3002\u4FDD\u5B58\u6642\u523B\u306F backend \u3067UTC\u4FDD\u5B58\u3001\u753B\u9762\u8868\u793A\u306FJST\u3067\u8868\u793A\u3057\u3066\u3044\u307E\u3059\uFF08", getTodayYmdJst(), " \u6642\u70B9\uFF09\u3002"] }) })] }));
}
//# sourceMappingURL=MusclePage.js.map