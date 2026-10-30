import Foundation
import Combine

/// An object to manage the global synchronization state of the application.
/// This can be injected into the SwiftUI environment to be accessible from any view.
class SyncState: ObservableObject {
    @Published var isSyncing: Bool = false
}
