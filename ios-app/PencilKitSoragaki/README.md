# PencilKit空描きモード（iOS）

このフォルダは、空描き機能だけを iPad ネイティブ（PencilKit）で実行するための最小実装です。

## できること
- `POST /api/auth/login` でセッション認証
- 日付ごとのページ一覧取得
- ページの読込/保存（PNG）
- ページ追加/削除

## Web からの起動
Web 側の空描き画面に追加した「iPadアプリで開く」ボタンで、以下の形式の URL スキームで起動します。

`quizapp://soragaki?date=YYYY-MM-DD&base=https://<your-domain>`

## Xcode 側で必要な設定
1. `Info.plist` に URL Types を追加し、`quizapp` を登録
2. これらの Swift ファイルをプロジェクトへ追加
3. ルート View に `.onOpenURL { ... }` を設定（`SoragakiDeepLink` を利用）
4. 実機 iPad にインストールして動作確認

## 補足
- Apple Pencil のパームリジェクションは Web より PencilKit の方が安定します。
- 保存形式は既存バックエンド互換の `PNG` のままです。
