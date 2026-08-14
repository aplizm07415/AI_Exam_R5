# 試験演習アプリ・スターターキット

このフォルダだけをコピーし、`content/exam.json` を編集すると、別の資格試験・社内試験・学校試験向けの演習アプリを作れます。元の簿記教材には依存していません。

## まず試す

Node.js 20以上で実行してください。

```bash
cd exam-app-template
npm install
npm start
```

`http://127.0.0.1:4173` を開きます。DB未設定でも動き、その場合の回答・採点・メモはブラウザのLocalStorageへ保存されます。

## 新しい試験を作る

1. `exam-app-template` フォルダを任意の名前でコピーします。
2. `content/exam.json` の `exam` を変更します。`exam.id` はDB上の試験識別子なので、公開後は変更しないでください。
3. `subjects` に科目を追加します。
4. サンプルの `questions` を削除し、実際の問題を追加します。
5. `npm test` でデータ形式と採点を確認します。
6. 必要なら `.env.example` を参考にNeonを接続します。

通常のカスタマイズで編集するのは `content/exam.json` だけです。配色も `exam.theme` の3色で変更できます。

## 問題形式

全問題に共通して、次の項目を指定します。

| 項目 | 内容 |
|---|---|
| `id` | 試験内で重複しない固定ID |
| `subject` | `subjects` に登録した科目ID |
| `topic` | 論点・章 |
| `difficulty` | 例：基礎、標準、応用 |
| `type` | 下記4形式のいずれか |
| `title` / `prompt` | 問題名と問題文 |
| `answer` | 正答。ブラウザへは配信されません |
| `points` | 配点（正の数） |
| `explanation` | 採点後に表示する解説 |

対応形式は次のとおりです。

- `single_choice`: 単一選択。`options` と、正解の選択肢IDを `answer` に指定
- `multiple_choice`: 複数選択。正解IDの配列を `answer` に指定。順序は問いません
- `numeric`: 数値入力。許容誤差を `tolerance`、単位表示を `suffix` に指定可能
- `text`: 短文入力。表記違いを正解にする場合は `aliases` に追加

例：

```json
{
  "id": "law-001",
  "subject": "law",
  "topic": "総則",
  "difficulty": "基礎",
  "type": "single_choice",
  "title": "基本原則",
  "prompt": "正しいものを選んでください。",
  "options": [
    { "id": "a", "label": "選択肢A" },
    { "id": "b", "label": "選択肢B" }
  ],
  "answer": "a",
  "points": 2,
  "explanation": "Aが正しい理由を記載します。"
}
```

## DB構成

`DATABASE_URL` があるとNeon Postgresを使います。初回アクセス時に次のテーブルを自動作成します。同じ定義を `database/001_exam_states.sql` にも保存しています。

```text
exam_states
├── app_id       試験ID（exam.id）
├── user_id      利用者ID（APP_USER_ID）
├── state        回答・結果・見直し・メモのJSON
├── version      保存のたびに加算
├── created_at
└── updated_at

主キー: (app_id, user_id)
```

この複合主キーにより、同じDBへ複数の試験と複数ユーザーを保存しても記録が混ざりません。公開サービスにする場合は、固定の `APP_USER_ID` ではなく認証済みユーザーIDをサーバー側で取得する実装へ変更してください。

## フォルダ構成

```text
exam-app-template/
├── content/exam.json       試験設定・科目・問題（主な編集箇所）
├── database/               Postgresスキーマ
├── public/                 共通画面・スタイル・ブラウザ処理
├── src/content.js          教材検証と正答の非公開化
├── src/grading.js          4形式の採点
├── src/database.js         Neon / LocalStorage切替用DB処理
├── api/[...path].js        Vercel Function入口
├── server.js               ローカルサーバーとAPI
├── test/                   テンプレートの自動テスト
└── vercel.json             Vercel設定
```

## API

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | 起動・DB設定状況 |
| GET | `/api/content` | 正答を除いた試験設定と問題 |
| POST | `/api/grade` | 1問のサーバー採点 |
| GET | `/api/progress` | 学習状態の取得 |
| PUT | `/api/progress` | 学習状態の保存 |

正答と解説は `/api/content` に含めず、採点後に該当問題のものだけ返します。

## Vercel + Neon

1. コピー後のフォルダを独立したGitリポジトリにします。
2. VercelへImportし、Framework Presetは `Other` を選びます。
3. Neonを接続して `DATABASE_URL` を設定します。
4. `APP_USER_ID` を設定します（個人利用なら `owner` で構いません）。
5. 再デプロイ後、`/api/health` の `database` が `configured` か確認します。

問題・正答を含むため、利用権限のない教材を公開リポジトリや公開デプロイへ置かないでください。
