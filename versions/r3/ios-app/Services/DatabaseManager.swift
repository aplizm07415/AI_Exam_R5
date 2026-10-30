import Foundation
import GRDB

final class DatabaseManager {
    
    static let shared = DatabaseManager()
    
    private var dbQueue: DatabaseQueue
    
    private init() {
        do {
            let dbURL = try FileManager.default
                .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("QuizApp.sqlite")
            
            dbQueue = try DatabaseQueue(path: dbURL.path)
            try migrator.migrate(dbQueue)
            
        } catch {
            fatalError("Failed to initialize database: \(error)")
        }
    }
    
    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        
        migrator.registerMigration("v1") { db in
            try db.create(table: Subject.databaseTableName) { t in
                t.column("id", .text).primaryKey()
            }
            
            try db.create(table: Question.databaseTableName) { t in
                t.column("id", .text).primaryKey()
                t.column("questionText", .text).notNull()
                t.column("choicesJSON", .text).notNull()
                t.column("answer", .text).notNull()
                t.column("subjectId", .text).notNull().references(Subject.databaseTableName, onDelete: .cascade)
                t.column("explanationJSON", .text)
                t.column("category", .text)
            }
            
            try db.create(table: HistoryItem.databaseTableName) { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("problem_id", .text).notNull()
                t.column("subject", .text).notNull()
                t.column("selected_answer", .text).notNull()
                t.column("is_correct", .boolean).notNull()
                t.column("answered_at", .datetime).notNull()
                t.column("category", .text)
                t.column("isSynced", .boolean).notNull().defaults(to: false)
            }
        }
        
        return migrator
    }
}

// MARK: - Public API
extension DatabaseManager {
    
    func saveSubjects(_ subjects: [Subject]) throws {
        try dbQueue.write { db in
            for subject in subjects {
                try subject.save(db)
            }
        }
    }
    
    func saveQuestions(_ questions: [Question]) throws {
        try dbQueue.write { db in
            for question in questions {
                try question.save(db)
            }
        }
    }

    func saveHistoryItem(_ item: inout HistoryItem) throws {
        try dbQueue.write { db in
            try item.save(db)
        }
    }

    func getAllSubjects() throws -> [Subject] {
        try dbQueue.read { db in
            try Subject.fetchAll(db)
        }
    }

    func getQuestions(subjectId: String) throws -> [Question] {
        try dbQueue.read { db in
            try Question.filter(Column("subjectId") == subjectId).fetchAll(db)
        }
    }

    func getUnsyncedHistory() throws -> [HistoryItem] {
        try dbQueue.read { db in
            try HistoryItem.filter(Column("isSynced") == false).fetchAll(db)
        }
    }

    func markHistoryAsSynced(ids: [Int64]) throws {
        guard !ids.isEmpty else { return }
        try dbQueue.write { db in
            try HistoryItem
                .filter(ids.contains(Column("id")))
                .updateAll(db, Column("isSynced").set(to: true))
        }
    }
}
