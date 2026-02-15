import Foundation
import GRDB

struct HistoryItem: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var isSynced: Bool = false // デフォルト値を設定
    let problemId: String
    let subject: String
    let selectedAnswer: String
    let isCorrect: Bool
    let answeredAt: Date
    let category: String?

    static let databaseTableName = "historyItem"

    // JSONとの紐付け（isSyncedとidはDB用なので除外）
    enum CodingKeys: String, CodingKey {
        case problemId = "problem_id"
        case subject
        case selectedAnswer = "selected_answer"
        case isCorrect = "is_correct"
        case answeredAt = "answered_at"
        case category
    }

    // GRDB用のマッピングを明示的に記述（ここが重要）
    enum Columns {
        static let id = Column("id")
        static let isSynced = Column("isSynced")
        static let problemId = Column("problemId")
        static let subject = Column("subject")
        static let selectedAnswer = Column("selectedAnswer")
        static let isCorrect = Column("isCorrect")
        static let answeredAt = Column("answeredAt")
        static let category = Column("category")
    }

    // 新規作成用のイニシャライザ
    init(id: Int64? = nil, isSynced: Bool = false, problemId: String, subject: String, selectedAnswer: String, isCorrect: Bool, answeredAt: Date, category: String?) {
        self.id = id
        self.isSynced = isSynced
        self.problemId = problemId
        self.subject = subject
        self.selectedAnswer = selectedAnswer
        self.isCorrect = isCorrect
        self.answeredAt = answeredAt
        self.category = category
    }
    
    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
