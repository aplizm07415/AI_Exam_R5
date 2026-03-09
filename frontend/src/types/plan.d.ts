export interface Plan {
  id: string;
  title: string;
  subjectNames: string[]; // 科目名の配列
  period: {
    from: string; // YYYY-MM-DD
    to: string;   // YYYY-MM-DD
  };
  dailyGoal: {
    weekday: number;
    holiday: number;
  };
  // 'all': 曜日関係なし, 'weekday': 平日のみ, 'holiday': 土日祝のみ
  applyDays: 'all' | 'weekday' | 'holiday';
  minimumDaily?: number;
  autoRedistribute?: boolean;
  enabled: boolean;
}
