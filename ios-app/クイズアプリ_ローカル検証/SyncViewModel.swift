import Foundation
import Combine

class SyncViewModel: ObservableObject {
    
    @Published var statusMessage: String = "Ready to sync."
    @Published var lastSyncDate: Date? {
        didSet {
            UserDefaults.standard.set(lastSyncDate, forKey: "lastSyncDate")
        }
    }
    
    // This ViewModel now reports its state to a global SyncState object.
    private var syncState: SyncState
    
    private let networkManager: NetworkManager
    private let databaseManager: DatabaseManager
    
    init(syncState: SyncState, networkManager: NetworkManager = .shared, databaseManager: DatabaseManager = .shared) {
        self.syncState = syncState
        self.networkManager = networkManager
        self.databaseManager = databaseManager
        self.lastSyncDate = UserDefaults.standard.object(forKey: "lastSyncDate") as? Date
    }
    
    @MainActor
    func syncAllData() {
        guard !syncState.isSyncing else { return }
        
        syncState.isSyncing = true
        statusMessage = "Starting synchronization..."
        
        Task {
            do {
                statusMessage = "Checking for unsynced history..."
                let unsyncedItems = try databaseManager.getUnsyncedHistory()
                
                if !unsyncedItems.isEmpty {
                    statusMessage = "Uploading \(unsyncedItems.count) history records..."
                    try await uploadHistory(items: unsyncedItems)
                    
                    let idsToUpdate = unsyncedItems.compactMap { $0.id }
                    try databaseManager.markHistoryAsSynced(ids: idsToUpdate)
                    statusMessage = "History upload complete."
                } else {
                    statusMessage = "No new history to upload."
                }

                statusMessage = "Downloading subject list..."
                let subjectIds = try await downloadSubjects()
                let subjects = subjectIds.map { Subject(id: $0) }
                try databaseManager.saveSubjects(subjects)
                statusMessage = "Found \(subjects.count) subjects."

                statusMessage = "Downloading questions for \(subjects.count) subjects in parallel..."
                try await withThrowingTaskGroup(of: Void.self) { group in
                    for subject in subjects {
                        group.addTask {
                            let questions = try await self.downloadQuestions(for: subject.id)
                            do {
                                try self.databaseManager.saveQuestions(questions)
                            } catch {
                                // Re-throw the error to be caught by the withThrowingTaskGroup
                                throw error
                            }
                        }
                    }
                    // Propagate any errors from the group
                    try await group.waitForAll()
                }

                statusMessage = "Sync complete!"
                lastSyncDate = Date()
                
            } catch {
                statusMessage = "Sync failed: \(error.localizedDescription)"
            }
            
            syncState.isSyncing = false
        }
    }
    
    private func uploadHistory(items: [HistoryItem]) async throws {
        return try await withCheckedThrowingContinuation { continuation in
            networkManager.uploadHistory(items: items) { result in
                switch result {
                case .success:
                    continuation.resume(returning: ())
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    private func downloadSubjects() async throws -> [String] {
        return try await withCheckedThrowingContinuation { continuation in
            networkManager.downloadSubjectList { result in
                continuation.resume(with: result)
            }
        }
    }
    
    private func downloadQuestions(for subjectId: String) async throws -> [Question] {
        return try await withCheckedThrowingContinuation { continuation in
            networkManager.downloadQuestions(for: subjectId) { result in
                continuation.resume(with: result)
            }
        }
    }
}
