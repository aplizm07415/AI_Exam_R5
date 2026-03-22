import SwiftUI

struct OfflineRootView: View {
    @EnvironmentObject private var store: OfflineStudyStore
    private static let productionBaseURL = "https://quiz-app.nicebeach-9190a7f6.japaneast.azurecontainerapps.io"
    @AppStorage("offlineStudyBaseURL") private var baseURLText = productionBaseURL
    @State private var showClearAllConfirmation = false
    private let background = LinearGradient(
        colors: [
            Color(red: 0.95, green: 0.97, blue: 1.0),
            Color(red: 0.90, green: 0.95, blue: 0.98),
            Color(red: 0.98, green: 0.94, blue: 0.90),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    var body: some View {
        TabView {
            NavigationStack {
                ZStack {
                    background.ignoresSafeArea()
                    Form {
                        Section("進行状況") {
                            ProgressView(value: store.transferStatus.progress)
                                .tint(Color(red: 0.04, green: 0.57, blue: 0.73))
                            Text(store.transferStatus.message)
                                .font(.footnote)
                                .foregroundStyle(Color(red: 0.29, green: 0.35, blue: 0.44))
                        }

                        Section {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("QuizSoragaki Offline")
                                    .font(.system(size: 28, weight: .bold, design: .rounded))
                                    .foregroundStyle(Color(red: 0.11, green: 0.19, blue: 0.32))
                                Text("iPad 単体で演習を回せる管理画面です。オンライン時に更新し、オフライン時は手元のデータで続行できます。")
                                    .font(.subheadline)
                                    .foregroundStyle(Color(red: 0.29, green: 0.35, blue: 0.44))
                                HStack {
                                    statusChip(title: "ローカル", value: store.hasDownloadedData ? "準備済み" : "未取得")
                                    statusChip(title: "変更問題", value: "\(store.changedProblemCount)件")
                                    statusChip(title: "要修復", value: "\(store.invalidQuestionCount)件")
                                    statusChip(title: "利用日数", value: "\(store.installedDays)日")
                                }
                            }
                            .padding(.vertical, 6)
                        }

                        Section("接続先") {
                            TextField("Base URL", text: $baseURLText)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                                .autocorrectionDisabled()
                            Button("科目一覧を更新") {
                                Task { await store.loadAvailableSubjects(baseURLText: baseURLText) }
                            }
                            .disabled(store.isBusy)
                            Button(store.isBusy ? "処理中..." : "選択科目をダウンロード") {
                                Task { await store.downloadPackage(baseURLText: baseURLText) }
                            }
                            .disabled(store.isBusy || store.selectedSubjects.isEmpty)
                        }

                        Section("端末データ") {
                            Button("端末データを完全削除", role: .destructive) {
                                showClearAllConfirmation = true
                            }
                            .disabled(store.isBusy || !store.hasLocalChangesOrData)
                            Text("ダウンロード済みデータ、未同期一覧、監査ログ、画像キャッシュを端末から削除します。")
                                .font(.footnote)
                                .foregroundStyle(Color(red: 0.29, green: 0.35, blue: 0.44))
                        }

                        Section("操作モード") {
                            Text("この画面はオフラインでも開けます。科目一覧更新、ダウンロード、同期はネットワーク接続時に実行してください。")
                                .font(.footnote)
                                .foregroundStyle(Color(red: 0.29, green: 0.35, blue: 0.44))
                        }

                        if !store.availableSubjects.isEmpty {
                            Section("ダウンロード対象科目") {
                                Button("すべて選択") {
                                    store.selectedSubjects = Set(store.availableSubjects)
                                }
                                .disabled(store.isBusy)
                                Button("すべて解除") {
                                    store.selectedSubjects.removeAll()
                                }
                                .disabled(store.isBusy)

                                ForEach(store.availableSubjects, id: \.self) { subject in
                                    Toggle(
                                        isOn: Binding(
                                            get: { store.selectedSubjects.contains(subject) },
                                            set: { isSelected in
                                                if isSelected {
                                                    store.selectedSubjects.insert(subject)
                                                } else {
                                                    store.selectedSubjects.remove(subject)
                                                }
                                            }
                                        )
                                    ) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(subject)
                                                .foregroundStyle(Color(red: 0.11, green: 0.19, blue: 0.32))
                                        }
                                    }
                                }
                            }
                        }

                        if !store.invalidQuestions.isEmpty {
                            Section("要修復問題") {
                                NavigationLink {
                                    OfflineInvalidQuestionListView()
                                } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("JSON 修復が必要な問題があります")
                                            .font(.headline)
                                        Text("\(store.invalidQuestionCount)件 / iPad 上で JSON を直接編集して同期できます")
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        Section("状態") {
                            LabeledContent("ローカルデータ", value: store.hasDownloadedData ? "あり" : "未取得")
                            LabeledContent("科目数", value: "\(store.subjects.count)")
                            LabeledContent("変更問題", value: "\(store.changedProblemCount)")
                            LabeledContent("要修復問題", value: "\(store.invalidQuestionCount)")
                            LabeledContent("実施履歴", value: "\(store.practiceRecords.count)")
                            LabeledContent("選択科目数", value: "\(store.selectedSubjects.count)")
                            LabeledContent("インストールから", value: "\(store.installedDays)日")
                            LabeledContent("最終ダウンロード", value: formatted(store.lastDownloadedAt))
                            LabeledContent("最終同期", value: formatted(store.lastSyncedAt))
                        }
                        if let message = store.lastError {
                            Section("エラー") {
                                Text(message).foregroundStyle(.red)
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
                .navigationTitle("Offline Study")
                .confirmationDialog(
                    "端末データを完全削除しますか？",
                    isPresented: $showClearAllConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("完全削除する", role: .destructive) {
                        store.clearAllLocalData()
                    }
                    Button("キャンセル", role: .cancel) {}
                } message: {
                    Text("ローカルの問題データ、未同期履歴、監査ログ、画像キャッシュをすべて削除します。元に戻せません。")
                }
            }
            .tabItem { Label("Home", systemImage: "tray.and.arrow.down") }

            NavigationStack {
                OfflineStudyListView(baseURLText: $baseURLText)
            }
            .tabItem { Label("Study", systemImage: "book") }

            NavigationStack {
                OfflinePendingListView(baseURLText: $baseURLText)
            }
            .tabItem { Label("未同期", systemImage: "arrow.triangle.2.circlepath") }
        }
        .onAppear {
            normalizeBaseURLIfNeeded()
        }
    }

    private func statusChip(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(Color(red: 0.29, green: 0.35, blue: 0.44))
            Text(value)
                .font(.headline)
                .foregroundStyle(Color(red: 0.11, green: 0.19, blue: 0.32))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.88))
        )
    }

    private func formatted(_ date: Date?) -> String {
        guard let date else { return "なし" }
        return date.formatted(date: .numeric, time: .shortened)
    }

    private func normalizeBaseURLIfNeeded() {
        let trimmed = baseURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed.contains("127.0.0.1") || trimmed.contains("localhost") {
            baseURLText = Self.productionBaseURL
        }
    }
}

struct OfflineStudyListView: View {
    @EnvironmentObject private var store: OfflineStudyStore
    @Binding var baseURLText: String

    var body: some View {
        Group {
            if store.subjects.isEmpty {
                ContentUnavailableView(
                    "問題データがありません",
                    systemImage: "tray",
                    description: Text("Home タブで科目一覧を取得し、科目を選んでダウンロードするとここに表示されます。")
                )
            } else {
                List {
                    if !store.invalidQuestions.isEmpty {
                        Section("要修復問題") {
                            NavigationLink {
                                OfflineInvalidQuestionListView()
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("\(store.invalidQuestionCount)件の問題を修復できます")
                                        .font(.headline)
                                    Text("壊れた JSON を直接編集して、この端末から blob へ上書きできます。")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    Section("演習を開始") {
                        ForEach(store.subjects) { subject in
                            NavigationLink {
                                OfflineStudySetupView(subjectName: subject.name, baseURLText: $baseURLText)
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(subject.name)
                                        .font(.headline)
                                    Text("\(subject.questions.count)問 / Review Later \(subject.questions.filter { store.isReviewLater(questionID: $0.id, subject: subject.name) }.count)件")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    Section("変更状況") {
                        LabeledContent("変更問題", value: "\(store.changedProblemCount)件")
                        LabeledContent("実施履歴", value: "\(store.practiceRecords.count)件")
                    }
                }
            }
        }
        .navigationTitle("Study")
    }
}

struct OfflineStudySetupView: View {
    @EnvironmentObject private var store: OfflineStudyStore
    let subjectName: String
    @Binding var baseURLText: String
    @State private var selectedMode = "random"
    @State private var count = 10
    @State private var startPractice = false

    private let modes: [(String, String)] = [
        ("random", "ランダム"),
        ("weak_area", "苦手優先"),
        ("unanswered", "未解答"),
        ("today_remaining", "今日の残り"),
    ]

    private var totalQuestions: Int {
        store.subject(named: subjectName)?.questions.count ?? 0
    }

    var body: some View {
        Form {
            Section("演習設定") {
                LabeledContent("科目", value: subjectName)
                LabeledContent("ダウンロード済み問題数", value: "\(totalQuestions)問")
                Picker("出題モード", selection: $selectedMode) {
                    ForEach(modes, id: \.0) { mode in
                        Text(mode.1).tag(mode.0)
                    }
                }
                Stepper(value: $count, in: 1...max(totalQuestions, 1)) {
                    HStack {
                        Text("問題数")
                        Spacer()
                        Text("\(count)問")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section {
                Button("演習開始") {
                    startPractice = true
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .navigationTitle("演習設定")
        .onAppear {
            if totalQuestions > 0 {
                count = min(max(count, 1), totalQuestions)
            }
        }
        .onChange(of: totalQuestions) { _, newValue in
            if newValue > 0 {
                count = min(max(count, 1), newValue)
            }
        }
        .navigationDestination(isPresented: $startPractice) {
            OfflineSharedQuizSessionScreen(
                session: QuizSessionDescriptor(
                    subjects: [subjectName],
                    mode: selectedMode,
                    count: count,
                    problemID: nil,
                    iPadProfileRaw: "air"
                ),
                baseURLText: baseURLText
            )
        }
    }
}

struct OfflineSharedQuizSessionScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: OfflineStudyStore
    let session: QuizSessionDescriptor
    let baseURLText: String

    var body: some View {
        QuizPencilModeView(
            session: session,
            backend: OfflineQuizSessionBackend(store: store, baseURLText: baseURLText),
            onFinish: { dismiss() }
        )
    }
}

struct OfflineQuizSessionBackend: QuizSessionBackend {
    @MainActor let store: OfflineStudyStore
    let baseURLText: String

    var supportsPendingSyncQueue: Bool { false }
    var networkStatusText: String { "ローカル保存" }
    var isNetworkAvailable: Bool { true }

    @MainActor
    func loadQuestions(for session: QuizSessionDescriptor) async throws -> [QuizQuestion] {
        if session.isReviewMode, let subject = session.subjects.first, let problemID = session.problemID,
           let question = store.question(id: problemID, subject: subject) {
            return [try question.toQuizQuestion()]
        }
        let questions = try store.quizQuestions(subjectNames: session.subjects, mode: session.mode, count: session.count)
            .map { try $0.toQuizQuestion() }
        guard !questions.isEmpty else {
            throw NSError(
                domain: "OfflineQuizSessionBackend",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "この条件に一致するローカル問題がありません。"]
            )
        }
        return questions
    }

    @MainActor
    func submitHistory(problemID: String, subject: String, selectedAnswer: String, isCorrect: Bool, category: String?) async throws {
        store.submitAnswer(questionID: problemID, subject: subject, selectedAnswer: selectedAnswer, isCorrect: isCorrect, category: category)
    }

    @MainActor
    func loadHistoryStats(problemIDs: [String], subjects: [String]) async throws -> [String : QuizHistoryStat] {
        Dictionary(uniqueKeysWithValues: problemIDs.map { problemID in
            let subject = subjects.first { subjectName in
                store.question(id: problemID, subject: subjectName) != nil
            } ?? subjects.first ?? ""
            return (
                problemID,
                QuizHistoryStat(
                    total: store.historyCount(for: problemID, in: subject),
                    correct: store.correctCount(for: problemID, in: subject)
                )
            )
        })
    }

    @MainActor
    func isReviewLater(subject: String, problemID: String) async throws -> Bool {
        store.isReviewLater(questionID: problemID, subject: subject)
    }

    @MainActor
    func saveReviewLater(subject: String, problemID: String) async throws {
        store.setReviewLater(questionID: problemID, subject: subject, enabled: true)
    }

    @MainActor
    func deleteReviewLater(subject: String, problemID: String) async throws {
        store.setReviewLater(questionID: problemID, subject: subject, enabled: false)
    }

    @MainActor
    func saveCustomExplanation(problemID: String, text: String, explanationImageDataURL: String?, questionImageDataURL: String?) async throws {
        store.saveCustomMemo(
            questionID: problemID,
            text: text,
            explanationImageDataURL: explanationImageDataURL,
            questionImageDataURL: questionImageDataURL
        )
    }

    @MainActor
    func updateProblem(subject: String, problemID: String, questionText: String, choices: [QuizChoice], answer: String, explanationText: String, category: String?) async throws -> QuizQuestion {
        guard let existing = store.question(id: problemID, subject: subject) else {
            throw NSError(domain: "OfflineQuizSessionBackend", code: 404, userInfo: [NSLocalizedDescriptionKey: "問題が見つかりません。"])
        }
        var updated = existing
        updated.questionText = questionText
        updated.choices = choices.map { OfflineChoice(label: $0.label, text: $0.text) }
        updated.answer = answer
        updated.explanation = OfflineExplanation(text: explanationText, images: existing.explanation.images)
        updated.category = category?.isEmpty == true ? nil : category

        var changedFields: [String] = []
        if updated.questionText != existing.questionText { changedFields.append("問題文") }
        if updated.choices != existing.choices { changedFields.append("選択肢") }
        if updated.answer != existing.answer { changedFields.append("正答") }
        if updated.explanation != existing.explanation { changedFields.append("解説") }
        if updated.category != existing.category { changedFields.append("カテゴリ") }

        store.updateQuestion(
            updated,
            reviewLater: store.isReviewLater(questionID: problemID, subject: subject),
            changeKind: .problemEdit,
            summary: "問題編集を保存",
            changedFields: changedFields
        )
        return try updated.toQuizQuestion()
    }

    @MainActor
    func resolveURL(path: String) -> URL? {
        store.imageURL(for: path, baseURLText: baseURLText)
    }
}

struct OfflinePendingListView: View {
    @EnvironmentObject private var store: OfflineStudyStore
    @Binding var baseURLText: String
    @State private var showSyncConfirmation = false

    var body: some View {
        List {
            Section {
                Button(store.isBusy ? "同期中..." : "同期") {
                    showSyncConfirmation = true
                }
                .disabled(store.isBusy || store.pendingCount == 0)
                ProgressView(value: store.transferStatus.progress)
                Text(store.transferStatus.message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                LabeledContent("最終同期", value: formatted(store.lastSyncedAt))
            }

            Section("変更問題") {
                if store.changedProblems.isEmpty {
                    Text("問題変更はありません。")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.changedProblems) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.subject)
                                .font(.headline)
                            Text(item.problemID)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(item.changedAt.formatted(date: .numeric, time: .shortened))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            if let category = item.category, !category.isEmpty {
                                Text(category)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if !item.summaries.isEmpty {
                                Text(item.summaries.joined(separator: " / "))
                            }
                            if !item.changedFields.isEmpty {
                                Text("変更項目: \(item.changedFields.joined(separator: "、"))")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            Section("実施履歴") {
                if store.practiceRecords.isEmpty {
                    Text("実施履歴はありません。")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.practiceRecords) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.subject)
                                .font(.headline)
                            Text(item.problemID)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(item.practicedAt.formatted(date: .numeric, time: .shortened))
                            if let selected = item.selectedAnswer {
                                Text("選択: \(selected)")
                            }
                            if let isCorrect = item.isCorrect {
                                Text(isCorrect ? "結果: 正答" : "結果: 誤答")
                                    .foregroundStyle(isCorrect ? .green : .red)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("未同期一覧")
        .confirmationDialog(
            "blob へ上書き同期しますか？",
            isPresented: $showSyncConfirmation,
            titleVisibility: .visible
        ) {
            Button("上書き同期を実行", role: .destructive) {
                Task { await store.sync(baseURLText: baseURLText) }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text(syncConfirmationMessage)
        }
    }

    private var syncConfirmationMessage: String {
        "対象科目: \(store.subjects.count)件\n更新対象問題: \(store.changedProblemCount)件\n要修復問題: \(store.invalidQuestionCount)件\n実施履歴: \(store.practiceRecords.count)件\nReview Later: \(store.reviewLaterCount)件\nローカルの現在状態を正として blob を上書きします。"
    }

    private func formatted(_ date: Date?) -> String {
        guard let date else { return "なし" }
        return date.formatted(date: .numeric, time: .shortened)
    }
}

private struct OfflineInvalidQuestionListView: View {
    @EnvironmentObject private var store: OfflineStudyStore

    var body: some View {
        List {
            if store.invalidQuestions.isEmpty {
                ContentUnavailableView(
                    "要修復問題はありません",
                    systemImage: "checkmark.seal",
                    description: Text("package 取得時に壊れた問題が見つかった場合だけ、ここに表示されます。")
                )
            } else {
                Section("JSON 修復") {
                    ForEach(store.invalidQuestions) { item in
                        NavigationLink {
                            OfflineInvalidQuestionEditorView(invalidQuestion: item)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(item.subject)
                                    .font(.headline)
                                Text(item.problemID)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Text(item.reason)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("要修復問題")
    }
}

private struct OfflineInvalidQuestionEditorView: View {
    @EnvironmentObject private var store: OfflineStudyStore
    @Environment(\.dismiss) private var dismiss
    let invalidQuestion: OfflineInvalidQuestion
    @State private var rawQuestionJSON: String
    @State private var localError: String?
    @State private var saveMessage: String?

    init(invalidQuestion: OfflineInvalidQuestion) {
        self.invalidQuestion = invalidQuestion
        _rawQuestionJSON = State(initialValue: invalidQuestion.rawQuestionJSON)
    }

    var body: some View {
        Form {
            Section("対象") {
                LabeledContent("科目", value: invalidQuestion.subject)
                LabeledContent("問題ID", value: invalidQuestion.problemID)
                Text(invalidQuestion.reason)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("JSON") {
                TextEditor(text: $rawQuestionJSON)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 320)
            }

            if let localError {
                Section("エラー") {
                    Text(localError)
                        .foregroundStyle(.red)
                }
            }

            if let saveMessage {
                Section("状態") {
                    Text(saveMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("JSON修復")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") {
                    saveRepair()
                }
            }
        }
    }

    private func saveRepair() {
        do {
            try store.repairedQuestion(from: invalidQuestion, rawQuestionJSON: rawQuestionJSON)
            localError = nil
            saveMessage = "修復を保存しました。未同期一覧から blob へ上書きできます。"
            dismiss()
        } catch {
            localError = error.localizedDescription
        }
    }
}

private struct OfflineImageGallery: View {
    @EnvironmentObject private var store: OfflineStudyStore
    let paths: [String]
    let baseURLText: String

    var body: some View {
        if paths.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(paths.enumerated()), id: \.offset) { index, path in
                    if let url = store.imageURL(for: path, baseURLText: baseURLText) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: .infinity, minHeight: 140, maxHeight: 260)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            case .failure:
                                Text("画像\(index + 1)を読み込めませんでした。")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            default:
                                ProgressView()
                                    .frame(maxWidth: .infinity, minHeight: 100)
                            }
                        }
                    }
                }
            }
        }
    }
}

private extension OfflineQuestion {
    func toQuizQuestion() throws -> QuizQuestion {
        let payload: [String: Any] = [
            "id": id,
            "question_text": questionText,
            "choices": choices.map { ["label": $0.label, "text": $0.text] },
            "answer": answer,
            "subject": subject,
            "explanation": ["text": explanation.text],
            "category": category as Any,
            "image_urls": imageURLs,
            "explanation_image_urls": explanationImageURLs,
            "custom_explanation": customExplanation as Any,
            "custom_explanation_image_data_url": customExplanationImageDataURL as Any,
            "custom_question_image_data_url": customQuestionImageDataURL as Any,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 })
        return try JSONDecoder().decode(QuizQuestion.self, from: data)
    }
}

private struct OfflineProblemDraft {
    var questionText: String
    var choices: [OfflineChoice]
    var answer: String
    var explanationText: String
    var category: String

    static let empty = OfflineProblemDraft(
        questionText: "",
        choices: [],
        answer: "",
        explanationText: "",
        category: ""
    )

    init(question: OfflineQuestion) {
        questionText = question.questionText
        choices = question.choices
        answer = question.answer
        explanationText = question.explanation.text
        category = question.category ?? ""
    }

    init(questionText: String, choices: [OfflineChoice], answer: String, explanationText: String, category: String) {
        self.questionText = questionText
        self.choices = choices
        self.answer = answer
        self.explanationText = explanationText
        self.category = category
    }
}

private struct OfflineProblemEditSheet: View {
    @Binding var draft: OfflineProblemDraft
    let onSave: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("問題文") {
                TextEditor(text: $draft.questionText)
                    .frame(minHeight: 120)
            }

            Section("選択肢") {
                ForEach($draft.choices) { $choice in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(choice.label)
                            .font(.headline)
                        TextField("選択肢", text: $choice.text)
                    }
                }
            }

            Section("正答") {
                Picker("正答", selection: $draft.answer) {
                    ForEach(draft.choices) { choice in
                        Text(choice.label).tag(choice.label)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("解説") {
                TextEditor(text: $draft.explanationText)
                    .frame(minHeight: 120)
            }

            Section("カテゴリ") {
                TextField("カテゴリ", text: $draft.category)
            }
        }
        .navigationTitle("問題編集")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("閉じる") {
                    dismiss()
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") {
                    onSave()
                    dismiss()
                }
            }
        }
    }
}
