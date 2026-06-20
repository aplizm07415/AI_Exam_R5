interface Subject {
    name: string;
}
interface PassProbabilityPanelProps {
    subjects: Subject[];
    selectedSubjectNames: string[];
    setSelectedSubjectNames: (names: string[]) => void;
}
export default function PassProbabilityPanel({ subjects, selectedSubjectNames, setSelectedSubjectNames, }: PassProbabilityPanelProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=PassProbabilityPanel.d.ts.map