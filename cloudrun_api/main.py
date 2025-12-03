import os
import json
import time
import random
import aiofiles
from fastapi import FastAPI, APIRouter, File, UploadFile, Form, HTTPException, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# --- 環境変数の読み込み ---
load_dotenv()

# --- Gemini API クライアントの初期化 ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY環境変数が設定されていません。")

from google import genai
from google.genai import types

# google-genaiのバージョンによってはconfigure関数がない場合があるため、try-exceptで対応
try:
    genai.configure(api_key=GEMINI_API_KEY)
    # configureが成功した場合、clientオブジェクトは不要
except AttributeError:
    # configure関数がない場合、Clientクラスを使用して初期化
    # この場合、各API呼び出し時に'client.'プレフィックスが必要になる
    client = genai.Client(api_key=GEMINI_API_KEY)
    # ただし、以降のコードではgenai.upload_file, genai.GenerativeModelなどを直接使用しているため、
    # genai.configure()が機能しない環境ではこれらの関数も存在しない可能性がある。
    # このフォールバックは、configure()のみが存在しないケースに対応する。
    # もし、upload_fileやGenerativeModelも存在しない場合は、genaiライブラリ全体のバージョンアップが必要。
    print("Warning: genai.configure not found. Falling back to genai.Client(). "
          "Functionality might be limited depending on google-genai version.")
    # このフォールバックは、現在のコードのgenai.upload_fileやgenai.GenerativeModelとは直接互換性がないため、
    # 実際にはすべてのgenai呼び出しをclient.upload_fileのように変更する必要がある。
    # 現状のコードベースではgenai.configure()が前提となっているため、ここは単にエラー回避のため。
    # 正しい対処はgenaiの最新版へのアップデート。

app = FastAPI()
router = APIRouter()

# --- CORSミドルウェアの設定 ---
origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8081",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000", # ローカルホストのバックエンドURLを明示的に追加
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ファイルパスとデータディレクトリの設定 ---
DATA_DIR = "data"
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
os.makedirs(DATA_DIR, exist_ok=True)

# --- ヘルパー関数: JSONファイルの読み書き ---

async def load_data(subject: str) -> Dict[str, Any]:
    """科目ごとの問題JSONファイルを非同期に読み込み、辞書として返す"""
    path = os.path.join(DATA_DIR, f"data_{subject}.json")
    if not os.path.exists(path):
        return {"problems": [], "summary": {}}
    try:
        async with aiofiles.open(path, 'r', encoding='utf-8') as f:
            content = await f.read()
            data = json.loads(content)
            # --- Robustness check: Convert old list format to new dict format ---
            if isinstance(data, list):
                print(f"Warning: Old data format detected for {subject}. Converting to new dictionary format.")
                return {"problems": data, "summary": {}} # Wrap the list in the new format
            return data
    except (json.JSONDecodeError, FileNotFoundError):
        print(f"Error or file not found for {path}. Returning empty structure.")
        return {"problems": [], "summary": {}}

async def save_data(subject: str, data: Dict[str, Any]):
    """科目ごとの問題JSONファイルを非同期に保存する（辞書全体を上書き）"""
    path = os.path.join(DATA_DIR, f"data_{subject}.json")
    async with aiofiles.open(path, 'w', encoding='utf-8') as f:
        await f.write(json.dumps(data, ensure_ascii=False, indent=2))

async def load_history() -> List[Dict[str, Any]]:
    """全実施記録を非同期に読み込む"""
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        async with aiofiles.open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            content = await f.read()
            return json.loads(content)
    except (json.JSONDecodeError, FileNotFoundError):
        return []

async def append_history(record: Dict[str, Any]):
    """実施記録をhistory.jsonに非同期に追記する"""
    history = await load_history()
    history.append(record)
    async with aiofiles.open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        await f.write(json.dumps(history, ensure_ascii=False, indent=2))

