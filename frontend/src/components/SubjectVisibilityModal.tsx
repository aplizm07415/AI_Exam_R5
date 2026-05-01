import React, { useState, useEffect } from 'react';

interface Subject {
  name: string;
}

interface SubjectVisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  hiddenSubjects: string[];
  onHiddenSubjectsChange: (newHiddenSubjects: string[]) => void;
  subjectWeights: { [key: string]: 'light' | 'normal' | 'heavy' };
  onSubjectWeightsChange: (newWeights: { [key: string]: 'light' | 'normal' | 'heavy' }) => void;
  quizMode: 'random' | 'weak_area' | 'unanswered' | 'today_remaining' | 'specific_area';
}

export default function SubjectVisibilityModal({
  isOpen,
  onClose,
  subjects,
  hiddenSubjects,
  onHiddenSubjectsChange,
  subjectWeights,
  onSubjectWeightsChange,
  quizMode,
}: SubjectVisibilityModalProps) {
  const [tempHiddenSubjects, setTempHiddenSubjects] = useState<string[]>(hiddenSubjects);
  const [tempSubjectWeights, setTempSubjectWeights] = useState<{ [key: string]: 'light' | 'normal' | 'heavy' }>(subjectWeights);

  useEffect(() => {
    setTempHiddenSubjects(hiddenSubjects);
    setTempSubjectWeights(subjectWeights);
  }, [hiddenSubjects, subjectWeights, isOpen]);

  const handleCheckboxChange = (subjectName: string, isHidden: boolean) => {
    if (isHidden) {
      setTempHiddenSubjects(prev => [...prev, subjectName]);
    } else {
      setTempHiddenSubjects(prev => prev.filter(name => name !== subjectName));
    }
  };

  const handleWeightChange = (subjectName: string, weight: 'light' | 'normal' | 'heavy') => {
    setTempSubjectWeights(prev => ({ ...prev, [subjectName]: weight }));
  };

  const handleSave = () => {
    onHiddenSubjectsChange(tempHiddenSubjects);
    onSubjectWeightsChange(tempSubjectWeights);
    onClose();
  };

  const handleCancel = () => {
    setTempHiddenSubjects(hiddenSubjects); // 変更をリセット
    setTempSubjectWeights(subjectWeights); // 重みの変更もリセット
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-xl font-bold text-gray-800">表示科目の制御</h3>
          <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          <p className="text-sm text-gray-600 mb-4">
            ドロップダウンリストに表示する科目を選択してください。チェックを外した科目は非表示になります。
            {quizMode === 'random' && '「ランダム」モードでは、科目ごとの出題比率を調整できます。'}
          </p>
          <div className="space-y-3">
            {subjects.map(subject => (
              <div key={subject.name} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-100 transition-colors duration-200">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded text-primary-new focus:ring-primary-new border-gray-300"
                    checked={!tempHiddenSubjects.includes(subject.name)}
                    onChange={e => handleCheckboxChange(subject.name, !e.target.checked)}
                  />
                  <span className="ml-4 text-md font-medium text-gray-800">{subject.name}</span>
                </label>
                {quizMode === 'random' && (
                  <select
                    value={tempSubjectWeights[subject.name] || 'normal'}
                    onChange={e => handleWeightChange(subject.name, e.target.value as 'light' | 'normal' | 'heavy')}
                    disabled={tempHiddenSubjects.includes(subject.name)}
                    className="ml-4 rounded-md border-gray-300 shadow-sm focus:border-primary-new focus:ring-primary-new text-sm disabled:opacity-50"
                  >
                    <option value="light">軽め</option>
                    <option value="normal">普通</option>
                    <option value="heavy">重め</option>
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-4 p-4 border-t">
          <button onClick={handleCancel} className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300">
            キャンセル
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary-new text-white text-sm font-medium rounded-md hover:bg-blue-700">
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}
