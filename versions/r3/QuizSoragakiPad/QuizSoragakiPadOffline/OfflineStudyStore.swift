import Foundation
import SwiftUI
import Combine

@MainActor
final class OfflineStudyStore: ObservableObject {
    @Published private(set) var package: OfflineStudyPackage?
    @Published private(set) var pendingRecords: [OfflinePendingRecord] = []
    @Published private(set) var lastError: String?
    @Published private(set) var isBusy = false
    @Published private(set) var availableSubjects: [String] = []
    @Published var selectedSubjects: Set<String> = []
    @Published private(set) var transferStatus = OfflineTransferStatus()
    @Published private(set) var installedAt: Date
    @Published private(set) var lastDownloadedAt: Date?
    @Published private(set) var lastSyncedAt: Date?

    private let fileManager = FileManager.default
    private let packageFileName = "offline-study-package.json"
    private let pendingFileName = "offline-study-pending.json"
    private let stateFileName = "offline-study-state.json"
    private let auditLogFileName = "offline-study-audit-log.json"
    private let backupExtension = "bak"

    init() {
        installedAt = Date()
        loadFromDisk()
        if installedAt > Date() {
            installedAt = Date()
        }
        try? persistState()
    }

    var subjects: [OfflineSubject] { package?.subjects ?? [] }
    var hasDownloadedData: Bool { package != nil }
    var pendingCount: Int { pendingRecords.count }
    var hasLocalChangesOrData: Bool { hasDownloadedData || pendingCount > 0 }
    var changedProblemCount: Int { changedProblems.count }
    var reviewLaterCount: Int { package?.reviewLater.count ?? 0 }
    var invalidQuestionCount: Int { package?.invalidQuestions.count ?? 0 }
    var invalidQuestions: [OfflineInvalidQuestion] { package?.invalidQuestions ?? [] }
    var installedDays: Int {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: installedAt)
        let today = calendar.startOfDay(for: Date())
        return max((calendar.dateComponents([.day], from: start, to: today).day ?? 0) + 1, 1)
    }
    var practiceRecords: [OfflinePendingRecord] {
        pendingRecords.filter { $0.kind == .practice }
    }
    var practiceAccuracy: Double? {
        let records = practiceRecords.compactMap { record -> Bool? in
            record.isCorrect
        }
        guard !records.isEmpty else { return nil }
        let correctCount = records.filter { $0 }.count
        return Double(correctCount) / Double(records.count)
    }
    var changedProblems: [OfflineChangedProblemSummary] {
        let grouped = Dictionary(grouping: pendingRecords.filter { $0.kind != .practice }, by: { "\($0.subject)::\($0.problemID)" })
        return grouped.compactMap { problemID, records in
            guard let latest = records.max(by: { $0.practicedAt < $1.practicedAt }) else { return nil }
            let summaries = Array(Set(records.compactMap(\.summary))).sorted()
            let changedFields = Array(Set(records.flatMap(\.changedFields))).sorted()
            return OfflineChangedProblemSummary(
                id: problemID,
                subject: latest.subject,
                problemID: latest.problemID,
                category: latest.category,
                changedAt: latest.practicedAt,
                summaries: summaries,
                changedFields: changedFields
            )
        }
        .sorted { $0.changedAt > $1.changedAt }
    }
    var subjectsWithQuestions: [String] {
        subjects.filter { !$0.questions.isEmpty }.map(\.name)
    }

    func repairedQuestion(from invalidQuestion: OfflineInvalidQuestion, rawQuestionJSON: String) throws {
        guard var package else { return }
        let repaired = try Self.parseRepairedQuestion(
            subject: invalidQuestion.subject,
            problemID: invalidQuestion.problemID,
            rawQuestionJSON: rawQuestionJSON
        )

        if let subjectIndex = package.subjects.firstIndex(where: { $0.name == invalidQuestion.subject }) {
            if let questionIndex = package.subjects[subjectIndex].questions.firstIndex(where: { $0.id == repaired.id }) {
                package.subjects[subjectIndex].questions[questionIndex] = repaired
            } else {
                package.subjects[subjectIndex].questions.append(repaired)
                package.subjects[subjectIndex].questions.sort { $0.id < $1.id }
            }
        } else {
            package.subjects.append(OfflineSubject(name: invalidQuestion.subject, questions: [repaired]))
            package.subjects.sort { $0.name < $1.name }
        }

        package.invalidQuestions.removeAll { $0.subject == invalidQuestion.subject && $0.problemID == invalidQuestion.problemID }
        let record = OfflinePendingRecord(
            id: UUID().uuidString,
            kind: .problemRepair,
            subject: repaired.subject,
            problemID: repaired.id,
            practicedAt: Date(),
            category: repaired.category,
            summary: "JSON 修復を保存",
            changedFields: ["JSON修復"]
        )
        pendingRecords.insert(record, at: 0)
        self.package = package
        try persistAll()
    }

    func loadAvailableSubjects(baseURLText: String) async {
        await performBusyTask(kind: .downloading, initialMessage: "科目一覧を取得中...", initialProgress: 0.05) {
            let client = try OfflineStudyAPIClient(baseURLText: baseURLText)
            let subjectNames = try await client.fetchSubjects()
            availableSubjects = subjectNames
            if selectedSubjects.isEmpty {
                selectedSubjects = Set(subjectNames)
            } else {
                selectedSubjects = selectedSubjects.intersection(subjectNames)
            }
            lastError = nil
            try persistState()
            transferStatus = OfflineTransferStatus(kind: .idle, message: "科目一覧を更新しました。", progress: 1)
        }
    }

    func downloadPackage(baseURLText: String) async {
        let subjectNames = selectedSubjects.isEmpty ? availableSubjects : Array(selectedSubjects).sorted()
        guard !subjectNames.isEmpty else {
            lastError = "ダウンロード対象の科目を選択してください。"
            return
        }

        await performBusyTask(kind: .downloading, initialMessage: "データセットを取得中...", initialProgress: 0.05) {
            try appendAuditLog(kind: .downloadStarted, subjects: subjectNames, message: "科目ダウンロード開始")
            let client = try OfflineStudyAPIClient(baseURLText: baseURLText)
            transferStatus = OfflineTransferStatus(kind: .downloading, message: "問題・実績データをダウンロード中...", progress: 0.2)
            let downloaded = try await client.downloadPackage(subjects: subjectNames)
            transferStatus = OfflineTransferStatus(kind: .downloading, message: "関連画像を保存中...", progress: 0.55)
            try await cacheImages(for: downloaded, baseURL: client.baseURL)
            try removeStaleCachedImages(keeping: downloaded)
            package = downloaded
            pendingRecords.removeAll()
            lastDownloadedAt = Date()
            if downloaded.warnings.isEmpty {
                lastError = nil
            } else {
                lastError = "一部の科目は読み込めませんでした。\(downloaded.warnings.joined(separator: " / "))"
            }
            try persistAll()
            try appendAuditLog(kind: .downloadCompleted, subjects: subjectNames, message: "ダウンロード完了")
            transferStatus = OfflineTransferStatus(
                kind: .idle,
                message: downloaded.warnings.isEmpty ? "ダウンロード完了" : "一部科目をスキップしてダウンロード完了",
                progress: 1
            )
        }
    }

    func submitAnswer(questionID: String, selectedAnswer: String) {
        guard var package else { return }
        for subjectIndex in package.subjects.indices {
            guard let questionIndex = package.subjects[subjectIndex].questions.firstIndex(where: { $0.id == questionID }) else {
                continue
            }
            let question = package.subjects[subjectIndex].questions[questionIndex]
            let isCorrect = question.answer == selectedAnswer
            let record = OfflinePendingRecord(
                id: UUID().uuidString,
                kind: .practice,
                subject: question.subject,
                problemID: question.id,
                practicedAt: Date(),
                selectedAnswer: selectedAnswer,
                isCorrect: isCorrect,
                category: question.category,
                summary: isCorrect ? "正答を保存" : "誤答を保存"
            )
            pendingRecords.insert(record, at: 0)
            var histories = package.histories[question.subject] ?? []
            histories.append(
                OfflineHistoryItem(
                    problemID: question.id,
                    subject: question.subject,
                    selectedAnswer: selectedAnswer,
                    isCorrect: isCorrect,
                    answeredAt: ISO8601DateFormatter().string(from: record.practicedAt),
                    category: question.category
                )
            )
            package.histories[question.subject] = histories
            self.package = package
            try? persistAll()
            return
        }
    }

    func submitUnknown(questionID: String) {
        submitAnswer(questionID: questionID, selectedAnswer: "未回答")
    }

    func submitAnswer(questionID: String, subject: String, selectedAnswer: String, isCorrect: Bool, category: String?) {
        guard var package else { return }
        let record = OfflinePendingRecord(
            id: UUID().uuidString,
            kind: .practice,
            subject: subject,
            problemID: questionID,
            practicedAt: Date(),
            selectedAnswer: selectedAnswer,
            isCorrect: isCorrect,
            category: category,
            summary: isCorrect ? "正答を保存" : "誤答を保存"
        )
        pendingRecords.insert(record, at: 0)
        var histories = package.histories[subject] ?? []
        histories.append(
            OfflineHistoryItem(
                problemID: questionID,
                subject: subject,
                selectedAnswer: selectedAnswer,
                isCorrect: isCorrect,
                answeredAt: ISO8601DateFormatter().string(from: record.practicedAt),
                category: category
            )
        )
        package.histories[subject] = histories
        self.package = package
        try? persistAll()
    }

    func updateQuestion(
        _ updated: OfflineQuestion,
        reviewLater: Bool,
        changeKind: OfflinePendingRecord.RecordKind = .memo,
        summary: String? = nil,
        changedFields: [String] = []
    ) {
        guard var package else { return }
        for subjectIndex in package.subjects.indices {
            guard let questionIndex = package.subjects[subjectIndex].questions.firstIndex(where: { $0.id == updated.id }) else {
                continue
            }
            package.subjects[subjectIndex].questions[questionIndex] = updated
            let now = ISO8601DateFormatter().string(from: Date())
            package.reviewLater.removeAll { $0.subject == updated.subject && $0.problemID == updated.id }
            if reviewLater {
                package.reviewLater.append(
                    OfflineReviewLaterItem(
                        subject: updated.subject,
                        problemID: updated.id,
                        createdAt: now,
                        updatedAt: now
                    )
                )
            }
            let record = OfflinePendingRecord(
                id: UUID().uuidString,
                kind: changeKind,
                subject: updated.subject,
                problemID: updated.id,
                practicedAt: Date(),
                selectedAnswer: nil,
                isCorrect: nil,
                category: updated.category,
                summary: summary,
                changedFields: changedFields
            )
            pendingRecords.insert(record, at: 0)
            self.package = package
            try? persistAll()
            return
        }
    }

    func question(id: String) -> OfflineQuestion? {
        subjects.flatMap(\.questions).first(where: { $0.id == id })
    }

    func question(id: String, subject: String) -> OfflineQuestion? {
        self.subject(named: subject)?.questions.first(where: { $0.id == id })
    }

    func subject(named name: String) -> OfflineSubject? {
        subjects.first(where: { $0.name == name })
    }

    func quizQuestions(subjectNames: [String], mode: String, count: Int) -> [OfflineQuestion] {
        let subjectSet = Set(subjectNames)
        let allQuestions = subjects
            .filter { subjectSet.contains($0.name) }
            .flatMap(\.questions)
        guard !allQuestions.isEmpty else { return [] }

        let historiesByQuestionID: [String: [OfflineHistoryItem]] = Dictionary(
            uniqueKeysWithValues: allQuestions.map { question in
                let items = package?.histories[question.subject]?.filter { $0.problemID == question.id } ?? []
                return (question.id, items)
            }
        )

        let selected: [OfflineQuestion]
        switch mode {
        case "unanswered", "today_remaining":
            selected = allQuestions
                .filter { (historiesByQuestionID[$0.id] ?? []).isEmpty }
                .shuffled()
        case "weak_area":
            selected = allQuestions
                .sorted { lhs, rhs in
                    reviewPriority(for: lhs, histories: historiesByQuestionID[lhs.id] ?? []) >
                    reviewPriority(for: rhs, histories: historiesByQuestionID[rhs.id] ?? [])
                }
        default:
            selected = allQuestions.shuffled()
        }

        return Array(selected.prefix(max(1, count)))
    }

    func historyCount(for questionID: String, in subject: String) -> Int {
        package?.histories[subject]?.filter { $0.problemID == questionID }.count ?? 0
    }

    func correctCount(for questionID: String, in subject: String) -> Int {
        package?.histories[subject]?.filter { $0.problemID == questionID && $0.isCorrect }.count ?? 0
    }

    func isReviewLater(questionID: String, subject: String) -> Bool {
        package?.reviewLater.contains(where: { $0.subject == subject && $0.problemID == questionID }) ?? false
    }

    func saveCustomMemo(questionID: String, text: String, explanationImageDataURL: String?, questionImageDataURL: String?) {
        guard let question = question(id: questionID) else { return }
        var updated = question
        updated.customExplanation = text
        updated.customExplanationImageDataURL = explanationImageDataURL
        updated.customQuestionImageDataURL = questionImageDataURL

        var changedFields: [String] = []
        if (question.customExplanation ?? "") != text { changedFields.append("My Memo") }
        if question.customExplanationImageDataURL != explanationImageDataURL { changedFields.append("解説補足画像") }
        if question.customQuestionImageDataURL != questionImageDataURL { changedFields.append("問題補足画像") }

        updateQuestion(
            updated,
            reviewLater: isReviewLater(questionID: question.id, subject: question.subject),
            changeKind: .memo,
            summary: "My Memo を更新",
            changedFields: changedFields
        )
    }

    func setReviewLater(questionID: String, subject: String, enabled: Bool) {
        guard let question = question(id: questionID, subject: subject) else { return }
        updateQuestion(
            question,
            reviewLater: enabled,
            changeKind: .reviewLater,
            summary: enabled ? "後で確認を追加" : "後で確認を解除",
            changedFields: ["後で確認"]
        )
    }

    func imageURL(for path: String, baseURLText: String) -> URL? {
        if let local = try? imagesDirectory().appendingPathComponent(Self.cacheFileName(for: path)),
           fileManager.fileExists(atPath: local.path) {
            return local
        }
        guard let baseURL = URL(string: baseURLText) else { return nil }
        return URL(string: path, relativeTo: baseURL)
    }

    func sync(baseURLText: String) async {
        guard let package else { return }
        await performBusyTask(kind: .uploading, initialMessage: "同期準備中...", initialProgress: 0.05) {
            let subjectsToSync = package.subjects.map(\.name)
            try appendAuditLog(kind: .syncStarted, subjects: subjectsToSync, message: "blob 同期開始")
            let client = try OfflineStudyAPIClient(baseURLText: baseURLText)
            let changedQuestionKeys = Set(
                pendingRecords
                    .filter { $0.kind == .memo || $0.kind == .problemEdit || $0.kind == .problemRepair }
                    .map { "\($0.subject)::\($0.problemID)" }
            )
            let changedReviewLaterKeys = Set(
                pendingRecords
                    .filter { $0.kind == .reviewLater }
                    .map { "\($0.subject)::\($0.problemID)" }
            )
            let subjects = package.subjects.flatMap { subject in
                subject.questions.compactMap { question -> OfflineSyncQuestionPayload? in
                    guard changedQuestionKeys.contains("\(question.subject)::\(question.id)") else { return nil }
                    return OfflineSyncQuestionPayload(
                        id: question.id,
                        subject: question.subject,
                        questionText: question.questionText,
                        choices: question.choices,
                        answer: question.answer,
                        explanation: question.explanation,
                        category: question.category
                    )
                }
            }
            let customExplanations = package.subjects
                .flatMap(\.questions)
                .compactMap { question -> OfflineSyncCustomExplanationPayload? in
                    guard changedQuestionKeys.contains("\(question.subject)::\(question.id)") else { return nil }
                    return OfflineSyncCustomExplanationPayload(
                        problemID: question.id,
                        text: question.customExplanation ?? "",
                        explanationImageDataURL: question.customExplanationImageDataURL,
                        questionImageDataURL: question.customQuestionImageDataURL
                    )
                }
            let reviewLaterUpserts = package.reviewLater.filter { item in
                changedReviewLaterKeys.contains("\(item.subject)::\(item.problemID)")
            }
            let reviewLaterUpsertKeys = Set(reviewLaterUpserts.map { "\($0.subject)::\($0.problemID)" })
            let reviewLaterRemovals = changedReviewLaterKeys
                .subtracting(reviewLaterUpsertKeys)
                .compactMap { key -> OfflineReviewLaterProblemRef? in
                    let parts = key.split(separator: "::", maxSplits: 1).map(String.init)
                    guard parts.count == 2 else { return nil }
                    return OfflineReviewLaterProblemRef(subject: parts[0], problemID: parts[1])
                }
            let histories = Dictionary(grouping: practiceRecords, by: \.subject)
                .mapValues { records in
                    records.map {
                        OfflineHistoryItem(
                            problemID: $0.problemID,
                            subject: $0.subject,
                            selectedAnswer: $0.selectedAnswer ?? "未回答",
                            isCorrect: $0.isCorrect ?? false,
                            answeredAt: ISO8601DateFormatter().string(from: $0.practicedAt),
                            category: $0.category
                        )
                    }
                }
            let payload = OfflineSyncRequestPayload(
                subjects: subjects,
                customExplanations: customExplanations,
                reviewLaterUpserts: reviewLaterUpserts,
                reviewLaterRemovals: reviewLaterRemovals,
                histories: histories
            )
            transferStatus = OfflineTransferStatus(kind: .uploading, message: "blob へアップロード中...", progress: 0.45)
            try await client.sync(payload: payload)
            pendingRecords.removeAll()
            lastSyncedAt = Date()
            try clearAuditLogs()
            try persistAll()
            transferStatus = OfflineTransferStatus(kind: .idle, message: "アップロード完了", progress: 1)
        }
    }

    func clearAllLocalData() {
        do {
            let appSupport = try applicationSupportDirectory()
            if fileManager.fileExists(atPath: appSupport.path) {
                try fileManager.removeItem(at: appSupport)
            }
        } catch {
            lastError = error.localizedDescription
        }

        package = nil
        pendingRecords = []
        availableSubjects = []
        selectedSubjects = []
        lastDownloadedAt = nil
        lastSyncedAt = nil
        installedAt = Date()
        lastError = nil
        transferStatus = OfflineTransferStatus(kind: .idle, message: "端末データを削除しました。", progress: 0)
        try? persistState()
    }

    private func performBusyTask(
        kind: OfflineTransferKind,
        initialMessage: String,
        initialProgress: Double,
        _ operation: () async throws -> Void
    ) async {
        guard !isBusy else { return }
        isBusy = true
        lastError = nil
        transferStatus = OfflineTransferStatus(kind: kind, message: initialMessage, progress: initialProgress)
        defer { isBusy = false }
        do {
            try await operation()
        } catch {
            lastError = error.localizedDescription
            if kind == .downloading {
                try? appendAuditLog(kind: .downloadFailed, subjects: Array(selectedSubjects).sorted(), message: error.localizedDescription)
            } else if kind == .uploading {
                try? appendAuditLog(kind: .syncFailed, subjects: subjects.map(\.name), message: error.localizedDescription)
            }
            transferStatus = OfflineTransferStatus(kind: .idle, message: "失敗: \(error.localizedDescription)", progress: 0)
        }
    }

    private func cacheImages(for package: OfflineStudyPackage, baseURL: URL) async throws {
        let allPaths = Set(
            package.subjects
                .flatMap(\.questions)
                .flatMap { $0.imageURLs + $0.explanationImageURLs }
        )
        guard !allPaths.isEmpty else {
            transferStatus = OfflineTransferStatus(kind: .downloading, message: "画像はありません。", progress: 0.9)
            return
        }

        let imageDirectory = try imagesDirectory()
        try fileManager.createDirectory(at: imageDirectory, withIntermediateDirectories: true)
        let sortedPaths = allPaths.sorted()
        for (index, path) in sortedPaths.enumerated() {
            guard let url = URL(string: path, relativeTo: baseURL) else { continue }
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { continue }
            let fileURL = imageDirectory.appendingPathComponent(Self.cacheFileName(for: path))
            try writeDataWithBackup(data, to: fileURL)
            let ratio = Double(index + 1) / Double(sortedPaths.count)
            transferStatus = OfflineTransferStatus(
                kind: .downloading,
                message: "関連画像を保存中... \(index + 1)/\(sortedPaths.count)",
                progress: 0.55 + (ratio * 0.4)
            )
        }
    }

    private func removeStaleCachedImages(keeping package: OfflineStudyPackage) throws {
        let imageDirectory = try imagesDirectory()
        guard fileManager.fileExists(atPath: imageDirectory.path) else { return }
        let keepNames = Set(
            package.subjects
                .flatMap(\.questions)
                .flatMap { $0.imageURLs + $0.explanationImageURLs }
                .map(Self.cacheFileName(for:))
        )
        let urls = try fileManager.contentsOfDirectory(at: imageDirectory, includingPropertiesForKeys: nil)
        for url in urls where !keepNames.contains(url.lastPathComponent) {
            try? fileManager.removeItem(at: url)
        }
    }

    private func loadFromDisk() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        if let stateURL = try? stateURL(),
           let data = loadDataWithBackup(from: stateURL) {
            do {
                let decoded = try decoder.decode(OfflineStoreState.self, from: data)
                selectedSubjects = Set(decoded.selectedSubjects)
                availableSubjects = decoded.availableSubjects
                installedAt = decoded.installedAt ?? installedAt
                lastDownloadedAt = decoded.lastDownloadedAt
                lastSyncedAt = decoded.lastSyncedAt
            } catch {
                recoverFromCorruptedLocalFile(at: stateURL)
            }
        }

        if let packageURL = try? packageURL(),
           let data = loadDataWithBackup(from: packageURL) {
            do {
                package = try decoder.decode(OfflineStudyPackage.self, from: data)
            } catch {
                recoverFromCorruptedLocalFile(at: packageURL)
            }
        }

        if let pendingURL = try? pendingURL(),
           let data = loadDataWithBackup(from: pendingURL) {
            do {
                let decoded = try decoder.decode([OfflinePendingRecord].self, from: data)
                pendingRecords = decoded.sorted { $0.practicedAt > $1.practicedAt }
            } catch {
                recoverFromCorruptedLocalFile(at: pendingURL)
            }
        }
    }

    private func persistAll() throws {
        try persistPackage()
        try persistPendingRecords()
        try persistState()
    }

    private func persistPackage() throws {
        guard let package else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(package)
        try writeDataWithBackup(data, to: try packageURL())
    }

    private func persistPendingRecords() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(pendingRecords)
        try writeDataWithBackup(data, to: try pendingURL())
    }

    private func persistState() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let state = OfflineStoreState(
            selectedSubjects: Array(selectedSubjects).sorted(),
            availableSubjects: availableSubjects,
            installedAt: installedAt,
            lastDownloadedAt: lastDownloadedAt,
            lastSyncedAt: lastSyncedAt
        )
        let data = try encoder.encode(state)
        try writeDataWithBackup(data, to: try stateURL())
    }

    private func appendAuditLog(kind: OfflineAuditLogEntry.EventKind, subjects: [String], message: String) throws {
        var logs = try loadAuditLogs()
        logs.append(
            OfflineAuditLogEntry(
                id: UUID().uuidString,
                timestamp: Date(),
                kind: kind,
                subjects: subjects,
                message: message
            )
        )
        try persistAuditLogs(logs)
    }

    private func clearAuditLogs() throws {
        try persistAuditLogs([])
    }

    private func loadAuditLogs() throws -> [OfflineAuditLogEntry] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = loadDataWithBackup(from: try auditLogURL()) else { return [] }
        return (try? decoder.decode([OfflineAuditLogEntry].self, from: data)) ?? []
    }

    private func persistAuditLogs(_ logs: [OfflineAuditLogEntry]) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(logs)
        try writeDataWithBackup(data, to: try auditLogURL())
    }

    private func writeDataWithBackup(_ data: Data, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let backupURL = url.appendingPathExtension(backupExtension)
        if fileManager.fileExists(atPath: url.path) {
            if fileManager.fileExists(atPath: backupURL.path) {
                try? fileManager.removeItem(at: backupURL)
            }
            try fileManager.copyItem(at: url, to: backupURL)
        }
        try data.write(to: url, options: .atomic)
    }

    private func loadDataWithBackup(from url: URL) -> Data? {
        if let data = try? Data(contentsOf: url) {
            return data
        }
        let backupURL = url.appendingPathExtension(backupExtension)
        return try? Data(contentsOf: backupURL)
    }

    private func recoverFromCorruptedLocalFile(at url: URL) {
        try? fileManager.removeItem(at: url)
        let backupURL = url.appendingPathExtension(backupExtension)
        try? fileManager.removeItem(at: backupURL)
        lastError = "端末内の古いデータを読み込めなかったため、自動で初期化しました。"
    }

    private func applicationSupportDirectory() throws -> URL {
        try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("QuizSoragakiPadOffline", isDirectory: true)
    }

    private func packageURL() throws -> URL {
        try applicationSupportDirectory().appendingPathComponent(packageFileName)
    }

    private func pendingURL() throws -> URL {
        try applicationSupportDirectory().appendingPathComponent(pendingFileName)
    }

    private func stateURL() throws -> URL {
        try applicationSupportDirectory().appendingPathComponent(stateFileName)
    }

    private func auditLogURL() throws -> URL {
        try applicationSupportDirectory().appendingPathComponent(auditLogFileName)
    }

    private func imagesDirectory() throws -> URL {
        try applicationSupportDirectory().appendingPathComponent("images", isDirectory: true)
    }

    private static func cacheFileName(for path: String) -> String {
        let safe = path.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        return safe.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? UUID().uuidString
    }

    private func reviewPriority(for question: OfflineQuestion, histories: [OfflineHistoryItem]) -> Double {
        guard !histories.isEmpty else { return 10_000 }
        let total = Double(histories.count)
        let correct = Double(histories.filter(\.isCorrect).count)
        let correctRatePenalty = 1.0 - (correct / max(total, 1))
        let lastAnsweredAt = histories.compactMap { ISO8601DateFormatter().date(from: $0.answeredAt) }.max() ?? .distantPast
        let daysSince = Date().timeIntervalSince(lastAnsweredAt) / 86_400
        return (correctRatePenalty * 1000) + daysSince
    }

    private static func parseRepairedQuestion(subject: String, problemID: String, rawQuestionJSON: String) throws -> OfflineQuestion {
        guard let data = rawQuestionJSON.data(using: .utf8) else {
            throw NSError(domain: "OfflineStudyStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "JSON を UTF-8 として読み取れません。"])
        }
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "OfflineStudyStore", code: 2, userInfo: [NSLocalizedDescriptionKey: "JSON オブジェクト形式で入力してください。"])
        }

        let questionText = (root["question_text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if questionText.isEmpty {
            throw NSError(domain: "OfflineStudyStore", code: 3, userInfo: [NSLocalizedDescriptionKey: "`question_text` は必須です。"])
        }

        let answer = stringify(root["answer"]).trimmingCharacters(in: .whitespacesAndNewlines)
        if answer.isEmpty {
            throw NSError(domain: "OfflineStudyStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "`answer` は必須です。"])
        }

        let id = stringify(root["id"]).trimmingCharacters(in: .whitespacesAndNewlines)
        if id.isEmpty {
            throw NSError(domain: "OfflineStudyStore", code: 5, userInfo: [NSLocalizedDescriptionKey: "`id` は必須です。"])
        }

        let normalizedChoices = try normalizeChoices(root["choices"])
        if !normalizedChoices.contains(where: { $0.label == answer }) {
            throw NSError(domain: "OfflineStudyStore", code: 6, userInfo: [NSLocalizedDescriptionKey: "`answer` が choices に存在しません。"])
        }

        let explanation = normalizeExplanation(root["explanation"])
        let category = stringify(root["category"]).nilIfEmpty
        let images = normalizeStringList(root["images"])
        let explanationImages = normalizeStringList((root["explanation"] as? [String: Any])?["images"])
        let customExplanation = stringify(root["custom_explanation"]).nilIfEmpty
        let customExplanationImageDataURL = stringify(root["custom_explanation_image_data_url"]).nilIfEmpty
        let customQuestionImageDataURL = stringify(root["custom_question_image_data_url"]).nilIfEmpty

        return OfflineQuestion(
            id: id.isEmpty ? problemID : id,
            subject: subject,
            questionText: questionText,
            choices: normalizedChoices,
            answer: answer,
            explanation: explanation,
            category: category,
            imageURLs: images.map { "/api/images/\($0)" },
            explanationImageURLs: explanationImages.map { "/api/images/\($0)" },
            customExplanation: customExplanation,
            customExplanationImageDataURL: customExplanationImageDataURL,
            customQuestionImageDataURL: customQuestionImageDataURL
        )
    }

    private static func normalizeChoices(_ value: Any?) throws -> [OfflineChoice] {
        if let list = value as? [[String: Any]] {
            let choices = list.compactMap { item -> OfflineChoice? in
                guard
                    let label = stringify(item["label"]).nilIfEmpty,
                    let text = stringify(item["text"]).nilIfEmpty
                else { return nil }
                return OfflineChoice(label: label, text: text)
            }
            if choices.isEmpty {
                throw NSError(domain: "OfflineStudyStore", code: 7, userInfo: [NSLocalizedDescriptionKey: "`choices` に有効な項目がありません。"])
            }
            return choices
        }
        if let dict = value as? [String: Any] {
            let choices = dict.keys.sorted().compactMap { key -> OfflineChoice? in
                let text = stringify(dict[key]).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                return OfflineChoice(label: key, text: text)
            }
            if choices.isEmpty {
                throw NSError(domain: "OfflineStudyStore", code: 8, userInfo: [NSLocalizedDescriptionKey: "`choices` が空です。"])
            }
            return choices
        }
        if let list = value as? [String] {
            let choices = list.enumerated().map { index, text in
                OfflineChoice(label: String(index + 1), text: text)
            }.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            if choices.isEmpty {
                throw NSError(domain: "OfflineStudyStore", code: 9, userInfo: [NSLocalizedDescriptionKey: "`choices` が空です。"])
            }
            return choices
        }
        throw NSError(domain: "OfflineStudyStore", code: 10, userInfo: [NSLocalizedDescriptionKey: "`choices` は辞書、文字列配列、または {label,text} 配列で指定してください。"])
    }

    private static func normalizeExplanation(_ value: Any?) -> OfflineExplanation {
        if let text = value as? String {
            return OfflineExplanation(text: text, images: [])
        }
        if let dict = value as? [String: Any] {
            return OfflineExplanation(
                text: stringify(dict["text"]),
                images: normalizeStringList(dict["images"])
            )
        }
        return OfflineExplanation(text: "", images: [])
    }

    private static func normalizeStringList(_ value: Any?) -> [String] {
        guard let list = value as? [Any] else { return [] }
        return list.compactMap { item in
            let text = stringify(item).trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : text
        }
    }

    private static func stringify(_ value: Any?) -> String {
        switch value {
        case let string as String:
            return string
        case let number as NSNumber:
            return number.stringValue
        default:
            return ""
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct OfflineStudyAPIClient {
    let baseURL: URL

    init(baseURLText: String) throws {
        guard let url = URL(string: baseURLText), let scheme = url.scheme, !scheme.isEmpty else {
            throw URLError(.badURL)
        }
        baseURL = url
    }

    func downloadPackage(subjects: [String]) async throws -> OfflineStudyPackage {
        var components = URLComponents(url: URL(string: "/api/offline-study/package", relativeTo: baseURL)!, resolvingAgainstBaseURL: true)!
        if !subjects.isEmpty {
            components.queryItems = subjects.map { URLQueryItem(name: "subjects", value: $0) }
        }
        let url = components.url!
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(OfflineStudyPackage.self, from: data)
    }

    func fetchSubjects() async throws -> [String] {
        let url = URL(string: "/api/subjects", relativeTo: baseURL)!
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode([String].self, from: data)
    }
    func sync(payload: OfflineSyncRequestPayload) async throws {
        let url = URL(string: "/api/offline-study/sync", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "request failed"
            throw NSError(domain: "OfflineStudyAPIClient", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }
}