# --- バックグラウンドタスク用のAI分析関数 ---
async def run_gemini_analysis(subject: str):
    """AI分析を非同期に実行し、結果をファイルに保存する"""
    print(f"Starting background AI analysis for {subject}...")
    file_path = os.path.join(DATA_DIR, f"data_{subject}.json")
    if not os.path.exists(file_path):
        print(f"Error: Data file for {subject} not found.")
        return

    gemini_file = None
    try:
        # Gemini APIはファイル全体をアップロードしてコンテキストとして使う
        gemini_file = genai.upload_file(path=file_path)
        
        prompt_instructions = f"""
        # 役割
        あなたはWeb調査能力を持つ優秀な試験問題専門家です。提供されたJSONファイル内の科目 "{subject}" の問題データに対して分析を行います。

        # ツール
        Web Search (Google Search)を必ず利用し、解説を補強してください。

        # Task 1: 詳細な問題解説の生成と注釈の付与
        入力JSON内の**すべての問題**について、以下の要件を満たす**総合解説テキスト**をMarkdown形式で生成し、各問題の `ai_analysis.generated_explanation_md` に格納してください。
        - **正解の解説:** 正解の理由を深く掘り下げ、Web検索で得られた補足情報や関連知識を追記。
        - **不正解の解説:** 各選択肢について、なぜ誤りなのかを具体的に説明。
        - **中国語・文化注釈:** 問題文、選択肢、解説文に中国語または中国文化の単語が出た場合、その単語の直後に `（読み方/ピンイン：簡潔な補足説明）` を追記してください。例: 「春節（chūnjié：旧暦の正月）」

        # Task 2: 重要キーワードの抽出とリスト化
        - 全データから、**出現頻度**と**専門性**を考慮した重要キーワードTOP 50を抽出してください。
        - リストは「出題可能性が高い順」に並べ、以下の構造で `summary.top_keywords` に格納してください。
          - 構造: `[キーワード] | [出題可能性: 高/中/低] | [簡潔な説明]`

        # 出力形式
        必ず、入力されたデータ構造と全く同じキーを持つ**JSON形式**で出力し、Task 1の結果を埋め込み、Task 2の結果を `summary.top_keywords` として追加し、 `ai_analysis.is_analyzed` を `true` に設定してください。
        """
        
        model = genai.GenerativeModel(model_name='gemini-1.5-pro', tools=[genai.Tool(google_search=genai.GoogleSearch())])
        response = await model.generate_content_async(
            [prompt_instructions, gemini_file],
            generation_config=genai.GenerationConfig(response_mime_type="application/json")
        )
        
        analyzed_data = json.loads(response.text)
        
        # 既存のローカルファイルをAI分析結果で上書き
        await save_data(subject, analyzed_data)
        print(f"AI analysis complete for {subject}. Data saved.")

    except Exception as e:
        print(f"An error occurred during background Gemini API call for {subject}: {e}")
    
    finally:
        if gemini_file:
            # genaiライブラリにdelete_file_asyncがない場合を考慮
            try:
                await genai.delete_file_async(name=gemini_file.name)
            except AttributeError:
                genai.delete_file(name=gemini_file.name)
            print(f"Clean up complete for {subject}. Deleted file: {gemini_file.name}")


# --- スキーマ定義 ---
class HistoryRecord(BaseModel):
    problem_id: str; subject: str; selected_answer: str; is_correct: bool; timestamp: Optional[str] = None
class UploadResponse(BaseModel):
    message: str; total_problems: int
class AnalysisStatus(BaseModel):
    status: str

# --- エンドポイント実装 ---

@router.get("/subjects")
async def get_subjects():
    try:
        files = os.listdir(DATA_DIR)
        return [f[5:-5] for f in files if f.startswith("data_") and f.endswith(".json")]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve subjects: {str(e)}")

