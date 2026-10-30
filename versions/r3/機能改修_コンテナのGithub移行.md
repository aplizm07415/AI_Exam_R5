☑️
以下は、現状のコスト削減案をまとめたものです。ソースコードなど詳細をわからないAIがまとめたものなので、実際の環境を調査し、最適な手順や方針を考えてください。
今接続しているgitを活用して、コストの削減を実現したいです。
appの実行場所や、データの保管方法などは変更したくないです。
以下を参考に、手順を整理し、舵取りしてもらえないでしょうか。
必要な情報があれば、その情報の取得方法(ターミナルでのコマンドなど)を教えてもらえれば、随時実行し、情報を届けることができます。

【# 移行指示書：Azure Container Apps コスト最適化】

## 1. 目的
- **ACR廃止によるコスト削減:** 月額約800円の固定費が発生している Azure Container Registry (ACR) を廃止する。
- **無料レジストリへの移行:** GitHub Packages (ghcr.io) をイメージ保存先として利用する。
- **構成の適正化:** アプリのソースコードや Blob Storage 連携は維持したまま、デプロイ設定のみを更新する。

## 2. 解析済みの現状構成
- **リソース名:** quiz-app (Resource Group: example-resource)
- **基盤:** Azure Container Apps (Consumption Plan)
- **現行イメージ:** quizregistry7648.azurecr.io/quiz-app:vXX
- **外部連携:** - Azure Blob Storage (Connection String直書き状態)
  - コンテナ名: exam-json

## 3. 修正・移行の方向性

### STEP 1: GitHub 認証情報の準備
- GitHub の個人アクセストークン (PAT) を発行。
- Container Apps の「シークレット」機能を利用し、PAT とストレージ接続文字列を安全に格納する。

### STEP 2: イメージ運用フローの変更
- ローカルビルド時のタグ付けを `ghcr.io/aplizm07415/quiz-app:vXX` に変更。
- `docker push` 先を GitHub Container Registry に切り替える。

### STEP 3: Azure Container Apps 設定の更新
- `registries` 設定に `ghcr.io` を追加（認証には STEP 1 のシークレットを使用）。
- `env` 内のストレージ接続文字列を、直接参照から「シークレット参照」へ切り替え（セキュリティ強化）。
- `template.containers.image` を GitHub のパスへ更新。

### STEP 4: 課金停止処理
- アプリの正常起動確認後、旧レジストリ `quizregistry7648.azurecr.io` を削除。

## 4. 次のアクション（Geminiへの依頼用プロンプト）
「上記指示書と以前共有した JSON ビューの内容を元に、以下の作業を行う Azure CLI コマンドを作成してください。
1. GitHub PAT をシークレット名 `gh-pat` として登録する。
2. ストレージ接続文字列をシークレット名 `storage-string` に隠蔽する。
3. アプリのレジストリ設定を `ghcr.io` に変更し、イメージを `ghcr.io/aplizm07415/quiz-app:vXX` に更新する。」




