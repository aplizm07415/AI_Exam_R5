import SwiftUI

struct SoragakiPencilKitView: View {
    @StateObject var viewModel = SoragakiPencilKitViewModel()

    var body: some View {
        VStack(spacing: 12) {
            if !viewModel.isAuthenticated {
                VStack(alignment: .leading, spacing: 12) {
                    Text("空描きログイン")
                        .font(.headline)
                    SecureField("Access Token", text: $viewModel.loginToken)
                        .textFieldStyle(.roundedBorder)
                    Button("ログイン") {
                        Task { await viewModel.login() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.loginToken.isEmpty || viewModel.isLoading)
                }
                .padding()
            } else {
                header
                memoAndKeywordsSection
                PencilCanvasView(
                    canvasView: $viewModel.canvasView,
                    toolPicker: $viewModel.toolPicker,
                    baseImage: $viewModel.baseImage
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.2), lineWidth: 1))
            }

            if let message = viewModel.message {
                Text(message).font(.footnote).foregroundColor(.secondary)
            }
        }
        .padding()
        .onAppear {
            SoragakiPencilKitViewModelBridge.shared.viewModel = viewModel
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack {
                Text("日付: \(viewModel.date)")
                Spacer()
                Text(viewModel.isViewingSavedRecord ? "保存済み(参照専用)" : "新規作成")
            }
            .font(.subheadline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(viewModel.records) { record in
                        Button(action: {
                            Task {
                                do {
                                    try await viewModel.selectSavedRecord(record.record_id)
                                } catch {
                                    viewModel.message = error.localizedDescription
                                }
                            }
                        }) {
                            Text(record.saved_at)
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .background(record.record_id == viewModel.selectedRecordID ? Color.blue : Color.gray.opacity(0.2))
                                .foregroundColor(record.record_id == viewModel.selectedRecordID ? .white : .primary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }

            HStack {
                Text("Page \(viewModel.currentPage) / \(viewModel.pages.count)")
                Spacer()
                Button("新規作成に戻る") { viewModel.switchToDraftMode() }
                    .buttonStyle(.bordered)
            }
            .font(.subheadline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(viewModel.pages, id: \.self) { page in
                        Button(action: { Task { await viewModel.selectPage(page) } }) {
                            Text("\(page)")
                                .frame(width: 40, height: 30)
                                .background(page == viewModel.currentPage ? Color.blue : Color.gray.opacity(0.2))
                                .foregroundColor(page == viewModel.currentPage ? .white : .primary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }

            HStack {
                Button("保存") { Task { await viewModel.saveCurrentPage() } }
                    .buttonStyle(.borderedProminent)
                Button("追加") { viewModel.addPage() }
                    .buttonStyle(.bordered)
                Button("削除") { viewModel.deleteCurrentPage() }
                    .buttonStyle(.bordered)
                Button("クリア") { viewModel.clearCurrentPage() }
                    .buttonStyle(.bordered)
            }
            .disabled(viewModel.isLoading || viewModel.isViewingSavedRecord)
        }
    }

    private var memoAndKeywordsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button(action: { Task { await viewModel.fetchMemosAndKeywords() } }) {
                    Text(viewModel.isMemoLoading ? "生成中..." : "キーワードを生成")
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isMemoLoading || viewModel.isLoading)

                Spacer()
            }

            if viewModel.keywords.isEmpty {
                Text("ボタンを押して、学習内容からキーワードを生成します。")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            } else {
                if viewModel.keywords.first == "この日のMy Memoはありませんでした" {
                    Text("この日のMy Memoはありませんでした")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    if viewModel.keywords.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(Array(viewModel.keywords.dropFirst().enumerated()), id: \.offset) { _, keyword in
                                    Text(keyword)
                                        .font(.caption)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(Color.blue.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Array(viewModel.keywords.enumerated()), id: \.offset) { _, keyword in
                                Text(keyword)
                                    .font(.caption)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(Color.blue.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("参照元My Memo")
                    .font(.caption)
                    .foregroundColor(.secondary)
                ScrollView {
                    Text(viewModel.memos.isEmpty ? "キーワードを生成すると、ここに参照元のメモが表示されます。" : viewModel.memos)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .font(.footnote)
                        .padding(8)
                }
                .frame(minHeight: 90, maxHeight: 140)
                .background(Color.gray.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}