@router.post("/upload", response_model=UploadResponse)
async def upload_data(file: UploadFile = File(...), subject: str = Form(...)):
    try:
        contents = await file.read()
        uploaded_json = json.loads(contents)
        raw_questions = uploaded_json.get("questions", [])

        transformed_questions = []
        for q in raw_questions:
            choice_list = [f"{key}: {value}" for key, value in q.get("choices", {}).items()]
            correct_answer_key = q.get("correct_answer")
            correct_answer_text = q.get("choices", {}).get(correct_answer_key)
            correct_answer_full = f"{correct_answer_key}: {correct_answer_text}" if correct_answer_text else ""
            
            explanation_md = f"**正解:** {q.get('correct_explanation', '')}\n\n"
            for key, desc in q.get('choice_explanations', {}).items():
                explanation_md += f"- **選択肢 {key}:** {desc}\n"

            transformed_q = {
                "id": q.get("id"), "question_text": q.get("question_text"), "choices": choice_list, "answer": correct_answer_full,
                "metadata": {"subject": subject, "category": q.get("additional_info", {}).get("category", "未分類")},
                "ai_analysis": {"generated_explanation_md": explanation_md, "is_analyzed": False}
            }
            transformed_questions.append(transformed_q)

        existing_data = await load_data(subject)
        existing_problems = existing_data.get("problems", [])
        merged_problems = existing_problems + transformed_questions
        
        # 新しいデータ構造で保存
        new_data_obj = {"problems": merged_problems, "summary": existing_data.get("summary", {})}
        await save_data(subject, new_data_obj)

        return {"message": f"Data for '{subject}' merged and saved successfully.", "total_problems": len(merged_problems)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data upload failed: {str(e)}")

@router.post("/analyze/{subject}", status_code=202)
async def analyze_subject_data(subject: str, background_tasks: BackgroundTasks):
    """AI分析をバックグラウンドタスクとして開始する"""
    background_tasks.add_task(run_gemini_analysis, subject)
    return {"message": "AI analysis has started in the background."}

@router.get("/analyze/status/{subject}", response_model=AnalysisStatus)
async def get_analysis_status(subject: str):
    """AI分析の完了ステータスをチェックする"""
    data = await load_data(subject)
    summary = data.get("summary", {})
    # 'top_keywords'が'summary'内に存在するかどうかで完了を判断
    if "top_keywords" in summary and summary["top_keywords"]:
        return {"status": "complete"}
    else:
        return {"status": "in_progress"}

@router.get("/quiz/start/{subject}")
async def start_quiz(subject: str, mode: str, count: int):
    data_obj = await load_data(subject)
    all_problems = data_obj.get("problems", [])

    if not all_problems:
        raise HTTPException(status_code=404, detail="No problems found for this subject.")

    selection_pool = []
    if mode == 'high_freq':
        summary = data_obj.get('summary', {})
        top_keywords = summary.get('top_keywords', [])
        keyword_list = [kw.split(' | ')[0] for kw in top_keywords[:10] if ' | ' in kw]
        priority_problems = [p for p in all_problems if any(kw.lower() in p['question_text'].lower() for kw in keyword_list)]
        selection_pool = priority_problems + [p for p in all_problems if p not in priority_problems]
    elif mode == 'weak_area':
        history = await load_history()
        subject_history = [h for h in history if h['subject'] == subject]
        problem_stats = {}
        for h in subject_history:
            pid = h['problem_id']
            problem_stats.setdefault(pid, {'correct': 0, 'total': 0})
            problem_stats[pid]['total'] += 1
            if h['is_correct']: problem_stats[pid]['correct'] += 1
        
        def get_accuracy(p_id):
            stats = problem_stats.get(p_id)
            return (stats['correct'] / stats['total']) if stats and stats['total'] > 0 else 1.0
        
        unique_problems = {p['id']: p for p in all_problems}.values()
        selection_pool = sorted(unique_problems, key=lambda p: get_accuracy(p['id']))
    else:
        selection_pool = list(all_problems)
        random.shuffle(selection_pool)
    
    final_count = min(count, len(selection_pool))
    selected_problems = selection_pool[:final_count]

    quiz_set = [{
        "id": p["id"], "question_text": p["question_text"], "choices": p["choices"], "answer": p.get("answer"),
        "subject": p.get("metadata", {}).get("subject")
    } for p in selected_problems]

    explanations = {
        p["id"]: p.get("ai_analysis", {}).get("generated_explanation_md", "この問題の解説はAIによってまだ生成されていません。")
        for p in selected_problems
    }
    return {"quiz_set": quiz_set, "explanations": explanations}

@router.post("/history", status_code=201)
async def submit_history(record: HistoryRecord):
    if record.timestamp is None:
        record.timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    await append_history(record.dict())
    return {"message": "History recorded successfully."}

@router.get("/analytics/{subject}")
async def get_analytics(subject: str):
    history = await load_history()
    subject_data = await load_data(subject)
    subject_problems = subject_data.get("problems", [])
    
    subject_history = [h for h in history if h['subject'] == subject]
    total_runs = len(subject_history)
    correct_count = sum(h['is_correct'] for h in subject_history)
    overall_correct_rate = (correct_count / total_runs) * 100 if total_runs > 0 else 0
    
    # 未回答問題数の計算
    answered_problem_ids = {h['problem_id'] for h in subject_history}
    total_problem_count = len(subject_problems)
    unanswered_problems_count = total_problem_count - len(answered_problem_ids)

    daily_stats = {}
    for h in subject_history:
        date = h.get('timestamp', '').split('T')[0]
        if not date: continue
        daily_stats.setdefault(date, {'correct': 0, 'total': 0})
        daily_stats[date]['total'] += 1
        if h['is_correct']: daily_stats[date]['correct'] += 1
    daily_rates = {date: stats['correct'] / stats['total'] for date, stats in daily_stats.items()}
    
    category_errors = {}
    problem_map = {p['id']: p for p in subject_problems}
    for h in subject_history:
        if not h['is_correct'] and h['problem_id'] in problem_map:
            category = problem_map[h['problem_id']].get('metadata', {}).get('category', '未分類')
            category_errors[category] = category_errors.get(category, 0) + 1
            
    summary = subject_data.get('summary', {})
    top_keywords = summary.get('top_keywords', [])
    
    return {
        "overall_correct_rate": round(overall_correct_rate, 2),
        "total_runs": total_runs,
        "daily_correct_rate_trend": daily_rates,
        "frequently_missed_categories": dict(sorted(category_errors.items(), key=lambda item: item[1], reverse=True)),
        "ai_top_keywords": top_keywords,
        "total_problems_in_subject": len(subject_problems),
        "unanswered_problems_count": unanswered_problems_count,
    }

# --- FastAPI ルーターの適用 ---
app.include_router(router, prefix="/api")