
export interface Question {
  id: string;
  question: string;
  options: string[];
  answer: string;
  category?: string;
  explanation?: string;
}

export interface SubjectData {
  subject: string;
  questions: Question[];
}

export interface Keyword {
  keyword: string;
  importance: number;
  description: string;
}

export interface AnalysisResult {
  subject: string;
  keywords: Keyword[];
}

export interface QuizAttempt {
  questionId: string;
  isCorrect: boolean;
  timestamp: number;
  category?: string;
}
