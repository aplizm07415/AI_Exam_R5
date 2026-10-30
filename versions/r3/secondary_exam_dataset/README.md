# Secondary Exam Dataset

このディレクトリは、中小企業診断士二次試験向け機能のために再編したローカルデータセットです。

## 目的

- Webアプリの「二次試験特化」タブ実装に向けた正本データ置き場にする
- AI採点時に必要な材料を、無駄なく構造化して保持する
- 元データが増えたときに同じ手順で再生成できるようにする

## 構成

- `catalog/`
  - `source_inventory.json`: 元ファイル一覧とカテゴリ、PDFテキスト出力先
  - `coverage_summary.json`: 年度・事例ごとの網羅状況
  - `reference_catalog.json`: OCR JSON やプロンプト素材の参照一覧
- `source_documents/`
  - 元PDFを `pdftotext -layout` で抽出し、JSONで保持したもの
- `exam_bundles/`
  - `case1/`: R1〜R7 を正規化
    - 与件文、設問、字数制限、配点、採点観点、問題PDF参照をまとめた JSON
    - 元データの `question_no` はそのまま保存しつつ、下流実装用に `question_index` / `question_key` を付与
    - 採点観点との対応は `alignment_summary.recommended_alignment_mode` を参照
    - すべての bundle に `raw_source` / `normalized_scoring_input` / `scoring_policy` を付与
  - `case2/` `case3/` `case4/`: 過去問PDFから与件文・設問文・字数制限・配点を抽出した JSON
    - `R1〜R5` は解答チェックリスト由来の `rubrics` と 2次テキスト由来の `explanations` を付与
    - `R6〜R7` は年度横断TACテキストから事例別に `explanations` を切り出し
    - `case4/` は `calculation_breakdowns` を持ち、計算手順・式・単位を分解して保持
    - `H19〜H30` は現時点で問題文 bundle のみ
- `answer_corpora/`
  - `aas/`: AAS の再現答案を 年度×事例 で整理
  - `fuzoroi_xlsx/`: 2023〜2025 のふぞろいExcelを 年度×事例 で整理

## 再生成

```bash
/opt/homebrew/bin/python3 tools/build_secondary_exam_dataset.py
```

## アプリ実装に向けた使い方

- 問題表示: `source_pdf_blob_path` を正本にし、必要時だけ `source_pdf_path` をローカル参照に使う
- 採点: `exam_bundles/` の設問・採点観点と `answer_corpora/` の再現答案を根拠パックとして利用
- AI入力: `normalized_scoring_input.question_prompt_packets` を設問単位で渡し、必要時だけ `raw_source` を参照
- 採点方針: `scoring_policy` を使って、採点とアドバイスの方針を統一
- トークン節約: まず `exemplars` や統計を使い、必要時だけ `answers` 全件を読む
