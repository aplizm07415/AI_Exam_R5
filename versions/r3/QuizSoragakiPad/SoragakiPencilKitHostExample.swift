import SwiftUI
import PencilKit
import Combine
import Network

private extension UIColor {
    static let quizInkBlack = UIColor(red: 5.0 / 255.0, green: 20.0 / 255.0, blue: 37.0 / 255.0, alpha: 1)
}

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

struct QuizSessionDescriptor {
    let subjects: [String]
    let mode: String
    let count: Int
    let problemID: String?
    let iPadProfileRaw: String?

    var isReviewMode: Bool {
        problemID != nil
    }
}

protocol QuizSessionBackend {
    var supportsPendingSyncQueue: Bool { get }
    var networkStatusText: String { get }
    var isNetworkAvailable: Bool { get }

    func loadQuestions(for session: QuizSessionDescriptor) async throws -> [QuizQuestion]
    func submitHistory(problemID: String, subject: String, selectedAnswer: String, isCorrect: Bool, category: String?, mode: String?) async throws
    func loadHistoryStats(problemIDs: [String], subjects: [String]) async throws -> [String: QuizHistoryStat]
    func isReviewLater(subject: String, problemID: String) async throws -> Bool
    func saveReviewLater(subject: String, problemID: String) async throws
    func deleteReviewLater(subject: String, problemID: String) async throws
    func saveCustomExplanation(problemID: String, text: String, explanationImageDataURL: String?, questionImageDataURL: String?) async throws
    func updateProblem(subject: String, problemID: String, questionText: String, choices: [QuizChoice], answer: String, explanationText: String, category: String?) async throws -> QuizQuestion
    func resolveURL(path: String) -> URL?
}

struct RemoteQuizSessionBackend: QuizSessionBackend {
    let apiClient: SoragakiAPIClient

    var supportsPendingSyncQueue: Bool { true }
    var networkStatusText: String { "ネットワーク確認中..." }
    var isNetworkAvailable: Bool { true }

    func loadQuestions(for session: QuizSessionDescriptor) async throws -> [QuizQuestion] {
        if session.isReviewMode, let subject = session.subjects.first, let problemID = session.problemID {
            return [try await apiClient.getProblem(subject: subject, problemID: problemID)]
        }
        guard !session.subjects.isEmpty else {
            throw APIError.decoding("科目が未指定です。")
        }
        return try await apiClient.startQuiz(
            subjects: session.subjects,
            mode: session.mode == "today_remaining" ? "unanswered" : session.mode,
            count: session.count
        )
    }

    func submitHistory(problemID: String, subject: String, selectedAnswer: String, isCorrect: Bool, category: String?, mode: String?) async throws {
        try await apiClient.submitHistory(problemID: problemID, subject: subject, selectedAnswer: selectedAnswer, isCorrect: isCorrect, category: category, mode: mode)
    }

    func loadHistoryStats(problemIDs: [String], subjects: [String]) async throws -> [String: QuizHistoryStat] {
        try await apiClient.getBulkHistoryStats(problemIDs: problemIDs, subjects: subjects)
    }

    func isReviewLater(subject: String, problemID: String) async throws -> Bool {
        try await apiClient.isReviewLater(subject: subject, problemID: problemID)
    }

    func saveReviewLater(subject: String, problemID: String) async throws {
        try await apiClient.saveReviewLater(subject: subject, problemID: problemID)
    }

    func deleteReviewLater(subject: String, problemID: String) async throws {
        try await apiClient.deleteReviewLater(subject: subject, problemID: problemID)
    }

    func saveCustomExplanation(problemID: String, text: String, explanationImageDataURL: String?, questionImageDataURL: String?) async throws {
        try await apiClient.saveCustomExplanation(
            problemID: problemID,
            text: text,
            explanationImageDataURL: explanationImageDataURL,
            questionImageDataURL: questionImageDataURL
        )
    }

    func updateProblem(subject: String, problemID: String, questionText: String, choices: [QuizChoice], answer: String, explanationText: String, category: String?) async throws -> QuizQuestion {
        try await apiClient.updateProblem(
            subject: subject,
            problemID: problemID,
            questionText: questionText,
            choices: choices,
            answer: answer,
            explanationText: explanationText,
            category: category
        )
    }

    func resolveURL(path: String) -> URL? {
        apiClient.resolveURL(path: path)
    }
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
    private static let installFingerprintKey = "quiz_app_install_fingerprint"
    private static let memoColorIDKey = "quiz_app_memo_color_id"
    private static let memoColorWheelRotationKey = "quiz_app_memo_color_wheel_rotation"
    private static let memoRecentColorIDsKey = "quiz_app_memo_recent_color_ids"

    enum InteractionMode {
        case select
        case draw
    }

    enum IPadProfile: String {
        case mini
        case airOrLarger

        var displayName: String {
            switch self {
            case .mini:
                return "iPad mini"
            case .airOrLarger:
                return "iPad Air"
            }
        }

        init(deepLinkProfile: QuizDeepLink.IPadProfile) {
            switch deepLinkProfile {
            case .air:
                self = .airOrLarger
            case .mini:
                self = .mini
            }
        }

        var memoInputHint: String {
            switch self {
            case .mini:
                return "My Memo はキーボード入力を基本にして、補足欄は手書き入力で使う前提です。"
            case .airOrLarger:
                return "My Memo はキーボード入力に加えて、Apple Pencil の手書き文字入力も使えます。"
            }
        }
    }

    enum MemoCanvasTarget: String, Identifiable {
        case explanation
        case question

        var id: String { rawValue }
    }

    enum MemoToolKind: String, CaseIterable, Identifiable {
        case pencil
        case pen
        case marker
        case eraser

        var id: String { rawValue }

        var label: String {
            switch self {
            case .pencil:
                return "鉛筆"
            case .pen:
                return "ペン"
            case .marker:
                return "マーカー"
            case .eraser:
                return "消しゴム"
            }
        }

        var symbolName: String {
            switch self {
            case .pencil:
                return "pencil.tip"
            case .pen:
                return "pencil.line"
            case .marker:
                return "highlighter"
            case .eraser:
                return "eraser"
            }
        }
    }

    struct MemoInkColor: Identifiable, Equatable {
        let id: String
        let name: String
        let code: String
        let familyCode: String
        let uiColor: UIColor
        let ring: Int
        let slot: Int

        static func == (lhs: MemoInkColor, rhs: MemoInkColor) -> Bool {
            lhs.id == rhs.id
        }

        var color: Color {
            Color(uiColor: uiColor)
        }

        static let defaultColorID = "neutral-0"

