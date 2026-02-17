import React from 'react';
type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining';
interface SubjectProgressProps {
    selectedSubjectNames: string[];
    quizMode: QuizMode;
}
declare const SubjectProgress: React.FC<SubjectProgressProps>;
export default SubjectProgress;
//# sourceMappingURL=SubjectProgress.d.ts.map