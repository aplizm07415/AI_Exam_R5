import React from 'react';
type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining' | 'specific_area' | 'worry_practice';
interface SubjectProgressProps {
    selectedSubjectNames: string[];
    quizMode: QuizMode;
}
declare const SubjectProgress: React.FC<SubjectProgressProps>;
export default SubjectProgress;
//# sourceMappingURL=SubjectProgress.d.ts.map