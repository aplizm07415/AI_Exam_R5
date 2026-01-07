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
}

export default function SubjectVisibilityModal({
  isOpen,
  onClose,
  subjects,
  hiddenSubjects,
  onHiddenSubjectsChange,
}: SubjectVisibilityModalProps) {
  const [tempHiddenSubjects, setTempHiddenSubjects] = useState<string[]>(hiddenSubjects);

  useEffect(() => {
    setTempHiddenSubjects(hiddenSubjects);
  }, [hiddenSubjects, isOpen]);

  const handleCheckboxChange = (subjectName: string, isHidden: boolean) => {
    if (isHidden) {
      setTempHiddenSubjects(prev => [...prev, subjectName]);
    } else {
      setTempHiddenSubjects(prev => prev.filter(name => name !== subjectName));
    }
  };

  const handleSave = () => {
    onHiddenSubjectsChange(tempHiddenSubjects);
    onClose();
  };

  const handleCancel = () => {
    setTempHiddenSubjects(hiddenSubjects); // 変更をリセット
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
          </p>
          <div className="space-y-3">
            {subjects.map(subject => (
              <label key={subject.name} className="flex items-center p-3 rounded-lg hover:bg-gray-100 transition-colors duration-200">
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded text-primary-new focus:ring-primary-new border-gray-300"
                  checked={!tempHiddenSubjects.includes(subject.name)}
                  onChange={e => handleCheckboxChange(subject.name, !e.target.checked)}
                />
                <span className="ml-4 text-md font-medium text-gray-800">{subject.name}</span>
              </label>
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
