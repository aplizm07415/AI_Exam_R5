interface Subject {
    name: string;
}
interface SubjectVisibilityModalProps {
    isOpen: boolean;
    onClose: () => void;
    subjects: Subject[];
    hiddenSubjects: string[];
    onHiddenSubjectsChange: (newHiddenSubjects: string[]) => void;
    subjectWeights: {
        [key: string]: 'light' | 'normal' | 'heavy';
    };
    onSubjectWeightsChange: (newWeights: {
        [key: string]: 'light' | 'normal' | 'heavy';
    }) => void;
    quizMode: 'random' | 'weak_area' | 'unanswered' | 'today_remaining' | 'specific_area';
}
export default function SubjectVisibilityModal({ isOpen, onClose, subjects, hiddenSubjects, onHiddenSubjectsChange, subjectWeights, onSubjectWeightsChange, quizMode, }: SubjectVisibilityModalProps): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=SubjectVisibilityModal.d.ts.map