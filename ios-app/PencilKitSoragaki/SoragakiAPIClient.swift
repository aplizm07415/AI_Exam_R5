import Foundation
import UIKit

struct SoragakiAuthPayload: Encodable {
    let access_token: String
}

struct SoragakiRecordSummary: Codable, Identifiable {
    let record_id: String
    let saved_at: String
    let learning_date: String?
    let page_count: Int

    var id: String { record_id }
}

private struct SoragakiRecordPagePayload: Encodable {
    let page: Int
    let data_url: String
}

private struct SoragakiRecordCreatePayload: Encodable {
    let pages: [SoragakiRecordPagePayload]
    let learning_date: String?
}

private struct GenerateKeywordsPayload: Encodable {
    let memo_text: String
}

final class SoragakiAPIClient {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        self.session = URLSession(configuration: configuration)
    }

    func login(accessToken: String) async throws {
        var request = URLRequest(url: URL(string: "/api/auth/login", relativeTo: baseURL)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(SoragakiAuthPayload(access_token: accessToken))
        _ = try await send(request, expectedStatuses: [204])
    }

    func checkSession() async -> Bool {
        var request = URLRequest(url: URL(string: "/api/auth/session", relativeTo: baseURL)!)
        request.httpMethod = "GET"
        do {
            _ = try await send(request, expectedStatuses: [204])
            return true
        } catch {
            return false
        }
    }

    func listRecords() async throws -> [SoragakiRecordSummary] {
        let url = URL(string: "/api/soragaki/records", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, _) = try await send(request, expectedStatuses: [200])
        return try JSONDecoder().decode([SoragakiRecordSummary].self, from: data)
    }

    func createRecord(learningDate: String?, pages: [(Int, Data)]) async throws -> SoragakiRecordSummary {
        let url = URL(string: "/api/soragaki/records", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encodedPages = pages.sorted { $0.0 < $1.0 }.map { page, pngData in
            SoragakiRecordPagePayload(page: page, data_url: "data:image/png;base64,\(pngData.base64EncodedString())")
        }
        request.httpBody = try JSONEncoder().encode(
            SoragakiRecordCreatePayload(
                pages: encodedPages,
                learning_date: learningDate
            )
        )
        let (data, _) = try await send(request, expectedStatuses: [201])
        return try JSONDecoder().decode(SoragakiRecordSummary.self, from: data)
    }

    func listRecordPages(recordID: String) async throws -> [Int] {
        let url = URL(string: "/api/soragaki/records/\(recordID)/pages", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, _) = try await send(request, expectedStatuses: [200])
        return try JSONDecoder().decode([Int].self, from: data)
    }

    func getRecordPageImage(recordID: String, page: Int) async throws -> UIImage? {
        let url = URL(string: "/api/soragaki/records/\(recordID)?page=\(page)", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        do {
            let (data, response) = try await send(request, expectedStatuses: [200, 404])
            if response.statusCode == 404 {
                return nil
            }
            return UIImage(data: data)
        } catch APIError.unauthorized {
            throw APIError.unauthorized
        }
    }

    func getMemos(date: String) async throws -> String {
        let url = URL(string: "/api/soragaki/memos/\(date)", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, _) = try await send(request, expectedStatuses: [200])
        return String(data: data, encoding: .utf8) ?? ""
    }

    func generateKeywords(memoText: String) async throws -> [String] {
        let url = URL(string: "/api/soragaki/generate-keywords", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(GenerateKeywordsPayload(memo_text: memoText))
        let (data, _) = try await send(request, expectedStatuses: [200])
        return try JSONDecoder().decode([String].self, from: data)
    }

    @discardableResult
    private func send(_ request: URLRequest, expectedStatuses: Set<Int>) async throws -> (Data, HTTPURLResponse) {
        let (data, rawResponse) = try await session.data(for: request)
        guard let response = rawResponse as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if response.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard expectedStatuses.contains(response.statusCode) else {
            throw APIError.unexpectedStatus(response.statusCode)
        }
        return (data, response)
    }
}

enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case unexpectedStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "サーバー応答が不正です。"
        case .unauthorized:
            return "認証に失敗しました。"
        case .unexpectedStatus(let code):
            return "サーバーエラー: \(code)"
        }
    }
}
