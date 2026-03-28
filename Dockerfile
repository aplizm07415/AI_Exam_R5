# --- Frontend Build Stage ---
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# package.jsonとlockファイルをコピーして依存関係をインストール
COPY frontend/package*.json ./
RUN npm install

# フロントエンドのソースコードをコピー
COPY frontend/ ./

# フロントエンドをビルド
RUN npm run build

# --- Backend (FastAPI) Stage ---
FROM python:3.11-slim

WORKDIR /app

# Pythonの依存関係をインストール
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# バックエンドのコードをコピー
COPY backend ./backend
# 試験問題のJSONファイルをコピー
COPY exams ./exams
# 二次試験特化用データセットをコピー
COPY secondary_exam_dataset ./secondary_exam_dataset

# ビルド済みのフロントエンドファイルをコピー
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# ポートを公開
EXPOSE 8000

# アプリケーションを起動
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
