interface Subject {
    name: string;
}
interface SubjectVisibilityModalProps {
    isOpen: boolean;
    onClose: () => void;
    subjects: Subject[];
    hiddenSubjects: string[];
    onHiddenSubjectsChange: (newHiddenSubjects: string[]) => void;
}
export default function SubjectVisibilityModal({ isOpen, onClose, subjects, hiddenSubjects, onHiddenSubjectsChange, }: SubjectVisibilityModalProps): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=SubjectVisibilityModal.d.ts.map