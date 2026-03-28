import type {
  SecondaryDraft,
  SecondaryExamDashboardResponse,
  SecondaryExamDetailResponse,
  SecondaryGradeResult,
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

export async function fetchSecondaryExamDetail(yearLabel: string, caseNo: number): Promise<SecondaryExamDetailResponse> {
  return requestJson<SecondaryExamDetailResponse>(`/exams/${encodeURIComponent(yearLabel)}/${caseNo}`);
}

export async function saveSecondaryExamDraft(
  yearLabel: string,
  caseNo: number,
  payload: { answers: Record<string, string>; active_question_key?: string | null },
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
