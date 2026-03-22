import SwiftUI

@main
struct QuizSoragakiPadOfflineApp: App {
    @StateObject private var store = OfflineStudyStore()

    var body: some Scene {
        WindowGroup {
            OfflineRootView()
                .environmentObject(store)
                .preferredColorScheme(.light)
        }
    }
}
