import SwiftUI
import PencilKit
import Combine
import Network

private extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r, g, b: UInt64
        switch cleaned.count {
        case 6:
            (r, g, b) = ((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
        default:
            (r, g, b) = (0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: 1
        )
    }
}

enum AppPalette {
    static let primaryNew = Color(hex: "#3d7cce")
    static let dark = Color(hex: "#051425")
    static let light = Color(hex: "#a5b7cf")
    static let white = Color(hex: "#ffffff")
    static let primary = Color(hex: "#2e5c99")
    static let secondary = Color(hex: "#2b71ab")
    static let info = Color(hex: "#cee4ae")
    static let success = Color(hex: "#2cb4ad")
    static let warning = Color(hex: "#f5e48d")
    static let caution = Color(hex: "#c96a14")
    static let danger = Color(hex: "#cf483e")
}

struct SoragakiPencilKitHostExample: View {
    @State private var deepLink: AppDeepLink?

    var body: some View {
        Group {
            switch deepLink {
            case .soragaki(let link):
                SoragakiPencilKitView()
                    .task(id: link.date) {
                        await SoragakiPencilKitViewModelBridge.shared.configure(link)
                    }
            case .quiz(let link):
                QuizPencilModeView(deepLink: link)
            case .none:
                Text("Webアプリの「iPadモード」または「iPadアプリで開く」から起動してください。")
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
        .tint(AppPalette.primaryNew)
        .onOpenURL { url in
            deepLink = AppDeepLink.parse(url)
        }
    }
}

@MainActor
final class SoragakiPencilKitViewModelBridge {
    static let shared = SoragakiPencilKitViewModelBridge()
    weak var viewModel: SoragakiPencilKitViewModel?

    func configure(_ deepLink: SoragakiDeepLink) async {
        await viewModel?.configure(with: deepLink)
    }
}

@MainActor
final class QuizPencilModeViewModel: ObservableObject {
    static let questionTimerDuration: TimeInterval = 120
    private static let installDateKey = "quiz_app_install_date"

    enum InteractionMode {
        case select
        case draw
    }

    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var completionMessage: String?
    @Published var isSessionFinished: Bool = false
    @Published var questions: [QuizQuestion] = []
    @Published var currentIndex: Int = 0
    @Published var selectedAnswer: String?
    @Published var isAnswered: Bool = false
    @Published var isCorrect: Bool = false
    @Published var isReviewMode: Bool = false
    @Published var isMarkedForReviewLater: Bool = false
    @Published var isUpdatingReviewLater: Bool = false
    @Published var modeLabel: String = ""
    @Published var countLabel: String = ""
    @Published var canvasView = PKCanvasView()
    @Published var toolPicker = PKToolPicker()
    @Published var interactionMode: InteractionMode = .draw
    @Published var extraWriteAreaHeight: CGFloat = 0
    @Published var customMemoText: String = ""
    @Published var explanationMemoCanvasView = PKCanvasView()
    @Published var questionMemoCanvasView = PKCanvasView()
    @Published var customExplanationMemoImageDataURL: String?
    @Published var customQuestionMemoImageDataURL: String?
    @Published var historyStats: [String: QuizHistoryStat] = [:]
    @Published var isProblemEditSheetPresented: Bool = false
    @Published var problemEditDraft: ProblemEditDraft?
    @Published var questionStartedAt: Date = Date()
    @Published var installedElapsedDays: Int = 0
    @Published var isSubmittingAnswer: Bool = false
    @Published var isNetworkAvailable: Bool = true
    @Published var networkStatusText: String = "ネットワーク確認中..."
    @Published var pendingSyncCount: Int = 0
    @Published var isSyncingPendingActions: Bool = false
    @Published var syncStatusMessage: String?

    private var apiClient: SoragakiAPIClient?
    private var deepLink: QuizDeepLink?
    private var originalMemoText: String = ""
    private var originalExplanationMemoImageDataURL: String?
    private var originalQuestionMemoImageDataURL: String?
    private var networkMonitor: NWPathMonitor?
    private var pendingSyncActions: [PendingSyncAction] = []
    private var isProcessingPendingActions = false

    private static let pendingSyncStorageKey = "quiz_ipad_pending_sync_actions"

    struct PendingSyncAction: Codable, Identifiable {
        let id: String
        let type: String
        let createdAt: Date
        let problemID: String?
        let subject: String?
        let selectedAnswer: String?
        let isCorrect: Bool?
        let category: String?
        let memoText: String?
        let explanationImageDataURL: String?
        let questionImageDataURL: String?
    }

    var currentQuestion: QuizQuestion? {
        guard questions.indices.contains(currentIndex) else { return nil }
        return questions[currentIndex]
    }

    var progressText: String {
        guard !questions.isEmpty else { return "0 / 0" }
        return "第\(currentIndex + 1)問 / 全\(questions.count)問"
    }

    var explanationText: String {
        guard isAnswered else { return "" }
        return currentQuestion?.explanation.text ?? ""
    }

    var isDrawMode: Bool {
        interactionMode == .draw
    }

    deinit {
        networkMonitor?.cancel()
    }

    func configure(with deepLink: QuizDeepLink) async {
        self.deepLink = deepLink
        apiClient = SoragakiAPIClient(baseURL: deepLink.baseURL)
        isReviewMode = deepLink.isReviewMode
        modeLabel = deepLink.mode
        countLabel = "\(deepLink.count)"
        updateInstalledElapsedDays()
        loadPendingSyncActions()
        setupNetworkMonitor()
        prepareMainCanvas()
        prepareMemoCanvas(explanationMemoCanvasView)
        prepareMemoCanvas(questionMemoCanvasView)
        await startQuiz()
        await processPendingSyncActionsIfNeeded()
    }

    private func updateInstalledElapsedDays() {
        let defaults = UserDefaults.standard
        let now = Date()
        let installDate: Date
        if let savedDate = defaults.object(forKey: Self.installDateKey) as? Date {
            installDate = savedDate
        } else {
            installDate = now
            defaults.set(installDate, forKey: Self.installDateKey)
        }
        let startOfInstall = Calendar.current.startOfDay(for: installDate)
        let startOfNow = Calendar.current.startOfDay(for: now)
        let elapsed = Calendar.current.dateComponents([.day], from: startOfInstall, to: startOfNow).day ?? 0
        installedElapsedDays = max(0, elapsed)
    }

    private func setupNetworkMonitor() {
        if networkMonitor != nil { return }
        let monitor = NWPathMonitor()
        let queue = DispatchQueue(label: "quiz.ipad.network.monitor")
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let available = path.status == .satisfied
                self.isNetworkAvailable = available
                self.networkStatusText = available ? "オンライン" : "オフライン（ローカル保持中）"
                if available {
                    await self.processPendingSyncActionsIfNeeded()
                }
            }
        }
        networkMonitor = monitor
        monitor.start(queue: queue)
    }

    private func loadPendingSyncActions() {
        guard
            let raw = UserDefaults.standard.data(forKey: Self.pendingSyncStorageKey),
            let decoded = try? JSONDecoder().decode([PendingSyncAction].self, from: raw)
        else {
            pendingSyncActions = []
            pendingSyncCount = 0
            return
        }
        pendingSyncActions = decoded
        pendingSyncCount = decoded.count
    }

    private func persistPendingSyncActions() {
        if let encoded = try? JSONEncoder().encode(pendingSyncActions) {
            UserDefaults.standard.set(encoded, forKey: Self.pendingSyncStorageKey)
        }
        pendingSyncCount = pendingSyncActions.count
    }

    private func enqueuePendingSyncAction(_ action: PendingSyncAction) {
        pendingSyncActions.append(action)
        persistPendingSyncActions()
        syncStatusMessage = "通信不安定のためローカル保存しました。接続回復後に自動同期します。"
    }

    private func isNetworkError(_ error: Error) -> Bool {
        if case APIError.networkUnavailable = error {
            return true
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return true
            default:
                return false
            }
        }
        return false
    }

    private func processPendingSyncActionsIfNeeded() async {
        guard isNetworkAvailable, !isProcessingPendingActions, !pendingSyncActions.isEmpty, let apiClient else { return }
        isProcessingPendingActions = true
        isSyncingPendingActions = true
        defer {
            isProcessingPendingActions = false
            isSyncingPendingActions = false
            persistPendingSyncActions()
        }

        var nextQueue: [PendingSyncAction] = []
        for action in pendingSyncActions {
            do {
                switch action.type {
                case "history":
                    guard
                        let problemID = action.problemID,
                        let subject = action.subject,
                        let selected = action.selectedAnswer,
                        let isCorrect = action.isCorrect
                    else { continue }
                    try await apiClient.submitHistory(problemID: problemID, subject: subject, selectedAnswer: selected, isCorrect: isCorrect, category: action.category)
                case "customMemo":
                    guard let problemID = action.problemID else { continue }
                    try await apiClient.saveCustomExplanation(
                        problemID: problemID,
                        text: action.memoText ?? "",
                        explanationImageDataURL: action.explanationImageDataURL,
                        questionImageDataURL: action.questionImageDataURL
                    )
                case "reviewLaterAdd":
                    guard let subject = action.subject, let problemID = action.problemID else { continue }
                    try await apiClient.saveReviewLater(subject: subject, problemID: problemID)
                case "reviewLaterDelete":
                    guard let subject = action.subject, let problemID = action.problemID else { continue }
                    try await apiClient.deleteReviewLater(subject: subject, problemID: problemID)
                default:
                    continue
                }
            } catch {
                if isNetworkError(error) {
                    nextQueue.append(action)
                    continue
                }
                nextQueue.append(action)
            }
        }
        pendingSyncActions = nextQueue
        syncStatusMessage = nextQueue.isEmpty ? "未送信データの同期が完了しました。" : "一部の未送信データは引き続き保留です。"
    }

    func startQuiz() async {
        guard let apiClient, let deepLink else { return }
        completionMessage = nil
        isSessionFinished = false
        if deepLink.isReviewMode, let subject = deepLink.subjects.first, let problemID = deepLink.problemID {
            isLoading = true
            defer { isLoading = false }
            do {
                let problem = try await apiClient.getProblem(subject: subject, problemID: problemID)
                questions = [problem]
                currentIndex = 0
                historyStats = [:]
                resetQuestionState()
                await syncReviewLaterFlag()
            } catch {
                errorMessage = error.localizedDescription
            }
            return
        }
        guard !deepLink.subjects.isEmpty else {
            errorMessage = "科目が未指定です。Webの問題演習ページから起動してください。"
            return
        }

        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await apiClient.startQuiz(
                subjects: deepLink.subjects,
                mode: deepLink.mode == "today_remaining" ? "unanswered" : deepLink.mode,
                count: deepLink.count
            )
            questions = loaded
            currentIndex = 0
            if !questions.isEmpty {
                await fetchHistoryStats()
            }
            resetQuestionState()
            await syncReviewLaterFlag()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func choose(_ answer: String) {
        guard !isAnswered else { return }
        selectedAnswer = answer
    }

    func submitAnswer() async {
        guard let answer = selectedAnswer, let question = currentQuestion, !isAnswered, !isSubmittingAnswer else { return }
        let answerIsCorrect = (answer == question.answer)
        isSubmittingAnswer = true
        defer { isSubmittingAnswer = false }
        do {
            try await apiClient?.submitHistory(
                problemID: question.id,
                subject: question.subject,
                selectedAnswer: answer,
                isCorrect: answerIsCorrect,
                category: question.category
            )
            isCorrect = answerIsCorrect
            isAnswered = true
            syncStatusMessage = nil
        } catch {
            if isNetworkError(error) {
                enqueuePendingSyncAction(
                    PendingSyncAction(
                        id: UUID().uuidString,
                        type: "history",
                        createdAt: Date(),
                        problemID: question.id,
                        subject: question.subject,
                        selectedAnswer: answer,
                        isCorrect: answerIsCorrect,
                        category: question.category,
                        memoText: nil,
                        explanationImageDataURL: nil,
                        questionImageDataURL: nil
                    )
                )
                isCorrect = answerIsCorrect
                isAnswered = true
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    func submitAsUnknown() async {
        guard let question = currentQuestion, !isAnswered, !isSubmittingAnswer else { return }
        let submittedAnswer = selectedAnswer ?? ""
        isSubmittingAnswer = true
        defer { isSubmittingAnswer = false }
        do {
            try await apiClient?.submitHistory(
                problemID: question.id,
                subject: question.subject,
                selectedAnswer: submittedAnswer,
                isCorrect: false,
                category: question.category
            )
            isCorrect = false
            isAnswered = true
            syncStatusMessage = nil
        } catch {
            if isNetworkError(error) {
                enqueuePendingSyncAction(
                    PendingSyncAction(
                        id: UUID().uuidString,
                        type: "history",
                        createdAt: Date(),
                        problemID: question.id,
                        subject: question.subject,
                        selectedAnswer: submittedAnswer,
                        isCorrect: false,
                        category: question.category,
                        memoText: nil,
                        explanationImageDataURL: nil,
                        questionImageDataURL: nil
                    )
                )
                isCorrect = false
                isAnswered = true
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    func nextQuestion() async {
        if isReviewMode {
            do {
                try await saveCustomMemoIfNeeded()
                completionMessage = "保存済み"
            } catch {
                errorMessage = error.localizedDescription
            }
            return
        }
        guard isAnswered else { return }
        clearPencilLayer()
        do {
            try await saveCustomMemoIfNeeded()
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        if currentIndex < questions.count - 1 {
            currentIndex += 1
            resetQuestionState()
            await syncReviewLaterFlag()
        } else {
            errorMessage = nil
            completionMessage = "保存済み・演習完了"
            isSessionFinished = true
        }
    }

    private func saveCustomMemoOrQueue(
        questionID: String,
        text: String,
        explanationImageDataURL: String?,
        questionImageDataURL: String?
    ) {
        enqueuePendingSyncAction(
            PendingSyncAction(
                id: UUID().uuidString,
                type: "customMemo",
                createdAt: Date(),
                problemID: questionID,
                subject: nil,
                selectedAnswer: nil,
                isCorrect: nil,
                category: nil,
                memoText: text,
                explanationImageDataURL: explanationImageDataURL,
                questionImageDataURL: questionImageDataURL
            )
        )
        if questions.indices.contains(currentIndex) {
            questions[currentIndex].customExplanation = text
            questions[currentIndex].customExplanationImageDataURL = explanationImageDataURL
            questions[currentIndex].customQuestionImageDataURL = questionImageDataURL
        }
        originalMemoText = text
        originalExplanationMemoImageDataURL = explanationImageDataURL
        originalQuestionMemoImageDataURL = questionImageDataURL
    }

    func saveCustomMemoIfNeeded() async throws {
        guard let apiClient, let question = currentQuestion else { return }
        let newText = customMemoText.trimmingCharacters(in: .whitespacesAndNewlines)
        let oldText = originalMemoText.trimmingCharacters(in: .whitespacesAndNewlines)
        let newExplanationImageDataURL = normalizedMemoImageDataURL(customExplanationMemoImageDataURL)
        let oldExplanationImageDataURL = normalizedMemoImageDataURL(originalExplanationMemoImageDataURL)
        let newQuestionImageDataURL = normalizedMemoImageDataURL(customQuestionMemoImageDataURL)
        let oldQuestionImageDataURL = normalizedMemoImageDataURL(originalQuestionMemoImageDataURL)
        if newText == oldText,
           newExplanationImageDataURL == oldExplanationImageDataURL,
           newQuestionImageDataURL == oldQuestionImageDataURL {
            return
        }
        do {
            try await apiClient.saveCustomExplanation(
                problemID: question.id,
                text: customMemoText,
                explanationImageDataURL: newExplanationImageDataURL,
                questionImageDataURL: newQuestionImageDataURL
            )
            syncStatusMessage = nil
        } catch {
            if isNetworkError(error) {
                saveCustomMemoOrQueue(
                    questionID: question.id,
                    text: customMemoText,
                    explanationImageDataURL: newExplanationImageDataURL,
                    questionImageDataURL: newQuestionImageDataURL
                )
            } else {
                throw error
            }
        }
        originalMemoText = customMemoText
        originalExplanationMemoImageDataURL = newExplanationImageDataURL
        originalQuestionMemoImageDataURL = newQuestionImageDataURL
        if questions.indices.contains(currentIndex) {
            questions[currentIndex].customExplanation = customMemoText
            questions[currentIndex].customExplanationImageDataURL = newExplanationImageDataURL
            questions[currentIndex].customQuestionImageDataURL = newQuestionImageDataURL
        }
    }

    func openProblemEditor() {
        guard let question = currentQuestion else { return }
        problemEditDraft = ProblemEditDraft(
            questionText: question.questionText,
            choices: question.choices,
            answer: question.answer,
            explanationText: question.explanation.text,
            category: question.category ?? ""
        )
        isProblemEditSheetPresented = true
    }

    func saveProblemEdit() async {
        guard let apiClient, let question = currentQuestion, let draft = problemEditDraft else { return }
        do {
            let updated = try await apiClient.updateProblem(
                subject: question.subject,
                problemID: question.id,
                questionText: draft.questionText,
                choices: draft.choices,
                answer: draft.answer,
                explanationText: draft.explanationText,
                category: draft.category
            )
            if questions.indices.contains(currentIndex) {
                var merged = updated
                merged.customExplanation = questions[currentIndex].customExplanation
                merged.customExplanationImageDataURL = questions[currentIndex].customExplanationImageDataURL
                merged.customQuestionImageDataURL = questions[currentIndex].customQuestionImageDataURL
                questions[currentIndex] = merged
            }
            isProblemEditSheetPresented = false
            problemEditDraft = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearPencilLayer() {
        canvasView.drawing = PKDrawing()
    }

    func saveExplanationMemoDrawing() {
        guard let imageDataURL = snapshotDrawingDataURL(from: explanationMemoCanvasView) else {
            errorMessage = "解説補足の手書きがありません。"
            return
        }
        errorMessage = nil
        customExplanationMemoImageDataURL = imageDataURL
    }

    func saveQuestionMemoDrawing() {
        guard let imageDataURL = snapshotDrawingDataURL(from: questionMemoCanvasView) else {
            errorMessage = "問題文補足の手書きがありません。"
            return
        }
        errorMessage = nil
        customQuestionMemoImageDataURL = imageDataURL
    }

    func clearExplanationMemoInput() {
        explanationMemoCanvasView.drawing = PKDrawing()
    }

    func clearQuestionMemoInput() {
        questionMemoCanvasView.drawing = PKDrawing()
    }

    func clearExplanationMemoImage() {
        customExplanationMemoImageDataURL = nil
    }

    func clearQuestionMemoImage() {
        customQuestionMemoImageDataURL = nil
    }

    func setInteractionMode(_ mode: InteractionMode) {
        interactionMode = mode
    }

    func toggleReviewLater() async {
        guard let apiClient, let question = currentQuestion, !isUpdatingReviewLater else { return }
        isUpdatingReviewLater = true
        defer { isUpdatingReviewLater = false }
        let shouldRemove = isMarkedForReviewLater
        isMarkedForReviewLater.toggle()
        do {
            if shouldRemove {
                try await apiClient.deleteReviewLater(subject: question.subject, problemID: question.id)
            } else {
                try await apiClient.saveReviewLater(subject: question.subject, problemID: question.id)
            }
            syncStatusMessage = nil
        } catch {
            if isNetworkError(error) {
                enqueuePendingSyncAction(
                    PendingSyncAction(
                        id: UUID().uuidString,
                        type: shouldRemove ? "reviewLaterDelete" : "reviewLaterAdd",
                        createdAt: Date(),
                        problemID: question.id,
                        subject: question.subject,
                        selectedAnswer: nil,
                        isCorrect: nil,
                        category: nil,
                        memoText: nil,
                        explanationImageDataURL: nil,
                        questionImageDataURL: nil
                    )
                )
            } else {
                isMarkedForReviewLater = shouldRemove
                errorMessage = error.localizedDescription
            }
        }
    }

    func expandWriteArea() {
        extraWriteAreaHeight = min(extraWriteAreaHeight + 160, 1200)
    }

    func shrinkWriteArea() {
        extraWriteAreaHeight = max(extraWriteAreaHeight - 160, 0)
    }

    private func resetQuestionState() {
        completionMessage = nil
        isSessionFinished = false
        selectedAnswer = nil
        isAnswered = isReviewMode
        isCorrect = false
        questionStartedAt = Date()
        interactionMode = .draw
        extraWriteAreaHeight = 0
        clearPencilLayer()
        clearExplanationMemoInput()
        clearQuestionMemoInput()
        if let question = currentQuestion {
            customMemoText = question.customExplanation ?? ""
            originalMemoText = customMemoText
            customExplanationMemoImageDataURL = normalizedMemoImageDataURL(question.customExplanationImageDataURL)
            customQuestionMemoImageDataURL = normalizedMemoImageDataURL(question.customQuestionImageDataURL)
            originalExplanationMemoImageDataURL = customExplanationMemoImageDataURL
            originalQuestionMemoImageDataURL = customQuestionMemoImageDataURL
        } else {
            customMemoText = ""
            originalMemoText = ""
            customExplanationMemoImageDataURL = nil
            customQuestionMemoImageDataURL = nil
            originalExplanationMemoImageDataURL = nil
            originalQuestionMemoImageDataURL = nil
        }
    }

    private func fetchHistoryStats() async {
        guard !isReviewMode else {
            historyStats = [:]
            return
        }
        guard let apiClient, let deepLink else { return }
        do {
            let ids = questions.map { $0.id }
            historyStats = try await apiClient.getBulkHistoryStats(problemIDs: ids, subjects: deepLink.subjects)
        } catch {
            historyStats = [:]
        }
    }

    private func syncReviewLaterFlag() async {
        guard !isReviewMode else {
            isMarkedForReviewLater = true
            return
        }
        guard let apiClient, let question = currentQuestion else {
            isMarkedForReviewLater = false
            return
        }
        do {
            isMarkedForReviewLater = try await apiClient.isReviewLater(subject: question.subject, problemID: question.id)
        } catch {
            isMarkedForReviewLater = false
        }
    }

    func remainingTimeRatio(at date: Date) -> CGFloat {
        let elapsed = max(0, date.timeIntervalSince(questionStartedAt))
        let ratio = max(0, min(1, 1 - (elapsed / Self.questionTimerDuration)))
        return CGFloat(ratio)
    }

    var customExplanationMemoImage: UIImage? {
        Self.image(fromDataURL: customExplanationMemoImageDataURL)
    }

    var customQuestionMemoImage: UIImage? {
        Self.image(fromDataURL: customQuestionMemoImageDataURL)
    }

    func resolvedURL(path: String) -> URL? {
        apiClient?.resolveURL(path: path)
    }

    private func normalizedMemoImageDataURL(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func prepareMainCanvas() {
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .pencilOnly
        canvasView.alwaysBounceVertical = false
        canvasView.alwaysBounceHorizontal = false
    }

    private func prepareMemoCanvas(_ canvas: PKCanvasView) {
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        canvas.isUserInteractionEnabled = true
        canvas.isScrollEnabled = false
        canvas.alwaysBounceVertical = false
        canvas.alwaysBounceHorizontal = false
        canvas.tool = PKInkingTool(.pen, color: .black, width: 4)
    }

    private func snapshotDrawingDataURL(from canvas: PKCanvasView) -> String? {
        guard !canvas.drawing.strokes.isEmpty else { return nil }
        let size = canvas.bounds.size
        guard size.width > 0, size.height > 0 else { return nil }
        let image = canvas.drawing.image(from: CGRect(origin: .zero, size: size), scale: 1.0)
        guard let pngData = image.pngData() else { return nil }
        return "data:image/png;base64,\(pngData.base64EncodedString())"
    }

    private static func image(fromDataURL dataURL: String?) -> UIImage? {
        guard
            let dataURL,
            let comma = dataURL.firstIndex(of: ",")
        else {
            return nil
        }
        let encoded = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: encoded) else {
            return nil
        }
        return UIImage(data: data)
    }
}

struct ProblemEditDraft {
    var questionText: String
    var choices: [QuizChoice]
    var answer: String
    var explanationText: String
    var category: String
}

struct QuizPencilOverlayView: UIViewRepresentable {
    @Binding var canvasView: PKCanvasView
    @Binding var toolPicker: PKToolPicker
    @Binding var isDrawMode: Bool

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: .zero)
        container.backgroundColor = .clear
        canvasView.translatesAutoresizingMaskIntoConstraints = false
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .pencilOnly
        container.addSubview(canvasView)
        NSLayoutConstraint.activate([
            canvasView.topAnchor.constraint(equalTo: container.topAnchor),
            canvasView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            canvasView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            canvasView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        toolPicker.setVisible(true, forFirstResponder: canvasView)
        toolPicker.addObserver(canvasView)
        canvasView.becomeFirstResponder()
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        uiView.isUserInteractionEnabled = isDrawMode
        canvasView.isUserInteractionEnabled = isDrawMode
        toolPicker.setVisible(isDrawMode, forFirstResponder: canvasView)
        if isDrawMode {
            canvasView.becomeFirstResponder()
        }
    }
}

struct MemoCanvasInputView: UIViewRepresentable {
    @Binding var canvasView: PKCanvasView

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: .zero)
        container.backgroundColor = .clear
        canvasView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(canvasView)
        NSLayoutConstraint.activate([
            canvasView.topAnchor.constraint(equalTo: container.topAnchor),
            canvasView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            canvasView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            canvasView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .anyInput
        canvasView.isUserInteractionEnabled = true
    }
}

struct QuizPencilModeView: View {
    let deepLink: QuizDeepLink
    @StateObject private var viewModel = QuizPencilModeViewModel()
    @FocusState private var isMemoEditorFocused: Bool
    @State private var previewImage: UIImage?

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                header
                if viewModel.isLoading {
                    ProgressView("問題を取得中...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.isSessionFinished {
                    completionView
                } else if let question = viewModel.currentQuestion {
                    questionBody(question)
                } else {
                    Text(viewModel.errorMessage ?? "問題がありません。")
                        .foregroundColor(.secondary)
                        .padding()
                }
                if let message = viewModel.syncStatusMessage {
                    Text(message)
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(viewModel.pendingSyncCount > 0 ? AppPalette.caution : AppPalette.success)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 4)
                }
                if let message = viewModel.errorMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .padding(.bottom, 4)
                }
                if let message = viewModel.completionMessage {
                    Text(message)
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(AppPalette.success)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 2)
                        .padding(.bottom, 4)
                }
            }
        }
        .padding()
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完了") {
                    isMemoEditorFocused = false
                }
            }
        }
        .task {
            await viewModel.configure(with: deepLink)
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("iPadモード（問題演習）")
                    .font(.headline)
                    .foregroundColor(AppPalette.dark)
                Text(viewModel.isReviewMode ? "レビュー専用モード" : "Mode: \(viewModel.modeLabel) / Count: \(viewModel.countLabel)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                if !viewModel.isReviewMode,
                   let question = viewModel.currentQuestion,
                   let stat = viewModel.historyStats[question.id],
                   stat.total > 0 {
                    Text("直近\(stat.total)回 正答率: \(Int((Double(stat.correct) / Double(stat.total)) * 100))% (\(stat.correct)/\(stat.total))")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    Text("初挑戦")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Text("インストールから\(viewModel.installedElapsedDays)日経過")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                HStack(spacing: 6) {
                    Circle()
                        .fill(viewModel.isNetworkAvailable ? AppPalette.success : AppPalette.caution)
                        .frame(width: 8, height: 8)
                    Text(viewModel.networkStatusText)
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(viewModel.isNetworkAvailable ? AppPalette.success : AppPalette.caution)
                    if viewModel.pendingSyncCount > 0 {
                        Text("未同期\(viewModel.pendingSyncCount)件")
                            .font(.caption2)
                            .foregroundColor(AppPalette.caution)
                    }
                    if viewModel.isSyncingPendingActions {
                        ProgressView()
                            .scaleEffect(0.7)
                    }
                }
            }
            Spacer()
            Text(viewModel.progressText)
                .font(.subheadline)
                .foregroundColor(AppPalette.dark)
        }
    }

    private var completionView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("演習完了")
                .font(.title3.weight(.bold))
                .foregroundColor(AppPalette.dark)
            Text(viewModel.completionMessage ?? "保存済み・演習完了")
                .font(.body)
                .foregroundColor(AppPalette.dark)
            Button("もう一度開始") {
                Task { await viewModel.startQuiz() }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(AppPalette.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))
    }

    @ViewBuilder
    private func questionBody(_ question: QuizQuestion) -> some View {
        VStack(spacing: 12) {
            ScrollView {
                ZStack(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(question.questionText)
                            .font(.title3)
                            .fontWeight(.semibold)
                            .foregroundColor(AppPalette.dark)
                            .padding(.bottom, 4)
                        if !question.imageURLs.isEmpty || viewModel.customQuestionMemoImage != nil {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(Array(question.imageURLs.enumerated()), id: \.offset) { index, path in
                                    if let imageURL = viewModel.resolvedURL(path: path) {
                                        AsyncImage(url: imageURL) { phase in
                                            switch phase {
                                            case .success(let image):
                                                image
                                                    .resizable()
                                                    .scaledToFit()
                                                    .frame(maxWidth: .infinity, minHeight: 140, maxHeight: 260)
                                                    .padding(8)
                                                    .background(AppPalette.white)
                                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
                                            case .failure(_):
                                                Text("画像\(index + 1)を読み込めませんでした。")
                                                    .font(.footnote)
                                                    .foregroundColor(.secondary)
                                            default:
                                                ProgressView()
                                                    .frame(maxWidth: .infinity, minHeight: 140)
                                            }
                                        }
                                    }
                                }
                                if let memoImage = viewModel.customQuestionMemoImage {
                                    memoImageSection(title: "My Memo 問題文補足", image: memoImage)
                                }
                            }
                            .padding(.bottom, 2)
                        }

                        if !viewModel.isReviewMode {
                            TimelineView(.periodic(from: .now, by: 0.25)) { context in
                                let ratio = viewModel.remainingTimeRatio(at: context.date)
                                ZStack(alignment: .leading) {
                                    Capsule()
                                        .fill(AppPalette.light.opacity(0.35))
                                    GeometryReader { proxy in
                                        Capsule()
                                            .fill(AppPalette.primaryNew.opacity(0.65))
                                            .frame(width: proxy.size.width * ratio)
                                    }
                                }
                                .frame(height: 8)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                            }
                            .padding(.bottom, 6)
                        }

                        ForEach(question.choices) { choice in
                            Button {
                                viewModel.choose(choice.label)
                            } label: {
                                HStack(alignment: .top) {
                                    Text("\(choice.label).")
                                        .fontWeight(.bold)
                                        .foregroundColor(AppPalette.dark)
                                    Text(choice.text)
                                        .multilineTextAlignment(.leading)
                                        .foregroundColor(AppPalette.dark)
                                    Spacer()
                                }
                                .padding(10)
                                .background(choiceBackground(choice))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                            .disabled(viewModel.isAnswered || viewModel.isDrawMode || viewModel.isReviewMode)
                        }
                        Spacer(minLength: viewModel.extraWriteAreaHeight)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 0)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                    QuizPencilOverlayView(
                        canvasView: $viewModel.canvasView,
                        toolPicker: $viewModel.toolPicker,
                        isDrawMode: Binding(
                            get: { viewModel.isDrawMode },
                            set: { newValue in viewModel.setInteractionMode(newValue ? .draw : .select) }
                        )
                    )
                }
                .frame(maxWidth: .infinity, minHeight: 560 + viewModel.extraWriteAreaHeight, alignment: .top)
                .background(AppPalette.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))
            }
            .frame(maxWidth: .infinity, minHeight: 560, maxHeight: 560)

            HStack {
                Toggle(isOn: Binding(
                    get: { viewModel.isDrawMode },
                    set: { newValue in viewModel.setInteractionMode(newValue ? .draw : .select) }
                )) {
                    Text(viewModel.isDrawMode ? "手書きモード" : "選択モード")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(AppPalette.dark)
                }
                .toggleStyle(SwitchToggleStyle(tint: AppPalette.primaryNew))

                Button("手書きクリア") {
                    viewModel.clearPencilLayer()
                }
                .buttonStyle(.bordered)
                Button(viewModel.isMarkedForReviewLater ? "登録済み" : "後で確認") {
                    Task { await viewModel.toggleReviewLater() }
                }
                .buttonStyle(.borderedProminent)
                .tint(viewModel.isMarkedForReviewLater ? AppPalette.success : AppPalette.caution)
                .disabled(viewModel.isUpdatingReviewLater)
                Button("余白+") {
                    viewModel.expandWriteArea()
                }
                .buttonStyle(.bordered)
                Button("余白-") {
                    viewModel.shrinkWriteArea()
                }
                .buttonStyle(.bordered)

                Spacer()

                if viewModel.isReviewMode {
                    Button("My Memo保存") {
                        isMemoEditorFocused = false
                        Task { await viewModel.nextQuestion() }
                    }
                    .buttonStyle(.borderedProminent)
                } else if !viewModel.isAnswered {
                    HStack(spacing: 10) {
                        Button("解答する") {
                            Task { await viewModel.submitAnswer() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.selectedAnswer == nil || viewModel.isSubmittingAnswer)

                        Button("わからない") {
                            Task { await viewModel.submitAsUnknown() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppPalette.caution)
                        .disabled(viewModel.isDrawMode || viewModel.isSubmittingAnswer)
                    }
                } else {
                    Button(viewModel.currentIndex + 1 < viewModel.questions.count ? "次の問題へ" : "完了") {
                        isMemoEditorFocused = false
                        Task { await viewModel.nextQuestion() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            if viewModel.isAnswered {
                VStack(alignment: .leading, spacing: 6) {
                    Text(viewModel.isReviewMode ? "レビュー内容" : (viewModel.isCorrect ? "正解" : "不正解"))
                        .font(.headline)
                        .foregroundColor(viewModel.isReviewMode ? AppPalette.primaryNew : (viewModel.isCorrect ? AppPalette.success : AppPalette.danger))
                    Text(viewModel.explanationText.isEmpty ? "この問題の解説はありません。" : viewModel.explanationText)
                        .font(.body)
                        .foregroundColor(AppPalette.dark)
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                    if let memoImage = viewModel.customExplanationMemoImage {
                        memoImageSection(title: "My Memo 解説補足", image: memoImage)
                    }
                    HStack {
                        Button("問題編集") {
                            viewModel.openProblemEditor()
                        }
                        .buttonStyle(.bordered)
                        Spacer()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(AppPalette.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))

                VStack(alignment: .leading, spacing: 6) {
                    Text("My Memo")
                        .font(.headline)
                        .foregroundColor(AppPalette.dark)
                    Text("テキスト入力")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(AppPalette.dark)
                    TextEditor(text: $viewModel.customMemoText)
                        .focused($isMemoEditorFocused)
                        .frame(minHeight: 110)
                        .padding(6)
                        .background(AppPalette.white)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
                    memoHandwritingEditor(
                        title: "解説補足手書き入力",
                        canvasView: $viewModel.explanationMemoCanvasView,
                        onSave: viewModel.saveExplanationMemoDrawing,
                        onClearInput: viewModel.clearExplanationMemoInput,
                        onClearSaved: viewModel.clearExplanationMemoImage,
                        savedImage: viewModel.customExplanationMemoImage,
                        savedImageTitle: "保存済みの解説補足画像"
                    )
                    memoHandwritingEditor(
                        title: "問題文補足手書き入力",
                        canvasView: $viewModel.questionMemoCanvasView,
                        onSave: viewModel.saveQuestionMemoDrawing,
                        onClearInput: viewModel.clearQuestionMemoInput,
                        onClearSaved: viewModel.clearQuestionMemoImage,
                        savedImage: viewModel.customQuestionMemoImage,
                        savedImageTitle: "保存済みの問題文補足画像"
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(AppPalette.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))
            }
        }
        .sheet(isPresented: $viewModel.isProblemEditSheetPresented) {
            ProblemEditSheet(
                draft: $viewModel.problemEditDraft,
                onSave: { Task { await viewModel.saveProblemEdit() } }
            )
        }
        .fullScreenCover(
            isPresented: Binding(
                get: { previewImage != nil },
                set: { shouldPresent in
                    if !shouldPresent {
                        previewImage = nil
                    }
                }
            )
        ) {
            if let previewImage {
                MemoImagePreviewScreen(image: previewImage) {
                    self.previewImage = nil
                }
            }
        }
    }

    private func choiceBackground(_ choice: QuizChoice) -> Color {
        if viewModel.isAnswered {
            if choice.label == viewModel.currentQuestion?.answer {
                return AppPalette.success.opacity(0.22)
            }
            if choice.label == viewModel.selectedAnswer {
                return AppPalette.danger.opacity(0.18)
            }
            return AppPalette.light.opacity(0.18)
        }
        if choice.label == viewModel.selectedAnswer {
            return AppPalette.primaryNew.opacity(0.2)
        }
        return AppPalette.light.opacity(0.18)
    }

    private func memoImageSection(title: String, image: UIImage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(AppPalette.dark)
            Button {
                previewImage = image
            } label: {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, minHeight: 120, maxHeight: 220)
                    .padding(8)
                    .background(AppPalette.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private func memoHandwritingEditor(
        title: String,
        canvasView: Binding<PKCanvasView>,
        onSave: @escaping () -> Void,
        onClearInput: @escaping () -> Void,
        onClearSaved: @escaping () -> Void,
        savedImage: UIImage?,
        savedImageTitle: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(AppPalette.dark)
                Spacer()
                Button("入力クリア") {
                    onClearInput()
                }
                .buttonStyle(.bordered)
                Button("保存") {
                    onSave()
                }
                .buttonStyle(.borderedProminent)
                Button("保存画像クリア") {
                    onClearSaved()
                }
                .buttonStyle(.bordered)
                .disabled(savedImage == nil)
            }
            MemoCanvasInputView(canvasView: canvasView)
                .frame(minHeight: 270)
                .background(AppPalette.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
            if let savedImage {
                memoImageSection(title: savedImageTitle, image: savedImage)
            }
        }
    }
}

struct MemoImagePreviewScreen: View {
    let image: UIImage
    let onClose: () -> Void

    var body: some View {
        NavigationView {
            ZStack {
                Color.black.opacity(0.92)
                    .ignoresSafeArea()
                ScrollView([.horizontal, .vertical]) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .padding()
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        onClose()
                    }
                }
            }
        }
    }
}

struct ProblemEditSheet: View {
    @Binding var draft: ProblemEditDraft?
    let onSave: () -> Void
    @FocusState private var isAnyFieldFocused: Bool

    var body: some View {
        NavigationView {
            if let _ = draft {
                Form {
                    Section("問題文") {
                        TextEditor(text: binding(\.questionText))
                            .focused($isAnyFieldFocused)
                            .frame(minHeight: 120)
                    }
                    Section("選択肢") {
                        ForEach(0..<(draft?.choices.count ?? 0), id: \.self) { idx in
                            VStack(alignment: .leading, spacing: 4) {
                                TextField("ラベル", text: choiceBinding(idx, \.label))
                                    .focused($isAnyFieldFocused)
                                TextField("本文", text: choiceBinding(idx, \.text))
                                    .focused($isAnyFieldFocused)
                            }
                        }
                    }
                    Section("正解") {
                        TextField("正解ラベル", text: binding(\.answer))
                            .focused($isAnyFieldFocused)
                    }
                    Section("解説") {
                        TextEditor(text: binding(\.explanationText))
                            .focused($isAnyFieldFocused)
                            .frame(minHeight: 100)
                    }
                    Section("カテゴリ") {
                        TextField("カテゴリ", text: binding(\.category))
                            .focused($isAnyFieldFocused)
                    }
                }
                .navigationTitle("問題編集")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            isAnyFieldFocused = false
                            onSave()
                        }
                    }
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("完了") {
                            isAnyFieldFocused = false
                        }
                    }
                }
                .scrollDismissesKeyboard(.interactively)
            } else {
                Text("編集対象がありません。")
            }
        }
    }

    private func binding(_ keyPath: WritableKeyPath<ProblemEditDraft, String>) -> Binding<String> {
        Binding<String>(
            get: { draft?[keyPath: keyPath] ?? "" },
            set: { newValue in
                guard var value = draft else { return }
                value[keyPath: keyPath] = newValue
                draft = value
            }
        )
    }

    private func choiceBinding(_ index: Int, _ keyPath: WritableKeyPath<QuizChoice, String>) -> Binding<String> {
        Binding<String>(
            get: {
                guard let item = draft?.choices[safe: index] else { return "" }
                return item[keyPath: keyPath]
            },
            set: { newValue in
                guard var value = draft, value.choices.indices.contains(index) else { return }
                value.choices[index][keyPath: keyPath] = newValue
                draft = value
            }
        )
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else { return nil }
        return self[index]
    }
}