        static let palette: [MemoInkColor] = {
            let neutralSwatches: [(String, String, String)] = [
                ("100", "Black", "#051425"),
                ("C3", "Cool Gray", "#4b555f"),
                ("N4", "Neutral Gray", "#7d878f"),
                ("W3", "Warm Gray", "#b5ac9c"),
                ("T1", "Tonal Gray", "#ded7cd"),
                ("C1", "Cool Light", "#c9d2db"),
                ("N1", "Neutral Light", "#dfe4e8"),
                ("W1", "Warm Light", "#ede3d6"),
                ("110", "White", "#f8fbff"),
            ]

            let neutrals = neutralSwatches.enumerated().map { index, swatch in
                MemoInkColor(
                    id: "neutral-\(index)",
                    name: swatch.1,
                    code: swatch.0,
                    familyCode: "GRAY",
                    uiColor: UIColor(Color(hex: swatch.2)),
                    ring: 0,
                    slot: index
                )
            }

            let familyCodes = ["R", "YR", "Y", "YG", "G", "BG", "B", "BV", "RV"]
            let ringConfigs: [(CGFloat, CGFloat)] = [
                (0.35, 1.00),
                (0.50, 0.98),
                (0.65, 0.96),
                (0.80, 0.93),
                (0.96, 0.90),
            ]

            let chromatic = ringConfigs.enumerated().flatMap { ringIndex, config in
                (0..<9).map { slot in
                    let hue = CGFloat(slot) / 9.0
                    return MemoInkColor(
                        id: "ring-\(ringIndex)-slot-\(slot)",
                        name: "\(familyCodes[slot]) Family",
                        code: "\(familyCodes[slot])\(ringIndex * 2 + 1)",
                        familyCode: familyCodes[slot],
                        uiColor: UIColor(hue: hue, saturation: config.0, brightness: config.1, alpha: 1),
                        ring: ringIndex + 1,
                        slot: slot
                    )
                }
            }

            return neutrals + chromatic
        }()

        static var defaultColor: MemoInkColor {
            color(withID: defaultColorID)
        }

        static func color(withID id: String?) -> MemoInkColor {
            guard let id, let match = palette.first(where: { $0.id == id }) else {
                return defaultColorFallback
            }
            return match
        }

        private static var defaultColorFallback: MemoInkColor {
            palette.first(where: { $0.id == defaultColorID }) ?? palette[0]
        }
    }

    struct MemoToolState: Equatable {
        var kind: MemoToolKind = .pen
        var color: MemoInkColor = MemoInkColor.defaultColor
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
    @Published var iPadProfile: IPadProfile = .airOrLarger
    @Published var canvasView = PKCanvasView()
    @Published var toolPicker = PKToolPicker()
    @Published var interactionMode: InteractionMode = .draw
    @Published var explanationCanvasView = PKCanvasView()
    @Published var explanationToolPicker = PKToolPicker()
    @Published var isExplanationDrawMode: Bool = true
    @Published var extraWriteAreaHeight: CGFloat = 0
    @Published var customMemoText: String = ""
    @Published var explanationMemoCanvasView = PKCanvasView()
    @Published var questionMemoCanvasView = PKCanvasView()
    @Published var explanationMemoToolPicker = PKToolPicker()
    @Published var questionMemoToolPicker = PKToolPicker()
    @Published var explanationMemoTool = MemoToolState()
    @Published var questionMemoTool = MemoToolState()
    @Published var memoColorWheelRotation: Double = -90
    @Published var recentMemoColors: [MemoInkColor] = []
    @Published var explanationMemoExtraHeight: CGFloat = 0
    @Published var questionMemoExtraHeight: CGFloat = 0
    @Published var customExplanationMemoImageDataURL: String?
    @Published var customQuestionMemoImageDataURL: String?
    @Published var historyStats: [String: QuizHistoryStat] = [:]
    @Published var isProblemEditSheetPresented: Bool = false
    @Published var problemEditDraft: ProblemEditDraft?
    @Published var questionStartedAt: Date = Date()
    @Published var installedElapsedDays: Int = 0
    @Published var isSubmittingAnswer: Bool = false
    @Published var isAdvancingQuestion: Bool = false
    @Published var isSavingCustomMemo: Bool = false
    @Published var isNetworkAvailable: Bool = true
    @Published var networkStatusText: String = "ネットワーク確認中..."
    @Published var pendingSyncCount: Int = 0
    @Published var isSyncingPendingActions: Bool = false
    @Published var syncStatusMessage: String?

    private var backend: (any QuizSessionBackend)?
    private var session: QuizSessionDescriptor?
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

    var processingStatusText: String {
        if isLoading {
            return isReviewMode ? "レビュー問題を取得中" : "問題を取得中"
        }
        if isSubmittingAnswer {
            return "結果アップロード中"
        }
        if isSavingCustomMemo && isAdvancingQuestion {
            return isReviewMode ? "My Memo同期中" : "My Memo同期後に次問題へ遷移中"
        }
        if isSavingCustomMemo {
            return "My Memo同期中"
        }
        if isAdvancingQuestion {
            return currentIndex + 1 < questions.count ? "次問題へ遷移中" : "完了処理中"
        }
        if isUpdatingReviewLater {
            return "後で確認を同期中"
        }
        if isSyncingPendingActions {
            return "未同期データを再送中"
        }
        return "待機中"
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
        let session = QuizSessionDescriptor(
            subjects: deepLink.subjects,
            mode: deepLink.mode,
            count: deepLink.count,
            problemID: deepLink.problemID,
            iPadProfileRaw: deepLink.iPadProfile?.rawValue
        )
        let backend = RemoteQuizSessionBackend(apiClient: SoragakiAPIClient(baseURL: deepLink.baseURL))
        await configure(session: session, backend: backend)
    }

    func configure(session: QuizSessionDescriptor, backend: any QuizSessionBackend) async {
        self.session = session
        self.backend = backend
        isReviewMode = session.isReviewMode
        modeLabel = session.mode
        countLabel = "\(session.count)"
        if let raw = session.iPadProfileRaw,
           let deepLinkProfile = QuizDeepLink.IPadProfile(rawValue: raw) {
            iPadProfile = IPadProfile(deepLinkProfile: deepLinkProfile)
        } else {
            iPadProfile = detectIPadProfile()
        }
        updateInstalledElapsedDays()
        loadPersistedMemoPaletteSettings()
        if backend.supportsPendingSyncQueue {
            loadPendingSyncActions()
            setupNetworkMonitor()
        } else {
            pendingSyncActions = []
            pendingSyncCount = 0
            isNetworkAvailable = backend.isNetworkAvailable
            networkStatusText = backend.networkStatusText
            networkMonitor?.cancel()
            networkMonitor = nil
        }
        prepareMainCanvas()
        prepareExplanationCanvas()
        prepareMemoCanvas(explanationMemoCanvasView, toolState: explanationMemoTool)
        prepareMemoCanvas(questionMemoCanvasView, toolState: questionMemoTool)
        await startQuiz()
        if backend.supportsPendingSyncQueue {
            await processPendingSyncActionsIfNeeded()
        }
    }

    private func loadPersistedMemoPaletteSettings() {
        let defaults = UserDefaults.standard
        let persistedColor = MemoInkColor.color(withID: defaults.string(forKey: Self.memoColorIDKey))
        explanationMemoTool.color = persistedColor
        questionMemoTool.color = persistedColor
        let persistedRotation = defaults.object(forKey: Self.memoColorWheelRotationKey) as? Double
        memoColorWheelRotation = persistedRotation ?? -90
        let recentColorIDs = defaults.stringArray(forKey: Self.memoRecentColorIDsKey) ?? [persistedColor.id]
        recentMemoColors = recentColorIDs.map { MemoInkColor.color(withID: $0) }
    }

    private func persistMemoPaletteSettings() {
        let defaults = UserDefaults.standard
        defaults.set(explanationMemoTool.color.id, forKey: Self.memoColorIDKey)
        defaults.set(memoColorWheelRotation, forKey: Self.memoColorWheelRotationKey)
        defaults.set(recentMemoColors.map(\.id), forKey: Self.memoRecentColorIDsKey)
    }

