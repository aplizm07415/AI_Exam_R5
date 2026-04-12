import type {
  CustomExplanationLibraryResponse,
  SecondaryDraft,
  SecondaryExamDashboardResponse,
  SecondaryExamDetailResponse,
  SecondaryGradeResult,
  SecondaryOralVivaResponse,
  SecondaryOralVivaTurn,
} from './types';

const API_BASE_URL = '/api/secondary-exam';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function fetchSecondaryExamDashboard(): Promise<SecondaryExamDashboardResponse> {
  return requestJson<SecondaryExamDashboardResponse>('/dashboard');
}

export async function fetchCustomExplanationLibrary(subjects?: string[]): Promise<CustomExplanationLibraryResponse> {
  const params = new URLSearchParams();
  (subjects ?? []).forEach((subject) => params.append('subjects', subject));
  const suffix = params.toString();
  const response = await fetch(`/api/custom-explanations/library${suffix ? `?${suffix}` : ''}`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<CustomExplanationLibraryResponse>;
}

export async function fetchSecondaryExamDetail(yearLabel: string, caseNo: number): Promise<SecondaryExamDetailResponse> {
  return requestJson<SecondaryExamDetailResponse>(`/exams/${encodeURIComponent(yearLabel)}/${caseNo}`);
}

export async function saveSecondaryExamDraft(
  yearLabel: string,
  caseNo: number,
  payload: {
    answers: Record<string, string>;
    active_question_key?: string | null;
    session_started?: boolean;
    timer_paused?: boolean;
    timer_remaining_seconds?: number | null;
    timer_duration_minutes?: number | null;
  },
): Promise<SecondaryDraft> {
  return requestJson<SecondaryDraft>(`/drafts/${encodeURIComponent(yearLabel)}/${caseNo}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function gradeSecondaryExam(
  yearLabel: string,
  caseNo: number,
  answers: Record<string, string>,
): Promise<SecondaryGradeResult> {
  return requestJson<SecondaryGradeResult>('/grade', {
    method: 'POST',
    body: JSON.stringify({
      year_label: yearLabel,
      case_no: caseNo,
      answers,
    }),
  });
}

export async function fetchSecondaryExamResult(attemptId: string): Promise<SecondaryGradeResult> {
  return requestJson<SecondaryGradeResult>(`/results/${encodeURIComponent(attemptId)}`);
}

export async function askSecondaryExamOralViva(
  yearLabel: string,
  caseNo: number,
  payload: {
    user_message: string;
    attempt_id?: string | null;
    conversation?: SecondaryOralVivaTurn[];
  },
): Promise<SecondaryOralVivaResponse> {
  return requestJson<SecondaryOralVivaResponse>('/oral-viva', {
    method: 'POST',
    body: JSON.stringify({
      year_label: yearLabel,
      case_no: caseNo,
      user_message: payload.user_message,
      attempt_id: payload.attempt_id ?? null,
      conversation: payload.conversation ?? [],
    }),
  });
}
