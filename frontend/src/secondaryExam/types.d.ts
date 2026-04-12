export interface SecondaryExamCatalogItem {
    exam_id: string;
    year_label: string;
    case_no: number;
    title: string;
    question_count: number;
    status: 'not_started' | 'draft' | 'graded';
    has_pdf: boolean;
    draft_updated_at: string | null;
    latest_attempt_at: string | null;
    first_score: number | null;
    best_score: number | null;
    attempt_count: number;
}
export interface SecondaryQuestionPromptPacket {
    question_index: number;
    question_key: string;
    question_no: number | string;
    subquestion_no?: number | string | null;
    max_score: number | null;
    char_limit: number | null;
    prompt_text: string;
    prompt_text_clean: string;
    subquestions: Array<{
        question_key: string;
        subquestion_no: number | string | null;
        char_limit: number | null;
        max_score: number | null;
        prompt_text: string;
        prompt_text_clean: string;
    }>;
    rubric_candidates: Array<{
        title?: string | null;
        source_type?: string | null;
        checklist_items?: string[];
    }>;
    explanation_candidate?: string | null;
    calculation_breakdown?: {
        calculation_steps?: string[];
        formula_candidates?: string[];
        unit_requirements?: string[];
        scoring_checkpoints?: string[];
    } | null;
}
export interface SecondaryExamBundle {
    exam_id: string;
    year_label: string;
    case_no: number;
    source_pdf_path?: string | null;
    passage_text: string;
    rubrics?: Array<{
        question_no?: number | string;
        title?: string | null;
        question?: string | null;
        模範解答?: string | null;
        解説?: string | null;
        採点観点?: string[] | null;
    }>;
    explanations?: Array<{
        question_no?: number | string;
        positioning_text?: string | null;
        solution_text?: string | null;
        answer_example_text?: string | null;
        difficulty_text?: string | null;
    }>;
    normalized_scoring_input: {
        passage_text_clean: string;
        question_prompt_packets: SecondaryQuestionPromptPacket[];
        recommended_alignment_mode?: string | null;
        token_saving_strategy?: Record<string, unknown>;
    };
    scoring_policy?: {
        grading_principles?: string[];
        advice_principles?: string[];
        advice_focus?: string[];
    };
}
export interface SecondaryQuestionReferenceStats {
    question_key: string;
    question_no: number | string;
    char_limit: number | null;
    references: {
        aas?: {
            answer_count?: number;
            score_stats?: {
                mean?: number;
                median?: number;
                min?: number;
                max?: number;
            };
            answer_char_stats?: {
                mean?: number;
                median?: number;
                min?: number;
                max?: number;
            };
            exemplars?: Record<string, Array<{
                answer_text?: string;
                score?: number;
            }>>;
        } | null;
        fuzoroi?: {
            submission_count?: number;
            score_stats?: {
                mean?: number;
                median?: number;
                min?: number;
                max?: number;
            };
            headers?: string[];
        } | null;
    };
}
export interface SecondaryDraft {
    exam_id?: string;
    year_label?: string;
    case_no?: number;
    answers: Record<string, string>;
    active_question_key?: string | null;
    session_started?: boolean;
    timer_paused?: boolean;
    timer_remaining_seconds?: number | null;
    timer_duration_minutes?: number | null;
    updated_at?: string | null;
    latest_attempt_id?: string | null;
}
export interface SecondaryQuestionResult {
    question_key: string;
    question_no: number | string;
    subquestion_no?: number | string | null;
    max_score: number | null;
    char_limit: number | null;
    char_count: number;
    score: number;
    score_percentage: number;
    coverage_score: number;
    prompt_score: number;
    positives: string[];
    improvement_points: string[];
    advice: string;
    missing_keywords: string[];
    matched_keywords: string[];
    reference_excerpt: string[];
    used_ai: boolean;
}
export interface SecondaryGradeResult {
    attempt_id: string;
    exam_id: string;
    year_label: string;
    case_no: number;
    overall_score: number;
    overall_percentage: number;
    total_possible_score: number;
    total_questions: number;
    answered_questions: number;
    question_results: SecondaryQuestionResult[];
    overall_feedback: {
        summary: string;
        priority_actions: string[];
        used_ai: boolean;
    };
    answers: Record<string, string>;
    scored_at: string;
    cached: boolean;
    newly_graded_questions?: number;
}
export interface SecondaryAttemptHistoryItem {
    attempt_id: string;
    exam_id: string;
    year_label: string;
    case_no: number;
    overall_score: number;
    overall_percentage: number;
    total_possible_score: number;
    total_questions: number;
    answered_questions: number;
    scored_at: string;
    cached: boolean;
    answers: Record<string, string>;
    question_results: Array<{
        question_key: string;
        question_no: number | string;
        subquestion_no?: number | string | null;
        score: number;
        max_score: number | null;
        score_percentage: number;
        char_count: number;
        char_limit: number | null;
    }>;
}
export interface SecondaryOralVivaTurn {
    role: 'assistant' | 'user';
    content: string;
}
export interface SecondaryOralVivaResponse {
    exam_id: string;
    attempt_id: string;
    assistant_message: string;
    cited_question_keys: string[];
    suggested_followups: string[];
    used_ai: boolean;
}
export interface SecondaryExamDetailResponse {
    exam_id: string;
    bundle: SecondaryExamBundle;
    pdf_url: string;
    draft: SecondaryDraft | null;
    latest_result: SecondaryGradeResult | null;
    result_history: SecondaryAttemptHistoryItem[];
    question_reference_stats: SecondaryQuestionReferenceStats[];
}
export interface SecondaryExamDashboardResponse {
    summary: {
        total_exams: number;
        graded_exams: number;
        draft_exams: number;
        untouched_exams: number;
    };
    best_scores_by_case: Record<string, number>;
    recent_attempts: Array<{
        attempt_id: string;
        exam_id: string;
        year_label: string;
        case_no: number;
        overall_score: number;
        scored_at: string;
    }>;
    all_attempts: Array<{
        attempt_id: string;
        exam_id: string;
        year_label: string;
        case_no: number;
        overall_score: number;
        scored_at: string;
    }>;
    catalog: SecondaryExamCatalogItem[];
}
export interface CustomExplanationLibraryItem {
    subject: string;
    problem_id: string;
    question_text: string;
    category?: string | null;
    custom_explanation: string;
    custom_explanation_image_data_urls: string[];
    custom_question_image_data_urls: string[];
}
export interface CustomExplanationLibraryResponse {
    items: CustomExplanationLibraryItem[];
}
//# sourceMappingURL=types.d.ts.map