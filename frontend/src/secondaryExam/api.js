const API_BASE_URL = '/api/secondary-exam';
async function requestJson(path, init) {
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
        return undefined;
    }
    return response.json();
}
export async function fetchSecondaryExamDashboard() {
    return requestJson('/dashboard');
}
export async function fetchSecondaryExamDetail(yearLabel, caseNo) {
    return requestJson(`/exams/${encodeURIComponent(yearLabel)}/${caseNo}`);
}
export async function saveSecondaryExamDraft(yearLabel, caseNo, payload) {
    return requestJson(`/drafts/${encodeURIComponent(yearLabel)}/${caseNo}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
}
export async function gradeSecondaryExam(yearLabel, caseNo, answers) {
    return requestJson('/grade', {
        method: 'POST',
        body: JSON.stringify({
            year_label: yearLabel,
            case_no: caseNo,
            answers,
        }),
    });
}
//# sourceMappingURL=api.js.map