    private func registerRecentMemoColor(_ color: MemoInkColor) {
        var next = recentMemoColors.filter { $0 != color }
        next.insert(color, at: 0)
        recentMemoColors = Array(next.prefix(8))
    }

    private func updateInstalledElapsedDays() {
        let defaults = UserDefaults.standard
        let now = Date()
        let currentFingerprint = currentInstallFingerprint()
        let installDate: Date
        let savedFingerprint = defaults.string(forKey: Self.installFingerprintKey)
        if let savedDate = defaults.object(forKey: Self.installDateKey) as? Date,
           savedFingerprint == currentFingerprint {
            installDate = savedDate
        } else {
            installDate = now
            defaults.set(installDate, forKey: Self.installDateKey)
            defaults.set(currentFingerprint, forKey: Self.installFingerprintKey)
        }
        let startOfInstall = Calendar.current.startOfDay(for: installDate)
        let startOfNow = Calendar.current.startOfDay(for: now)
        let elapsed = Calendar.current.dateComponents([.day], from: startOfInstall, to: startOfNow).day ?? 0
        installedElapsedDays = max(0, elapsed)
    }

    private func currentInstallFingerprint() -> String {
        let bundleURL = Bundle.main.bundleURL
        let creationDate = (try? bundleURL.resourceValues(forKeys: [.creationDateKey]).creationDate)?
            .timeIntervalSince1970 ?? 0
        return "\(bundleURL.path)|\(creationDate)"
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
        guard
            let backend,
            backend.supportsPendingSyncQueue,
            isNetworkAvailable,
            !isProcessingPendingActions,
            !pendingSyncActions.isEmpty
        else { return }
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
                    try await backend.submitHistory(problemID: problemID, subject: subject, selectedAnswer: selected, isCorrect: isCorrect, category: action.category, mode: session?.mode)
                case "customMemo":
                    guard let problemID = action.problemID else { continue }
                    try await backend.saveCustomExplanation(
                        problemID: problemID,
                        text: action.memoText ?? "",
                        explanationImageDataURL: action.explanationImageDataURL,
                        questionImageDataURL: action.questionImageDataURL
                    )
                case "reviewLaterAdd":
                    guard let subject = action.subject, let problemID = action.problemID else { continue }
                    try await backend.saveReviewLater(subject: subject, problemID: problemID)
                case "reviewLaterDelete":
                    guard let subject = action.subject, let problemID = action.problemID else { continue }
                    try await backend.deleteReviewLater(subject: subject, problemID: problemID)
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

    func refreshPendingSyncState() async {
        guard let backend, backend.supportsPendingSyncQueue else { return }
        loadPendingSyncActions()
        await processPendingSyncActionsIfNeeded()
    }

    func startQuiz() async {
        guard let backend, let session else { return }
        completionMessage = nil
        isSessionFinished = false
        guard !session.subjects.isEmpty else {
            errorMessage = "科目が未指定です。Webの問題演習ページから起動してください。"
            return
        }

        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await backend.loadQuestions(for: session)
            questions = loaded
            currentIndex = 0
            if !questions.isEmpty, !session.isReviewMode {
                await fetchHistoryStats()
            } else {
                historyStats = [:]
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
        guard let backend, let answer = selectedAnswer, let question = currentQuestion, !isAnswered, !isSubmittingAnswer else { return }
        let answerIsCorrect = (answer == question.answer)
        isSubmittingAnswer = true
        defer { isSubmittingAnswer = false }
        do {
            try await backend.submitHistory(
                problemID: question.id,
                subject: question.subject,
                selectedAnswer: answer,
                isCorrect: answerIsCorrect,
                category: question.category,
                mode: session?.mode
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
        guard let backend, let question = currentQuestion, !isAnswered, !isSubmittingAnswer else { return }
        let submittedAnswer = selectedAnswer ?? ""
        isSubmittingAnswer = true
        defer { isSubmittingAnswer = false }
        do {
            try await backend.submitHistory(
                problemID: question.id,
                subject: question.subject,
                selectedAnswer: submittedAnswer,
                isCorrect: false,
                category: question.category,
                mode: session?.mode
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
        guard !isAdvancingQuestion else { return }
        isAdvancingQuestion = true
        defer { isAdvancingQuestion = false }

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
        guard let backend, let question = currentQuestion else { return }
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
        isSavingCustomMemo = true
        defer { isSavingCustomMemo = false }
        do {
            try await backend.saveCustomExplanation(
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
        guard let backend, let question = currentQuestion, let draft = problemEditDraft else { return }
        do {
            let updated = try await backend.updateProblem(
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

    func clearExplanationPencilLayer() {
        explanationCanvasView.drawing = PKDrawing()
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
        guard let backend, let question = currentQuestion, !isUpdatingReviewLater else { return }
        isUpdatingReviewLater = true
        defer { isUpdatingReviewLater = false }
        let shouldRemove = isMarkedForReviewLater
        isMarkedForReviewLater.toggle()
        do {
            if shouldRemove {
                try await backend.deleteReviewLater(subject: question.subject, problemID: question.id)
            } else {
                try await backend.saveReviewLater(subject: question.subject, problemID: question.id)
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
        isExplanationDrawMode = true
        extraWriteAreaHeight = 0
        explanationMemoExtraHeight = 0
        questionMemoExtraHeight = 0
        clearPencilLayer()
        clearExplanationPencilLayer()
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
        guard let backend, let session else { return }
        do {
            let ids = questions.map { $0.id }
            historyStats = try await backend.loadHistoryStats(problemIDs: ids, subjects: session.subjects)
        } catch {
            historyStats = [:]
        }
    }

    private func syncReviewLaterFlag() async {
        guard !isReviewMode else {
            isMarkedForReviewLater = true
            return
        }
        guard let backend, let question = currentQuestion else {
            isMarkedForReviewLater = false
            return
        }
        do {
            isMarkedForReviewLater = try await backend.isReviewLater(subject: question.subject, problemID: question.id)
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
        backend?.resolveURL(path: path)
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

    private func prepareExplanationCanvas() {
        explanationCanvasView.backgroundColor = .clear
        explanationCanvasView.isOpaque = false
        explanationCanvasView.drawingPolicy = .pencilOnly
        explanationCanvasView.alwaysBounceVertical = false
        explanationCanvasView.alwaysBounceHorizontal = false
    }

    private func prepareMemoCanvas(_ canvas: PKCanvasView, toolState: MemoToolState) {
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        canvas.isUserInteractionEnabled = true
        canvas.isScrollEnabled = false
        canvas.alwaysBounceVertical = false
        canvas.alwaysBounceHorizontal = false
        canvas.tool = makeCanvasTool(from: toolState)
    }

    private func detectIPadProfile() -> IPadProfile {
        let screenSize =
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first?.screen.bounds.size
            ?? .zero
        let shorterEdge = min(screenSize.width, screenSize.height)
        return shorterEdge <= 744 ? .mini : .airOrLarger
    }

    private func makeCanvasTool(from state: MemoToolState) -> PKTool {
        switch state.kind {
        case .pencil:
            return PKInkingTool(.pencil, color: state.color.uiColor, width: 3)
        case .pen:
            return PKInkingTool(.pen, color: state.color.uiColor, width: 4)
        case .marker:
            return PKInkingTool(.marker, color: state.color.uiColor, width: 12)
        case .eraser:
            return PKEraserTool(.vector)
        }
    }

    private func applyMemoTool(for target: MemoCanvasTarget) {
        switch target {
        case .explanation:
            explanationMemoCanvasView.tool = makeCanvasTool(from: explanationMemoTool)
        case .question:
            questionMemoCanvasView.tool = makeCanvasTool(from: questionMemoTool)
        }
    }

    func setMemoToolKind(_ kind: MemoToolKind, for target: MemoCanvasTarget) {
        switch target {
        case .explanation:
            explanationMemoTool.kind = kind
        case .question:
            questionMemoTool.kind = kind
        }
        applyMemoTool(for: target)
    }

    func setMemoInkColor(_ color: MemoInkColor, for target: MemoCanvasTarget) {
        explanationMemoTool.color = color
        questionMemoTool.color = color
        switch target {
        case .explanation:
            if explanationMemoTool.kind == .eraser {
                explanationMemoTool.kind = .pen
            }
            applyMemoTool(for: .question)
        case .question:
            if questionMemoTool.kind == .eraser {
                questionMemoTool.kind = .pen
            }
            applyMemoTool(for: .explanation)
        }
        applyMemoTool(for: target)
        registerRecentMemoColor(color)
        persistMemoPaletteSettings()
    }

    func setMemoColorWheelRotation(_ rotation: Double) {
        memoColorWheelRotation = rotation
        persistMemoPaletteSettings()
    }

    func expandMemoInputArea(for target: MemoCanvasTarget) {
        switch target {
        case .explanation:
            explanationMemoExtraHeight = min(explanationMemoExtraHeight + 220, 1600)
        case .question:
            questionMemoExtraHeight = min(questionMemoExtraHeight + 220, 1600)
        }
    }

    func shrinkMemoInputArea(for target: MemoCanvasTarget) {
        switch target {
        case .explanation:
            explanationMemoExtraHeight = max(explanationMemoExtraHeight - 220, 0)
        case .question:
            questionMemoExtraHeight = max(questionMemoExtraHeight - 220, 0)
        }
    }

    private func snapshotDrawingDataURL(from canvas: PKCanvasView) -> String? {
        guard !canvas.drawing.strokes.isEmpty else { return nil }
        let size = canvas.bounds.size
        guard size.width > 0, size.height > 0 else { return nil }
        let drawingBounds = canvas.drawing.bounds.insetBy(dx: -24, dy: -24)
        let canvasBounds = CGRect(origin: .zero, size: size)
        let captureRect = drawingBounds.intersection(canvasBounds)
        let targetRect = captureRect.isNull || captureRect.isEmpty ? canvasBounds : captureRect
        let image = canvas.drawing.image(from: targetRect, scale: 2.0)
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
    @Binding var toolPicker: PKToolPicker
    let isActive: Bool

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: .zero)
        container.backgroundColor = .clear
        canvasView.translatesAutoresizingMaskIntoConstraints = false
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .pencilOnly
        canvasView.isUserInteractionEnabled = true
        container.addSubview(canvasView)
        NSLayoutConstraint.activate([
            canvasView.topAnchor.constraint(equalTo: container.topAnchor),
            canvasView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            canvasView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            canvasView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        toolPicker.setVisible(false, forFirstResponder: canvasView)
        toolPicker.addObserver(canvasView)
        if isActive {
            canvasView.becomeFirstResponder()
        }
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        uiView.isUserInteractionEnabled = isActive
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .pencilOnly
        canvasView.isUserInteractionEnabled = isActive
        toolPicker.setVisible(false, forFirstResponder: canvasView)
        if isActive {
            canvasView.becomeFirstResponder()
        }
    }
}

struct MemoTextEditorView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let allowsStylusHandwriting: Bool

    final class MemoTextView: UITextView {
        var allowsStylusHandwriting = true

        private func shouldIgnore(_ touches: Set<UITouch>) -> Bool {
            !allowsStylusHandwriting && touches.contains(where: { $0.type == .pencil })
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard !shouldIgnore(touches) else { return }
            super.touchesBegan(touches, with: event)
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard !shouldIgnore(touches) else { return }
            super.touchesMoved(touches, with: event)
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard !shouldIgnore(touches) else { return }
            super.touchesEnded(touches, with: event)
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard !shouldIgnore(touches) else { return }
            super.touchesCancelled(touches, with: event)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: MemoTextEditorView

        init(parent: MemoTextEditorView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MemoTextView {
        let textView = MemoTextView(frame: .zero)
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.textColor = .quizInkBlack
        textView.font = .preferredFont(forTextStyle: .body)
        textView.textContainerInset = UIEdgeInsets(top: 8, left: 4, bottom: 8, right: 4)
        textView.keyboardDismissMode = .interactive
        textView.isScrollEnabled = true
        textView.allowsStylusHandwriting = allowsStylusHandwriting
        return textView
    }

    func updateUIView(_ textView: MemoTextView, context: Context) {
        if textView.text != text {
            textView.text = text
        }
        textView.textColor = .quizInkBlack
        textView.allowsStylusHandwriting = allowsStylusHandwriting
        if isFocused, !textView.isFirstResponder {
            textView.becomeFirstResponder()
        } else if !isFocused, textView.isFirstResponder {
            textView.resignFirstResponder()
        }
    }
}

struct QuizPencilModeView: View {
    @Environment(\.scenePhase) private var scenePhase

    private enum ScrollTarget: String {
        case top
        case myMemo
        case myMemoContent
        case myMemoEditor
        case explanationMemo
        case explanationMemoContent
        case questionMemo
        case questionMemoContent
    }

    private let session: QuizSessionDescriptor
    private let backend: any QuizSessionBackend
    private let onFinish: (() -> Void)?
    @StateObject private var viewModel = QuizPencilModeViewModel()
    @State private var isMemoEditorFocused = false
    @State private var previewImage: UIImage?
    @State private var isQuestionAreaExpanded = true
    @State private var isExplanationAreaExpanded = true
    @State private var isMyMemoAreaExpanded = true
    @State private var isMyMemoSectionExpanded = false
    @State private var isExplanationMemoSectionExpanded = false
    @State private var isQuestionMemoSectionExpanded = false
    @State private var activeMemoColorWheelTarget: QuizPencilModeViewModel.MemoCanvasTarget?

    init(deepLink: QuizDeepLink) {
        self.session = QuizSessionDescriptor(
            subjects: deepLink.subjects,
            mode: deepLink.mode,
            count: deepLink.count,
            problemID: deepLink.problemID,
            iPadProfileRaw: deepLink.iPadProfile?.rawValue
        )
        self.backend = RemoteQuizSessionBackend(apiClient: SoragakiAPIClient(baseURL: deepLink.baseURL))
        self.onFinish = nil
    }

    init(session: QuizSessionDescriptor, backend: any QuizSessionBackend, onFinish: (() -> Void)? = nil) {
        self.session = session
        self.backend = backend
        self.onFinish = onFinish
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                ScrollViewReader { scrollProxy in
                    ScrollView {
                        VStack(spacing: 10) {
                            header
                                .id(ScrollTarget.top)
                            if viewModel.isLoading {
                                ProgressView("問題を取得中...")
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            } else if viewModel.isSessionFinished {
                                completionView
                            } else if let question = viewModel.currentQuestion {
                                questionBody(question, availableHeight: geometry.size.height)
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
                    .onChange(of: viewModel.currentQuestion?.id) { _, _ in
                        collapseMemoSections()
                        isQuestionAreaExpanded = true
                        isExplanationAreaExpanded = true
                        isMyMemoAreaExpanded = true
                        isMemoEditorFocused = false
                        withAnimation(.easeInOut(duration: 0.2)) {
                            scrollProxy.scrollTo(ScrollTarget.top, anchor: .top)
                        }
                    }
                    .onChange(of: isMyMemoSectionExpanded) { _, isExpanded in
                        guard isExpanded else { return }
                        scrollToSection(.myMemo, with: scrollProxy)
                    }
                    .onChange(of: isMemoEditorFocused) { _, isFocused in
                        guard isFocused else { return }
                        if !isMyMemoSectionExpanded {
                            isMyMemoSectionExpanded = true
                        }
                        scrollToMemoEditor(with: scrollProxy)
                    }
                    .onChange(of: isExplanationMemoSectionExpanded) { _, isExpanded in
                        guard isExpanded else { return }
                        scrollToSection(.explanationMemo, with: scrollProxy)
                    }
                    .onChange(of: isQuestionMemoSectionExpanded) { _, isExpanded in
                        guard isExpanded else { return }
                        scrollToSection(.questionMemo, with: scrollProxy)
                    }
                    .onChange(of: scenePhase) { _, newPhase in
                        guard newPhase == .active else { return }
                        Task {
                            await viewModel.refreshPendingSyncState()
                        }
                    }
                    .onChange(of: viewModel.isSessionFinished) { _, finished in
                        guard finished else { return }
                        onFinish?()
                    }
                    .task {
                        await viewModel.configure(session: session, backend: backend)
                        collapseMemoSections()
                        isQuestionAreaExpanded = true
                        isExplanationAreaExpanded = true
                        isMyMemoAreaExpanded = true
                    }
                }

                if let target = activeMemoColorWheelTarget {
                    ZStack {
                        Color.black.opacity(0.001)
                            .ignoresSafeArea()
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                                    activeMemoColorWheelTarget = nil
                                }
                            }

                        MemoColorWheelOverlay(
                            title: target == .explanation ? "解説補足の色変更" : "問題補足の色変更",
                            selectedColor: memoToolState(for: target).color,
                            selectedTool: memoToolState(for: target).kind,
                            rotationDegrees: viewModel.memoColorWheelRotation,
                            recentColors: viewModel.recentMemoColors,
                            onSelectColor: { color in
                                viewModel.setMemoInkColor(color, for: target)
                            },
                            onSelectTool: { kind in
                                viewModel.setMemoToolKind(kind, for: target)
                            },
                            onRotate: { rotation in
                                viewModel.setMemoColorWheelRotation(rotation)
                            },
                            onClose: {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                                    activeMemoColorWheelTarget = nil
                                }
                            }
                        )
                        .frame(width: min(geometry.size.width * 0.7, 620), height: min(geometry.size.height * 0.78, 760))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .padding(.top, 82)
                        .padding(.trailing, 18)
                    }
                    .transition(.asymmetric(insertion: .scale(scale: 0.92).combined(with: .opacity), removal: .opacity))
                    .zIndex(20)
                }
            }
            .animation(.spring(response: 0.28, dampingFraction: 0.9), value: activeMemoColorWheelTarget != nil)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("iPadモード（問題演習）")
                    .font(.headline)
                    .foregroundColor(AppPalette.dark)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(viewModel.progressText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(AppPalette.dark)
                    .lineLimit(1)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    headerBadge(
                        text: viewModel.isReviewMode
                            ? "レビュー専用モード"
                            : "Mode: \(viewModel.modeLabel) / Count: \(viewModel.countLabel)"
                    )
                    headerBadge(text: "端末: \(viewModel.iPadProfile.displayName)")
                    headerBadge(text: historySummaryText)
                    headerBadge(text: "インストールから\(viewModel.installedElapsedDays)日")
                    headerBadge(text: "処理: \(viewModel.processingStatusText)")
                    networkBadge
                }
                .padding(.vertical, 1)
            }
        }
    }

    private var historySummaryText: String {
        guard !viewModel.isReviewMode,
              let question = viewModel.currentQuestion,
              let stat = viewModel.historyStats[question.id],
              stat.total > 0 else {
            return "初挑戦"
        }
        let correctRate = Int((Double(stat.correct) / Double(stat.total)) * 100)
        return "直近\(stat.total)回 正答率\(correctRate)% (\(stat.correct)/\(stat.total))"
    }

    @ViewBuilder
    private var networkBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(viewModel.isNetworkAvailable ? AppPalette.success : AppPalette.caution)
                .frame(width: 8, height: 8)
            Text(viewModel.networkStatusText)
                .font(.caption2.weight(.semibold))
                .foregroundColor(viewModel.isNetworkAvailable ? AppPalette.success : AppPalette.caution)
                .lineLimit(1)
            if viewModel.pendingSyncCount > 0 {
                Text("未同期\(viewModel.pendingSyncCount)件")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(AppPalette.caution)
                    .lineLimit(1)
            }
            if viewModel.isSyncingPendingActions {
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(AppPalette.white)
        .clipShape(Capsule())
        .overlay(
            Capsule()
                .stroke((viewModel.isNetworkAvailable ? AppPalette.success : AppPalette.caution).opacity(0.35), lineWidth: 1)
        )
    }

    private func headerBadge(text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundColor(AppPalette.dark)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(AppPalette.white)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(AppPalette.light.opacity(0.7), lineWidth: 1)
            )
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
    private func questionBody(_ question: QuizQuestion, availableHeight: CGFloat) -> some View {
        let questionAreaHeight = mainQuestionAreaHeight(availableHeight: availableHeight)

        VStack(spacing: 12) {
            DisclosureGroup("問題文エリア", isExpanded: $isQuestionAreaExpanded) {
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
                        .frame(maxWidth: .infinity, minHeight: questionAreaHeight + viewModel.extraWriteAreaHeight, alignment: .top)
                        .background(AppPalette.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))
                    }
                    .frame(maxWidth: .infinity, minHeight: questionAreaHeight, maxHeight: questionAreaHeight)

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
                            .disabled(viewModel.isAdvancingQuestion)
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
                            Button(viewModel.isAdvancingQuestion ? "保存中..." : (viewModel.currentIndex + 1 < viewModel.questions.count ? "次の問題へ" : "完了")) {
                                isMemoEditorFocused = false
                                Task { await viewModel.nextQuestion() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(viewModel.isAdvancingQuestion)
                        }
                    }
                }
            }
            .tint(AppPalette.primaryNew)
            .padding()
            .background(AppPalette.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))

            if viewModel.isAnswered {
                DisclosureGroup("解説エリア", isExpanded: $isExplanationAreaExpanded) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(viewModel.isReviewMode ? "レビュー内容" : (viewModel.isCorrect ? "正解" : "不正解"))
                            .font(.headline)
                            .foregroundColor(viewModel.isReviewMode ? AppPalette.primaryNew : (viewModel.isCorrect ? AppPalette.success : AppPalette.danger))
                        ZStack(alignment: .topLeading) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(viewModel.explanationText.isEmpty ? "この問題の解説はありません。" : viewModel.explanationText)
                                    .font(.body)
                                    .foregroundColor(AppPalette.dark)
                                    .lineLimit(nil)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let memoImage = viewModel.customExplanationMemoImage {
                                    memoImageSection(title: "My Memo 解説補足", image: memoImage)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12)
                            .padding(.top, 10)
                            .padding(.bottom, 4)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                            QuizPencilOverlayView(
                                canvasView: $viewModel.explanationCanvasView,
                                toolPicker: $viewModel.explanationToolPicker,
                                isDrawMode: $viewModel.isExplanationDrawMode
                            )
                        }
                        .frame(maxWidth: .infinity, minHeight: 240, alignment: .topLeading)
                        .background(AppPalette.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))

                        HStack {
                            Toggle(isOn: $viewModel.isExplanationDrawMode) {
                                Text(viewModel.isExplanationDrawMode ? "解説手書きモード" : "解説閲覧モード")
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                    .foregroundColor(AppPalette.dark)
                            }
                            .toggleStyle(SwitchToggleStyle(tint: AppPalette.primaryNew))

                            Button("解説手書きクリア") {
                                viewModel.clearExplanationPencilLayer()
                            }
                            .buttonStyle(.bordered)

                            Spacer()

                            Button("問題編集") {
                                viewModel.openProblemEditor()
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
                .tint(AppPalette.primaryNew)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(AppPalette.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppPalette.light.opacity(0.5), lineWidth: 1))

                DisclosureGroup("My Memoエリア", isExpanded: $isMyMemoAreaExpanded) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("My Memo")
                            .font(.headline)
                            .foregroundColor(AppPalette.dark)
                        DisclosureGroup("My Memo", isExpanded: $isMyMemoSectionExpanded) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("テキスト入力")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundColor(AppPalette.dark)
                                HStack(spacing: 8) {
                                    Button("完了") {
                                        isMemoEditorFocused = false
                                    }
                                    .buttonStyle(.bordered)
                                    Button("内容クリア") {
                                        viewModel.customMemoText = ""
                                        isMemoEditorFocused = false
                                    }
                                    .buttonStyle(.bordered)
                                    Spacer()
                                }
                                MemoTextEditorView(
                                    text: $viewModel.customMemoText,
                                    isFocused: $isMemoEditorFocused,
                                    allowsStylusHandwriting: viewModel.iPadProfile == .airOrLarger
                                )
                                    .id(ScrollTarget.myMemoEditor)
                                    .frame(minHeight: 110)
                                    .padding(6)
                                    .background(AppPalette.white)
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
                                Text(viewModel.iPadProfile.memoInputHint)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .id(ScrollTarget.myMemoContent)
                            .padding(.top, 6)
                        }
                        .id(ScrollTarget.myMemo)
                        .tint(AppPalette.primaryNew)
                        DisclosureGroup("解説補足", isExpanded: $isExplanationMemoSectionExpanded) {
                            memoHandwritingEditor(
                                title: "解説補足手書き入力",
                                canvasView: $viewModel.explanationMemoCanvasView,
                                toolPicker: $viewModel.explanationMemoToolPicker,
                                isActive: isExplanationMemoSectionExpanded,
                                toolState: viewModel.explanationMemoTool,
                                extraHeight: viewModel.explanationMemoExtraHeight,
                                onSelectTool: { viewModel.setMemoToolKind($0, for: .explanation) },
                                onOpenColorWheel: { activeMemoColorWheelTarget = .explanation },
                                onExpandInputArea: { viewModel.expandMemoInputArea(for: .explanation) },
                                onShrinkInputArea: { viewModel.shrinkMemoInputArea(for: .explanation) },
                                onSave: viewModel.saveExplanationMemoDrawing,
                                onClearInput: viewModel.clearExplanationMemoInput,
                                onClearSaved: viewModel.clearExplanationMemoImage,
                                savedImage: viewModel.customExplanationMemoImage,
                                savedImageTitle: "保存済みの解説補足画像"
                            )
                            .id(ScrollTarget.explanationMemoContent)
                            .padding(.top, 6)
                        }
                        .id(ScrollTarget.explanationMemo)
                        .tint(AppPalette.primaryNew)
                        DisclosureGroup("問題補足", isExpanded: $isQuestionMemoSectionExpanded) {
                            memoHandwritingEditor(
                                title: "問題文補足手書き入力",
                                canvasView: $viewModel.questionMemoCanvasView,
                                toolPicker: $viewModel.questionMemoToolPicker,
                                isActive: isQuestionMemoSectionExpanded,
                                toolState: viewModel.questionMemoTool,
                                extraHeight: viewModel.questionMemoExtraHeight,
                                onSelectTool: { viewModel.setMemoToolKind($0, for: .question) },
                                onOpenColorWheel: { activeMemoColorWheelTarget = .question },
                                onExpandInputArea: { viewModel.expandMemoInputArea(for: .question) },
                                onShrinkInputArea: { viewModel.shrinkMemoInputArea(for: .question) },
                                onSave: viewModel.saveQuestionMemoDrawing,
                                onClearInput: viewModel.clearQuestionMemoInput,
                                onClearSaved: viewModel.clearQuestionMemoImage,
                                savedImage: viewModel.customQuestionMemoImage,
                                savedImageTitle: "保存済みの問題文補足画像"
                            )
                            .id(ScrollTarget.questionMemoContent)
                            .padding(.top, 6)
                        }
                        .id(ScrollTarget.questionMemo)
                        .tint(AppPalette.primaryNew)
                    }
                }
                .tint(AppPalette.primaryNew)
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

    private func collapseMemoSections() {
        isMyMemoSectionExpanded = false
        isExplanationMemoSectionExpanded = false
        isQuestionMemoSectionExpanded = false
    }

    private func memoToolState(for target: QuizPencilModeViewModel.MemoCanvasTarget) -> QuizPencilModeViewModel.MemoToolState {
        switch target {
        case .explanation:
            return viewModel.explanationMemoTool
        case .question:
            return viewModel.questionMemoTool
        }
    }

    private func mainQuestionAreaHeight(availableHeight: CGFloat) -> CGFloat {
        switch viewModel.iPadProfile {
        case .mini:
            return max(560, availableHeight - 170)
        case .airOrLarger:
            return max(640, availableHeight - 220)
        }
    }

    private func scrollToSection(_ target: ScrollTarget, with proxy: ScrollViewProxy) {
        let contentTarget: ScrollTarget
        switch target {
        case .myMemo:
            contentTarget = .myMemoContent
        case .explanationMemo:
            contentTarget = .explanationMemoContent
        case .questionMemo:
            contentTarget = .questionMemoContent
        default:
            contentTarget = target
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            withAnimation(.easeInOut(duration: 0.25)) {
                proxy.scrollTo(contentTarget, anchor: .top)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            withAnimation(.easeInOut(duration: 0.25)) {
                proxy.scrollTo(contentTarget, anchor: .top)
            }
        }
    }

    private func scrollToMemoEditor(with proxy: ScrollViewProxy) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            withAnimation(.easeInOut(duration: 0.25)) {
                proxy.scrollTo(ScrollTarget.myMemoEditor, anchor: .center)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            withAnimation(.easeInOut(duration: 0.25)) {
                proxy.scrollTo(ScrollTarget.myMemoEditor, anchor: .center)
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
        toolPicker: Binding<PKToolPicker>,
        isActive: Bool,
        toolState: QuizPencilModeViewModel.MemoToolState,
        extraHeight: CGFloat,
        onSelectTool: @escaping (QuizPencilModeViewModel.MemoToolKind) -> Void,
        onOpenColorWheel: @escaping () -> Void,
        onExpandInputArea: @escaping () -> Void,
        onShrinkInputArea: @escaping () -> Void,
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
                Button("入力エリア+") {
                    onExpandInputArea()
                }
                .buttonStyle(.bordered)
                Button("入力エリア-") {
                    onShrinkInputArea()
                }
                .buttonStyle(.bordered)
                .disabled(extraHeight <= 0)
            }
            HStack(spacing: 8) {
                ForEach(QuizPencilModeViewModel.MemoToolKind.allCases) { kind in
                    Button(kind.label) {
                        onSelectTool(kind)
                    }
                    .buttonStyle(.bordered)
                    .tint(toolState.kind == kind ? AppPalette.primaryNew : AppPalette.light)
                }
                Spacer()
                Button {
                    onOpenColorWheel()
                } label: {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(toolState.color.color)
                            .frame(width: 22, height: 22)
                            .overlay(
                                Circle()
                                    .stroke(AppPalette.primaryNew, lineWidth: 2)
                            )
                        Text("色変更")
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(AppPalette.white)
                    .clipShape(Capsule())
                    .overlay(
                        Capsule()
                            .stroke(AppPalette.light.opacity(0.7), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }
            Text("鉛筆・ペン・マーカー・消しゴムを切り替え、色変更は円形ホイールから行えます。画像保存の動きはそのままです。")
                .font(.caption)
                .foregroundColor(.secondary)
            MemoCanvasInputView(
                canvasView: canvasView,
                toolPicker: toolPicker,
                isActive: isActive
            )
                .frame(minHeight: 810 + extraHeight)
                .background(AppPalette.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
            if let savedImage {
                memoImageSection(title: savedImageTitle, image: savedImage)
            }
        }
    }
}

struct MemoColorWheelOverlay: View {
    let title: String
    let selectedColor: QuizPencilModeViewModel.MemoInkColor
    let selectedTool: QuizPencilModeViewModel.MemoToolKind
    let rotationDegrees: Double
    let recentColors: [QuizPencilModeViewModel.MemoInkColor]
    let onSelectColor: (QuizPencilModeViewModel.MemoInkColor) -> Void
    let onSelectTool: (QuizPencilModeViewModel.MemoToolKind) -> Void
    let onRotate: (Double) -> Void
    let onClose: () -> Void

    @State private var workingRotation: Double
    @State private var lastDragAngle: Double?

    init(
        title: String,
        selectedColor: QuizPencilModeViewModel.MemoInkColor,
        selectedTool: QuizPencilModeViewModel.MemoToolKind,
        rotationDegrees: Double,
        recentColors: [QuizPencilModeViewModel.MemoInkColor],
        onSelectColor: @escaping (QuizPencilModeViewModel.MemoInkColor) -> Void,
        onSelectTool: @escaping (QuizPencilModeViewModel.MemoToolKind) -> Void,
        onRotate: @escaping (Double) -> Void,
        onClose: @escaping () -> Void
    ) {
        self.title = title
        self.selectedColor = selectedColor
        self.selectedTool = selectedTool
        self.rotationDegrees = rotationDegrees
        self.recentColors = recentColors
        self.onSelectColor = onSelectColor
        self.onSelectTool = onSelectTool
        self.onRotate = onRotate
        self.onClose = onClose
        _workingRotation = State(initialValue: rotationDegrees)
    }

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let wheelSize = min(width * 0.30, 180.0)
            let panelWidth = width
            let panelHeight = proxy.size.height
            let pivot = CGPoint(x: wheelSize * 0.98, y: wheelSize * 1.14)

            ZStack(alignment: .topLeading) {
                fanBackground(width: panelWidth - wheelSize * 0.58, height: panelHeight - 28)
                    .offset(x: wheelSize * 0.52, y: 12)

                topBar
                    .padding(.leading, wheelSize + 8)
                    .padding(.top, 16)

                fanPalette(
                    size: CGSize(width: panelWidth, height: panelHeight),
                    pivot: pivot,
                    wheelSize: wheelSize
                )

                toolWheel(size: wheelSize)
                    .offset(x: 10, y: 50)

                recentColorsBar
                    .padding(.leading, wheelSize + 12)
                    .padding(.bottom, 16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { value in
                        handleRotationChanged(location: value.location, pivot: pivot)
                    }
                    .onEnded { _ in
                        handleRotationEnded()
                    }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var groupedFamilies: [[QuizPencilModeViewModel.MemoInkColor]] {
        let families = ["R", "YR", "Y", "YG", "G", "BG", "B", "BV", "RV"]
        return families.map { family in
            QuizPencilModeViewModel.MemoInkColor.palette
                .filter { $0.familyCode == family }
                .sorted { lhs, rhs in
                    if lhs.ring == rhs.ring { return lhs.slot < rhs.slot }
                    return lhs.ring > rhs.ring
                }
        }
    }

    private let fanAngleOffset: Double = -10

    private var fanConfigs: [(angle: Double, radius: CGFloat, spread: CGFloat)] {
        [
            (-92 + fanAngleOffset, 0.32, 1.00),
            (-74 + fanAngleOffset, 0.38, 1.02),
            (-56 + fanAngleOffset, 0.45, 1.03),
            (-37 + fanAngleOffset, 0.53, 1.04),
            (-18 + fanAngleOffset, 0.61, 1.05),
            (1 + fanAngleOffset, 0.58, 1.04),
            (20 + fanAngleOffset, 0.51, 1.03),
            (39 + fanAngleOffset, 0.44, 1.02),
            (58 + fanAngleOffset, 0.37, 1.00),
        ]
    }

    private var grayFamily: [QuizPencilModeViewModel.MemoInkColor] {
        QuizPencilModeViewModel.MemoInkColor.palette.filter { $0.familyCode == "GRAY" }
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundColor(AppPalette.dark.opacity(0.82))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.white.opacity(0.82))
                .clipShape(Capsule())
            paletteModeChip(label: "COPIC", isActive: true)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundColor(AppPalette.dark)
                    .frame(width: 30, height: 30)
                    .background(Color.white.opacity(0.88))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private func toolWheel(size: CGFloat) -> some View {
        ZStack {
            Circle()
                .fill(Color.clear)
                .frame(width: size, height: size)
                .overlay(Circle().stroke(Color.clear, lineWidth: 0))

            ForEach(Array(QuizPencilModeViewModel.MemoToolKind.allCases.enumerated()), id: \.offset) { index, kind in
                let angle = Angle.degrees(-105 + Double(index) * 70)
                let radius = size * 0.34
                let point = point(on: radius, angle: angle, center: CGPoint(x: size / 2, y: size / 2))
                Button {
                    onSelectTool(kind)
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: kind.symbolName)
                            .font(.system(size: 13, weight: .semibold))
                        Text(kind.label)
                            .font(.system(size: 9, weight: .bold))
                    }
                    .foregroundColor(selectedTool == kind ? .white : AppPalette.dark)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(selectedTool == kind ? AppPalette.primaryNew : Color.white.opacity(0.9)))
                    .overlay(Circle().stroke(Color.white.opacity(selectedTool == kind ? 0 : 0.75), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .position(point)
            }

        }
    }

    private func handleRotationChanged(location: CGPoint, pivot: CGPoint) {
        let currentAngle = angleDegrees(from: location, center: pivot)
        if let previousAngle = lastDragAngle {
            let delta = shortestAngleDelta(from: previousAngle, to: currentAngle)
            let nextRotation = workingRotation + (delta * 1.7)
            workingRotation = nextRotation
            onRotate(nextRotation)
        } else {
            lastDragAngle = currentAngle
        }
        lastDragAngle = currentAngle
    }

    private func handleRotationEnded() {
        lastDragAngle = nil
    }

    private func shortestAngleDelta(from previous: Double, to current: Double) -> Double {
        var delta = current - previous
        while delta > 180 {
            delta -= 360
        }
        while delta < -180 {
            delta += 360
        }
        return delta
    }

    private func fanPalette(size: CGSize, pivot: CGPoint, wheelSize: CGFloat) -> some View {
        let tileSize = max(24, min(32, size.width * 0.048))
        let baseLength = tileSize * 7.6
        let sharedRotation = workingRotation / 7.5
        return ZStack(alignment: .topLeading) {
            ForEach(Array(groupedFamilies.enumerated()), id: \.offset) { index, family in
                let config = fanConfigs[index]
                let angle = config.angle + sharedRotation
                let start = point(on: wheelSize * (1.34 + config.radius), angle: .degrees(angle), center: pivot)
                paletteStrip(colors: family, cellSize: tileSize, familyCode: family.first?.familyCode)
                    .frame(width: tileSize, height: baseLength * config.spread, alignment: .top)
                    .rotationEffect(.degrees(angle), anchor: .topLeading)
                    .position(x: start.x, y: start.y)
            }

            let grayAngle = -30 + (workingRotation / 9.0)
            let grayStart = point(on: wheelSize * 1.10, angle: .degrees(grayAngle), center: pivot)
            paletteStrip(colors: grayFamily, cellSize: tileSize, familyCode: "GRAY", textColor: .white.opacity(0.92))
                .frame(width: tileSize, height: baseLength * 0.92, alignment: .top)
                .rotationEffect(.degrees(grayAngle), anchor: .topLeading)
                .position(x: grayStart.x, y: grayStart.y)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .compositingGroup()
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .white, location: 0.0),
                    .init(color: .white, location: 0.58),
                    .init(color: .white.opacity(0.76), location: 0.80),
                    .init(color: .clear, location: 1.0),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .clipped()
    }

    private func paletteStrip(
        colors: [QuizPencilModeViewModel.MemoInkColor],
        cellSize: CGFloat,
        familyCode: String?,
        textColor: Color = AppPalette.dark
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let familyCode {
                Text(familyCode)
                    .font(.system(size: 8, weight: .black))
                    .foregroundColor(AppPalette.dark.opacity(0.72))
                    .padding(.leading, 4)
                    .padding(.bottom, 2)
            }
            VStack(spacing: 0) {
                ForEach(Array(colors.enumerated()), id: \.element.id) { idx, color in
                    Button {
                        onSelectColor(color)
                    } label: {
                        ZStack(alignment: .topLeading) {
                            Rectangle()
                                .fill(color.color)
                            Text(color.code)
                                .font(.system(size: idx < 2 ? 8 : 7, weight: .bold))
                                .foregroundColor(textColor.opacity(color == selectedColor ? 1 : 0.84))
                                .padding(.top, 4)
                                .padding(.leading, 4)
                            if idx == 0 || idx == colors.count - 1 || color == selectedColor {
                                Text(color.familyCode)
                                    .font(.system(size: 6, weight: .black))
                                    .foregroundColor(textColor.opacity(0.7))
                                    .padding(.trailing, 3)
                                    .padding(.bottom, 3)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            }
                        }
                        .frame(width: cellSize, height: cellSize)
                        .overlay(
                            Rectangle()
                                .stroke(color == selectedColor ? Color.white : Color.black.opacity(0.08), lineWidth: color == selectedColor ? 2 : 0.5)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 2))
        .shadow(color: .black.opacity(0.14), radius: 4, y: 2)
        .rotationEffect(.degrees(-90))
    }

    private var infoStrip: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(selectedColor.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(AppPalette.dark)
                Text("\(selectedColor.code) / \(selectedColor.familyCode)")
                    .font(.caption.weight(.bold))
                    .foregroundColor(AppPalette.primaryNew)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("最近使った色")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                HStack(spacing: 8) {
                    ForEach(recentColors.prefix(6)) { color in
                        Button {
                            onSelectColor(color)
                        } label: {
                            Circle()
                                .fill(color.color)
                                .frame(width: 24, height: 24)
                                .overlay(
                                    Circle()
                                        .stroke(color == selectedColor ? AppPalette.primaryNew : Color.white.opacity(0.8), lineWidth: color == selectedColor ? 2.5 : 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Spacer()
        }
    }

    private var recentColorsBar: some View {
        HStack(spacing: 8) {
            Text("最近色")
                .font(.caption.weight(.semibold))
                .foregroundColor(.secondary)
            ForEach(recentColors.prefix(6)) { color in
                Button {
                    onSelectColor(color)
                } label: {
                    Circle()
                        .fill(color.color)
                        .frame(width: 24, height: 24)
                        .overlay(
                            Circle()
                                .stroke(color == selectedColor ? AppPalette.primaryNew : Color.white.opacity(0.82), lineWidth: color == selectedColor ? 2.5 : 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.76))
        .clipShape(Capsule())
    }

    private func fanBackground(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 34, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.34),
                        Color.white.opacity(0.12)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: width, height: height)
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .white, location: 0.0),
                    .init(color: .white, location: 0.68),
                    .init(color: .white.opacity(0.4), location: 0.88),
                    .init(color: .clear, location: 1.0),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.48),
                            Color.white.opacity(0.18),
                            .clear
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: .black.opacity(0.12), radius: 18, y: 8)
    }

    private func paletteModeChip(label: String, isActive: Bool) -> some View {
        Text(label)
            .font(.caption.weight(.bold))
            .foregroundColor(isActive ? .white : AppPalette.dark.opacity(0.72))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isActive ? AppPalette.primaryNew : Color.white.opacity(0.72))
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(isActive ? 0 : 0.6), lineWidth: 1)
            )
    }

    private func paletteUtilityChip(symbol: String, label: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.caption.weight(.semibold))
            Text(label)
                .font(.caption.weight(.semibold))
        }
        .foregroundColor(AppPalette.dark.opacity(0.72))
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color.white.opacity(0.7))
        .clipShape(Capsule())
        .overlay(
            Capsule()
                .stroke(Color.white.opacity(0.55), lineWidth: 1)
        )
    }

    private func point(on radius: CGFloat, angle: Angle, center: CGPoint) -> CGPoint {
        CGPoint(
            x: center.x + CGFloat(cos(angle.radians)) * radius,
            y: center.y + CGFloat(sin(angle.radians)) * radius
        )
    }

    private func angleDegrees(from location: CGPoint, center: CGPoint) -> Double {
        atan2(location.y - center.y, location.x - center.x) * 180 / .pi
    }

    private func normalizedAngle(_ angle: Double) -> Double {
        let remainder = angle.truncatingRemainder(dividingBy: 360)
        return remainder >= 0 ? remainder : remainder + 360
    }
}

struct ArcShape: Shape {
    let startAngle: Angle
    let endAngle: Angle

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let radius = min(rect.width, rect.height) / 2
        let center = CGPoint(x: rect.midX, y: rect.midY)
        path.addArc(
            center: center,
            radius: radius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: false
        )
        return path
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
