import Foundation

private extension KeyedDecodingContainer {
    func decodeFlexibleDateIfPresent(forKey key: Key) -> Date? {
        if let timestamp = try? decodeIfPresent(Double.self, forKey: key) {
            return Date(timeIntervalSince1970: timestamp)
        }
        if let timestampInt = try? decodeIfPresent(Int.self, forKey: key) {
            return Date(timeIntervalSince1970: TimeInterval(timestampInt))
        }
        if let rawString = try? decodeIfPresent(String.self, forKey: key),
           !rawString.isEmpty {
            let iso8601 = ISO8601DateFormatter()
            if let parsed = iso8601.date(from: rawString) {
                return parsed
            }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZ"
            if let parsed = formatter.date(from: rawString) {
                return parsed
            }
        }
        return nil
    }
}

struct OfflineStudyPackage: Codable {
    var downloadedAt: String
    var subjects: [OfflineSubject]
    var reviewLater: [OfflineReviewLaterItem]
    var histories: [String: [OfflineHistoryItem]]
    var warnings: [String] = []
    var invalidQuestions: [OfflineInvalidQuestion] = []

    enum CodingKeys: String, CodingKey {
        case downloadedAt = "downloaded_at"
        case subjects
        case reviewLater = "review_later"
        case histories
        case warnings
        case invalidQuestions = "invalid_questions"
    }

    init(
        downloadedAt: String,
        subjects: [OfflineSubject],
        reviewLater: [OfflineReviewLaterItem],
        histories: [String: [OfflineHistoryItem]],
        warnings: [String] = [],
        invalidQuestions: [OfflineInvalidQuestion] = []
    ) {
        self.downloadedAt = downloadedAt
        self.subjects = subjects
        self.reviewLater = reviewLater
        self.histories = histories
        self.warnings = warnings
        self.invalidQuestions = invalidQuestions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        downloadedAt = try container.decode(String.self, forKey: .downloadedAt)
        subjects = try container.decodeIfPresent([OfflineSubject].self, forKey: .subjects) ?? []
        reviewLater = try container.decodeIfPresent([OfflineReviewLaterItem].self, forKey: .reviewLater) ?? []
        histories = try container.decodeIfPresent([String: [OfflineHistoryItem]].self, forKey: .histories) ?? [:]
        warnings = try container.decodeIfPresent([String].self, forKey: .warnings) ?? []
        invalidQuestions = try container.decodeIfPresent([OfflineInvalidQuestion].self, forKey: .invalidQuestions) ?? []
    }
}

struct OfflineInvalidQuestion: Codable, Identifiable, Hashable {
    var id: String { "\(subject)::\(problemID)" }
    let subject: String
    let problemID: String
    let reason: String
    var rawQuestionJSON: String

    enum CodingKeys: String, CodingKey {
        case subject
        case problemID = "problem_id"
        case reason
        case rawQuestionJSON = "raw_question_json"
    }
}

struct OfflineSubject: Codable, Identifiable, Hashable {
    var id: String { name }
    let name: String
    var questions: [OfflineQuestion]
}

struct OfflineQuestion: Codable, Identifiable, Hashable {
    let id: String
    let subject: String
    var questionText: String
    var choices: [OfflineChoice]
    var answer: String
    var explanation: OfflineExplanation
    var category: String?
    var imageURLs: [String]
    var explanationImageURLs: [String]
    var customExplanation: String?
    var customExplanationImageDataURL: String?
    var customQuestionImageDataURL: String?

    enum CodingKeys: String, CodingKey {
        case id, subject, choices, answer, explanation, category
        case questionText = "question_text"
        case imageURLs = "image_urls"
        case explanationImageURLs = "explanation_image_urls"
        case customExplanation = "custom_explanation"
        case customExplanationImageDataURL = "custom_explanation_image_data_url"
        case customQuestionImageDataURL = "custom_question_image_data_url"
    }
}

struct OfflineChoice: Codable, Identifiable, Hashable {
    var id: String { label }
    let label: String
    var text: String
}

struct OfflineExplanation: Codable, Hashable {
    var text: String
    var images: [String] = []
}

struct OfflineHistoryItem: Codable, Identifiable, Hashable {
    var id: String { "\(subject)::\(problemID)::\(answeredAt)" }
    let problemID: String
    let subject: String
    let selectedAnswer: String
    let isCorrect: Bool
    let answeredAt: String
    let category: String?

    enum CodingKeys: String, CodingKey {
        case problemID = "problem_id"
        case subject
        case selectedAnswer = "selected_answer"
        case isCorrect = "is_correct"
        case answeredAt = "answered_at"
        case category
    }
}

struct OfflineReviewLaterItem: Codable, Identifiable, Hashable {
    var id: String { "\(subject)::\(problemID)" }
    let subject: String
    let problemID: String
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case subject
        case problemID = "problem_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct OfflinePendingRecord: Codable, Identifiable, Hashable {
    enum RecordKind: String, Codable {
        case practice
        case memo
        case reviewLater
        case problemEdit
        case problemRepair
    }

