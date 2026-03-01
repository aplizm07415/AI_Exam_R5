import SwiftUI
import PencilKit
import Combine

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

    enum InteractionMode {
        case select
        case draw
    }

    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var completionMessage: String?
    @Published var questions: [QuizQuestion] = []
    @Published var currentIndex: Int = 0
    @Published var selectedAnswer: String?
    @Published var isAnswered: Bool = false
    @Published var isCorrect: Bool = false
    @Published var modeLabel: String = ""
    @Published var countLabel: String = ""
    @Published var canvasView = PKCanvasView()
    @Published var toolPicker = PKToolPicker()
    @Published var interactionMode: InteractionMode = .draw
    @Published var extraWriteAreaHeight: CGFloat = 0
    @Published var customMemoText: String = ""
    @Published var customMemoImageDataURL: String?
    @Published var historyStats: [String: QuizHistoryStat] = [:]
    @Published var isProblemEditSheetPresented: Bool = false
    @Published var problemEditDraft: ProblemEditDraft?
    @Published var questionStartedAt: Date = Date()

    private var apiClient: SoragakiAPIClient?
    private var deepLink: QuizDeepLink?
    private var originalMemoText: String = ""
    private var originalMemoImageDataURL: String?

    var currentQuestion: QuizQuestion? {
        guard questions.indices.contains(currentIndex) else { return nil }
        return questions[currentIndex]
    }

    var progressText: String {
        guard !questions.isEmpty else { return "0 / 0" }
        return "\(currentIndex + 1) / \(questions.count)"
    }

    var explanationText: String {
        guard isAnswered else { return "" }
        return currentQuestion?.explanation.text ?? ""
    }

    var isDrawMode: Bool {
        interactionMode == .draw
    }

    func configure(with deepLink: QuizDeepLink) async {
        self.deepLink = deepLink
        apiClient = SoragakiAPIClient(baseURL: deepLink.baseURL)
        modeLabel = deepLink.mode
        countLabel = "\(deepLink.count)"
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .pencilOnly
        canvasView.alwaysBounceVertical = false
        canvasView.alwaysBounceHorizontal = false
        await startQuiz()
    }

    func startQuiz() async {
        guard let apiClient, let deepLink else { return }
        completionMessage = nil
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func choose(_ answer: String) {
        guard !isAnswered else { return }
        selectedAnswer = answer
    }

    func submitAnswer() async {
        guard let answer = selectedAnswer, let question = currentQuestion, !isAnswered else { return }
        let answerIsCorrect = (answer == question.answer)
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func submitAsUnknown() async {
        guard let question = currentQuestion, !isAnswered else { return }
        let submittedAnswer = selectedAnswer ?? ""
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func nextQuestion() async {
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
        } else {
            errorMessage = nil
            completionMessage = "保存済み・演習完了"
        }
    }

    func saveCustomMemoIfNeeded() async throws {
        guard let apiClient, let question = currentQuestion else { return }
        let newText = customMemoText.trimmingCharacters(in: .whitespacesAndNewlines)
        let oldText = originalMemoText.trimmingCharacters(in: .whitespacesAndNewlines)
        let newImageDataURL = normalizedMemoImageDataURL(customMemoImageDataURL)
        let oldImageDataURL = normalizedMemoImageDataURL(originalMemoImageDataURL)
        if newText == oldText, newImageDataURL == oldImageDataURL { return }
        try await apiClient.saveCustomExplanation(
            problemID: question.id,
            text: customMemoText,
            imageDataURL: newImageDataURL
        )
        originalMemoText = customMemoText
        originalMemoImageDataURL = newImageDataURL
        if questions.indices.contains(currentIndex) {
            questions[currentIndex].customExplanation = customMemoText
            questions[currentIndex].customExplanationImageDataURL = newImageDataURL
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

    func saveCurrentDrawingToMemoImage() {
        guard let imageDataURL = snapshotCurrentDrawingDataURL() else {
            errorMessage = "保存する手書きがありません。"
            return
        }
        errorMessage = nil
        customMemoImageDataURL = imageDataURL
    }

    func clearCustomMemoImage() {
        customMemoImageDataURL = nil
    }

    func setInteractionMode(_ mode: InteractionMode) {
        interactionMode = mode
    }

    func expandWriteArea() {
        extraWriteAreaHeight = min(extraWriteAreaHeight + 160, 1200)
    }

    func shrinkWriteArea() {
        extraWriteAreaHeight = max(extraWriteAreaHeight - 160, 0)
    }

    private func resetQuestionState() {
        completionMessage = nil
        selectedAnswer = nil
        isAnswered = false
        isCorrect = false
        questionStartedAt = Date()
        interactionMode = .draw
        extraWriteAreaHeight = 0
        clearPencilLayer()
        if let question = currentQuestion {
            customMemoText = question.customExplanation ?? ""
            originalMemoText = customMemoText
            customMemoImageDataURL = normalizedMemoImageDataURL(question.customExplanationImageDataURL)
            originalMemoImageDataURL = customMemoImageDataURL
        } else {
            customMemoText = ""
            originalMemoText = ""
            customMemoImageDataURL = nil
            originalMemoImageDataURL = nil
        }
    }

    private func fetchHistoryStats() async {
        guard let apiClient, let deepLink else { return }
        do {
            let ids = questions.map { $0.id }
            historyStats = try await apiClient.getBulkHistoryStats(problemIDs: ids, subjects: deepLink.subjects)
        } catch {
            historyStats = [:]
        }
    }

    func remainingTimeRatio(at date: Date) -> CGFloat {
        let elapsed = max(0, date.timeIntervalSince(questionStartedAt))
        let ratio = max(0, min(1, 1 - (elapsed / Self.questionTimerDuration)))
        return CGFloat(ratio)
    }

    var customMemoImage: UIImage? {
        Self.image(fromDataURL: customMemoImageDataURL)
    }

    private func normalizedMemoImageDataURL(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func snapshotCurrentDrawingDataURL() -> String? {
        guard !canvasView.drawing.strokes.isEmpty else { return nil }
        let size = canvasView.bounds.size
        guard size.width > 0, size.height > 0 else { return nil }
        let image = canvasView.drawing.image(from: CGRect(origin: .zero, size: size), scale: 1.0)
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
                } else if let question = viewModel.currentQuestion {
                    questionBody(question)
                } else {
                    Text(viewModel.errorMessage ?? "問題がありません。")
                        .foregroundColor(.secondary)
                        .padding()
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
                Text("Mode: \(viewModel.modeLabel) / Count: \(viewModel.countLabel)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                if let question = viewModel.currentQuestion,
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
            }
            Spacer()
            Text(viewModel.progressText)
                .font(.subheadline)
                .foregroundColor(AppPalette.dark)
        }
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
                            .disabled(viewModel.isAnswered || viewModel.isDrawMode)
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
                Button("余白+") {
                    viewModel.expandWriteArea()
                }
                .buttonStyle(.bordered)
                Button("余白-") {
                    viewModel.shrinkWriteArea()
                }
                .buttonStyle(.bordered)

                Spacer()

                if !viewModel.isAnswered {
                    HStack(spacing: 10) {
                        Button("解答する") {
                            Task { await viewModel.submitAnswer() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.selectedAnswer == nil)

                        Button("わからない") {
                            Task { await viewModel.submitAsUnknown() }
                        }
                        .buttonStyle(.bordered)
                        .tint(AppPalette.warning)
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
                    Text(viewModel.isCorrect ? "正解" : "不正解")
                        .font(.headline)
                        .foregroundColor(viewModel.isCorrect ? AppPalette.success : AppPalette.danger)
                    Text(viewModel.explanationText.isEmpty ? "この問題の解説はありません。" : viewModel.explanationText)
                        .font(.body)
                        .foregroundColor(AppPalette.dark)
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                    if let memoImage = viewModel.customMemoImage {
                        memoImageSection(title: "My Memo画像", image: memoImage)
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
                    HStack {
                        Text("My Memo")
                            .font(.headline)
                            .foregroundColor(AppPalette.dark)
                        Spacer()
                        Button("手書きを画像保存") {
                            viewModel.saveCurrentDrawingToMemoImage()
                        }
                        .buttonStyle(.bordered)
                        Button("画像クリア") {
                            viewModel.clearCustomMemoImage()
                        }
                        .buttonStyle(.bordered)
                        .disabled(viewModel.customMemoImage == nil)
                    }
                    TextEditor(text: $viewModel.customMemoText)
                        .focused($isMemoEditorFocused)
                        .frame(minHeight: 110)
                        .padding(6)
                        .background(AppPalette.white)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(AppPalette.light.opacity(0.6), lineWidth: 1))
                    if let memoImage = viewModel.customMemoImage {
                        memoImageSection(title: "保存済み画像", image: memoImage)
                    }
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
