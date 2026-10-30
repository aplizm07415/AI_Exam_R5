# Gemini CLI 連携メモ（AI_Exam_Prep_Kit_R1）

## プロジェクト概要
このプロジェクトは、試験問題生成・解説サポートを行う「AI Exam Prep Kit」です。
Next.js（フロント）＋ FastAPI（バックエンド）構成で動作しています。
Gemini API を使い、学習支援機能や自動処理を組み込んでいます。

## GitHub 連携目的
- **デグレ防止**：過去バージョンとの差分（git diff）を参照しながら修正を進めるため
- **バージョン管理**：動作確認時に「いつ・どの時点のソースか」を明示できるようにするため
- **再現性の確保**：Gemini への依頼時に、コードとの差分や修正歴を踏まえた説明ができるようにするため
- **チームや将来の自分への共有**：構造・背景・意図を一定のフォーマットで残す

GitHubリポジトリ（Private）
`git@github.com:aplizm07415/AI_Exam_Prep_Kit_R1.git`

## Gemini CLI 利用時のルール
1. **この README_GEMINI.md を必ず CLI のコンテキストに含める**
2. 必要に応じて `git diff`, `git log`, `git status` を一緒に投げる
3. 大きな変更前後で必ずコミットを切る
4. 「変更理由」はコミットメッセージに残す（Gemini が読みやすくなる）

## CLI 実行テンプレ
### 例：仕様検討・レビュー依頼
```bash
gemini chat \
  --file README_GEMINI.md \
  "ログイン処理を改善したい。デグレを避けるための観点と修正案を整理して"
