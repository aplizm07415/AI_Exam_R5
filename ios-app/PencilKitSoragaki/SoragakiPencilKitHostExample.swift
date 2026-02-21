import SwiftUI

// Xcode のルート画面に組み込む時の最小例
struct SoragakiPencilKitHostExample: View {
    @State private var deepLink: SoragakiDeepLink?

    var body: some View {
        Group {
            if deepLink != nil {
                SoragakiPencilKitView()
                    .task(id: deepLink?.date) {
                        if let deepLink {
                            await SoragakiPencilKitViewModelBridge.shared.configure(deepLink)
                        }
                    }
            } else {
                Text("Webの「iPadアプリで開く」から起動してください。")
            }
        }
        .onOpenURL { url in
            deepLink = SoragakiDeepLink.parse(url)
        }
    }
}

// 既存 ViewModel へ deep link を橋渡しするだけの簡易ブリッジ
@MainActor
final class SoragakiPencilKitViewModelBridge {
    static let shared = SoragakiPencilKitViewModelBridge()
    weak var viewModel: SoragakiPencilKitViewModel?

    func configure(_ deepLink: SoragakiDeepLink) async {
        await viewModel?.configure(with: deepLink)
    }
}
