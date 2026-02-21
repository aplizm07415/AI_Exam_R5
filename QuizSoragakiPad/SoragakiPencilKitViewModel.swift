import Foundation
import UIKit
import PencilKit
import Combine

@MainActor
final class SoragakiPencilKitViewModel: ObservableObject {
    @Published var date: String = ""
    @Published var pages: [Int] = [1]
    @Published var currentPage: Int = 1
    @Published var baseImage: UIImage?
    @Published var canvasView = PKCanvasView()
    @Published var toolPicker = PKToolPicker()
    @Published var isAuthenticated: Bool = false
    @Published var loginToken: String = ""
    @Published var isLoading: Bool = false
    @Published var message: String?
    @Published var records: [SoragakiRecordSummary] = []
    @Published var selectedRecordID: String?
    @Published var isViewingSavedRecord: Bool = false
    @Published var memos: String = ""
    @Published var keywords: [String] = []
    @Published var isMemoLoading: Bool = false

    private var apiClient: SoragakiAPIClient?
    private let canvasSize = CGSize(width: 2048, height: 1536)
    private var draftPages: [Int] = [1]
    private var draftCurrentPage: Int = 1
    private var draftImages: [Int: UIImage?] = [1: nil]
    private var recordPages: [Int] = []

    func configure(with deepLink: SoragakiDeepLink) async {
        date = deepLink.date
        apiClient = SoragakiAPIClient(baseURL: deepLink.baseURL)
        isAuthenticated = await apiClient?.checkSession() ?? false
        if isAuthenticated {
            await loadRecords()
            restoreDraftIfNoRecords()
        }
    }

    func login() async {
        guard let apiClient, !loginToken.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            try await apiClient.login(accessToken: loginToken)
            isAuthenticated = true
            loginToken = ""
            await loadRecords()
            restoreDraftIfNoRecords()
        } catch {
            message = error.localizedDescription
        }
    }

    func loadRecords() async {
        guard let apiClient else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            records = try await apiClient.listRecords()
            if let first = records.first {
                try await selectSavedRecord(first.record_id)
            }
        } catch {
            message = error.localizedDescription
        }
    }

    func selectSavedRecord(_ recordID: String) async throws {
        guard let apiClient else { return }
        selectedRecordID = recordID
        isViewingSavedRecord = true
        recordPages = try await apiClient.listRecordPages(recordID: recordID)
        pages = recordPages
        currentPage = recordPages.first ?? 1
        try await loadCurrentSavedRecordPage()
    }

    func switchToDraftMode() {
        snapshotCurrentDraftPage()
        isViewingSavedRecord = false
        selectedRecordID = nil
        pages = draftPages
        currentPage = draftCurrentPage
        baseImage = draftImages[draftCurrentPage] ?? nil
        canvasView.drawing = PKDrawing()
    }

    func selectPage(_ page: Int) async {
        if isViewingSavedRecord {
            currentPage = page
            do {
                try await loadCurrentSavedRecordPage()
            } catch {
                message = error.localizedDescription
            }
            return
        }

        snapshotCurrentDraftPage()
        draftCurrentPage = page
        currentPage = page
        baseImage = draftImages[page] ?? nil
        canvasView.drawing = PKDrawing()
    }

    func addPage() {
        guard !isViewingSavedRecord else { return }
        snapshotCurrentDraftPage()
        let next = (draftPages.max() ?? 0) + 1
        draftPages.append(next)
        draftPages.sort()
        draftImages[next] = nil
        draftCurrentPage = next
        pages = draftPages
        currentPage = next
        baseImage = nil
        canvasView.drawing = PKDrawing()
    }

    func deleteCurrentPage() {
        guard !isViewingSavedRecord else { return }
        if draftPages.count == 1 {
            clearCurrentPage()
            return
        }
        draftPages.removeAll { $0 == draftCurrentPage }
        draftImages[draftCurrentPage] = nil
        draftCurrentPage = draftPages.first ?? 1
        pages = draftPages
        currentPage = draftCurrentPage
        baseImage = draftImages[draftCurrentPage] ?? nil
        canvasView.drawing = PKDrawing()
    }

    func clearCurrentPage() {
        guard !isViewingSavedRecord else { return }
        draftImages[draftCurrentPage] = nil
        baseImage = nil
        canvasView.drawing = PKDrawing()
    }

    func saveCurrentPage() async {
        guard let apiClient else { return }
        guard !isViewingSavedRecord else {
            message = "保存済みデータは参照のみです。"
            return
        }
        snapshotCurrentDraftPage()

        isLoading = true
        defer { isLoading = false }
        do {
            var payload: [(Int, Data)] = []
            for page in draftPages.sorted() {
                let image = (draftImages[page] ?? nil) ?? blankImage()
                guard let pngData = image.pngData() else {
                    throw APIError.invalidResponse
                }
                payload.append((page, pngData))
            }
            _ = try await apiClient.createRecord(learningDate: date, pages: payload)
            message = "保存しました。"
            resetDraft()
            await loadRecords()
        } catch {
            message = error.localizedDescription
        }
    }

    func fetchMemosAndKeywords() async {
        guard let apiClient else { return }
        isMemoLoading = true
        defer { isMemoLoading = false }
        do {
            let memoText = try await apiClient.getMemos(date: date)
            memos = memoText
            if memoText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                keywords = ["この日のMy Memoはありませんでした"]
                return
            }
            keywords = try await apiClient.generateKeywords(memoText: memoText)
        } catch {
            message = error.localizedDescription
        }
    }

    private func loadCurrentSavedRecordPage() async throws {
        guard let apiClient, let recordID = selectedRecordID else { return }
        baseImage = try await apiClient.getRecordPageImage(recordID: recordID, page: currentPage)
        canvasView.drawing = PKDrawing()
    }

    private func restoreDraftIfNoRecords() {
        if records.isEmpty {
            switchToDraftMode()
        }
    }

    private func resetDraft() {
        draftPages = [1]
        draftCurrentPage = 1
        draftImages = [1: nil]
        if !isViewingSavedRecord {
            pages = draftPages
            currentPage = draftCurrentPage
            baseImage = nil
            canvasView.drawing = PKDrawing()
        }
    }

    private func snapshotCurrentDraftPage() {
        guard !isViewingSavedRecord else { return }
        let merged = mergeCurrentCanvas()
        draftImages[draftCurrentPage] = merged
        baseImage = merged
        canvasView.drawing = PKDrawing()
    }

    private func blankImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: canvasSize)
        return renderer.image { _ in
            UIColor.white.setFill()
            UIBezierPath(rect: CGRect(origin: .zero, size: canvasSize)).fill()
        }
    }

    private func mergeCurrentCanvas() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: canvasSize)
        return renderer.image { _ in
            UIColor.white.setFill()
            UIBezierPath(rect: CGRect(origin: .zero, size: canvasSize)).fill()
            baseImage?.draw(in: CGRect(origin: .zero, size: canvasSize))
            let strokeImage = canvasView.drawing.image(from: CGRect(origin: .zero, size: canvasSize), scale: 1.0)
            strokeImage.draw(in: CGRect(origin: .zero, size: canvasSize))
        }
    }
}