    let id: String
    let kind: RecordKind
    let subject: String
    let problemID: String
    let practicedAt: Date
    var selectedAnswer: String?
    var isCorrect: Bool?
    var category: String?
    var summary: String?
    var changedFields: [String] = []

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case subject
        case problemID = "problemID"
        case practicedAt
        case selectedAnswer
        case isCorrect
        case category
        case summary
        case changedFields
    }

    init(
        id: String,
        kind: RecordKind,
        subject: String,
        problemID: String,
        practicedAt: Date,
        selectedAnswer: String? = nil,
        isCorrect: Bool? = nil,
        category: String? = nil,
        summary: String? = nil,
        changedFields: [String] = []
    ) {
        self.id = id
        self.kind = kind
        self.subject = subject
        self.problemID = problemID
        self.practicedAt = practicedAt
        self.selectedAnswer = selectedAnswer
        self.isCorrect = isCorrect
        self.category = category
        self.summary = summary
        self.changedFields = changedFields
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decodeIfPresent(RecordKind.self, forKey: .kind) ?? .practice
        subject = try container.decode(String.self, forKey: .subject)
        problemID = try container.decode(String.self, forKey: .problemID)
        practicedAt = container.decodeFlexibleDateIfPresent(forKey: .practicedAt) ?? Date()
        selectedAnswer = try container.decodeIfPresent(String.self, forKey: .selectedAnswer)
        isCorrect = try container.decodeIfPresent(Bool.self, forKey: .isCorrect)
        category = try container.decodeIfPresent(String.self, forKey: .category)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        changedFields = try container.decodeIfPresent([String].self, forKey: .changedFields) ?? []
    }
}

struct OfflineChangedProblemSummary: Identifiable, Hashable {
    let id: String
    let subject: String
    let problemID: String
    let category: String?
    let changedAt: Date
    let summaries: [String]
    let changedFields: [String]
}

struct OfflineSyncRequestPayload: Codable {
    let subjects: [OfflineSyncQuestionPayload]
    let customExplanations: [OfflineSyncCustomExplanationPayload]
    let reviewLaterUpserts: [OfflineReviewLaterItem]
    let reviewLaterRemovals: [OfflineReviewLaterProblemRef]
    let histories: [String: [OfflineHistoryItem]]

    enum CodingKeys: String, CodingKey {
        case subjects
        case customExplanations = "custom_explanations"
        case reviewLaterUpserts = "review_later_upserts"
        case reviewLaterRemovals = "review_later_removals"
        case histories
    }
}

struct OfflineReviewLaterProblemRef: Codable, Hashable {
    let subject: String
    let problemID: String

    enum CodingKeys: String, CodingKey {
        case subject
        case problemID = "problem_id"
    }
}

struct OfflineSyncQuestionPayload: Codable {
    let id: String
    let subject: String
    let questionText: String
    let choices: [OfflineChoice]
    let answer: String
    let explanation: OfflineExplanation
    let category: String?

    enum CodingKeys: String, CodingKey {
        case id, subject, choices, answer, explanation, category
        case questionText = "question_text"
    }
}

struct OfflineSyncCustomExplanationPayload: Codable {
    let problemID: String
    let text: String
    let explanationImageDataURL: String?
    let questionImageDataURL: String?

    enum CodingKeys: String, CodingKey {
        case problemID = "problem_id"
        case text
        case explanationImageDataURL = "explanation_image_data_url"
        case questionImageDataURL = "question_image_data_url"
    }
}

struct OfflineStoreState: Codable {
    var selectedSubjects: [String] = []
    var availableSubjects: [String] = []
    var installedAt: Date?
    var lastDownloadedAt: Date?
    var lastSyncedAt: Date?

    enum CodingKeys: String, CodingKey {
        case selectedSubjects
        case availableSubjects
        case installedAt
        case lastDownloadedAt
        case lastSyncedAt
    }

    init(
        selectedSubjects: [String] = [],
        availableSubjects: [String] = [],
        installedAt: Date? = nil,
        lastDownloadedAt: Date? = nil,
        lastSyncedAt: Date? = nil
    ) {
        self.selectedSubjects = selectedSubjects
        self.availableSubjects = availableSubjects
        self.installedAt = installedAt
        self.lastDownloadedAt = lastDownloadedAt
        self.lastSyncedAt = lastSyncedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        selectedSubjects = try container.decodeIfPresent([String].self, forKey: .selectedSubjects) ?? []
        availableSubjects = try container.decodeIfPresent([String].self, forKey: .availableSubjects) ?? []
        installedAt = container.decodeFlexibleDateIfPresent(forKey: .installedAt)
        lastDownloadedAt = container.decodeFlexibleDateIfPresent(forKey: .lastDownloadedAt)
        lastSyncedAt = container.decodeFlexibleDateIfPresent(forKey: .lastSyncedAt)
    }
}

struct OfflineAuditLogEntry: Codable, Identifiable, Hashable {
    enum EventKind: String, Codable {
        case downloadStarted
        case downloadCompleted
        case downloadFailed
        case syncStarted
        case syncCompleted
        case syncFailed
    }

    let id: String
    let timestamp: Date
    let kind: EventKind
    let subjects: [String]
    let message: String

    enum CodingKeys: String, CodingKey {
        case id
        case timestamp
        case kind
        case subjects
        case message
    }

    init(id: String, timestamp: Date, kind: EventKind, subjects: [String], message: String) {
        self.id = id
        self.timestamp = timestamp
        self.kind = kind
        self.subjects = subjects
        self.message = message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        timestamp = container.decodeFlexibleDateIfPresent(forKey: .timestamp) ?? Date()
        kind = try container.decodeIfPresent(EventKind.self, forKey: .kind) ?? .downloadStarted
        subjects = try container.decodeIfPresent([String].self, forKey: .subjects) ?? []
        message = try container.decodeIfPresent(String.self, forKey: .message) ?? ""
    }
}

enum OfflineTransferKind: Equatable {
    case idle
    case downloading
    case uploading
}

struct OfflineTransferStatus: Equatable {
    var kind: OfflineTransferKind = .idle
    var message: String = "待機中"
    var progress: Double = 0
}
