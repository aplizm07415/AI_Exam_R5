import Foundation
import UIKit

struct SoragakiAuthPayload: Encodable {
    let access_token: String
}

struct QuizChoice: Codable, Identifiable {
    var label: String
    var text: String
    var id: String { label }
}

struct QuizExplanation: Decodable {
    let text: String

    init(text: String) {
        self.text = text
    }

    init(from decoder: Decoder) throws {
        if let container = try? decoder.singleValueContainer(),
           let stringValue = try? container.decode(String.self) {
            text = stringValue
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case text
    }
}

struct QuizQuestion: Decodable, Identifiable {
    let id: String
    var questionText: String
    var choices: [QuizChoice]
    var answer: String
    let subject: String
    var explanation: QuizExplanation
    var category: String?
    var customExplanation: String?

    enum CodingKeys: String, CodingKey {
        case id
        case questionText = "question_text"
        case choices
        case answer
        case subject
        case explanation
        case category
        case customExplanation = "custom_explanation"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        questionText = try container.decodeIfPresent(String.self, forKey: .questionText) ?? "(問題文なし)"
        choices = try container.decodeIfPresent([QuizChoice].self, forKey: .choices) ?? []
        answer = try container.decodeIfPresent(String.self, forKey: .answer) ?? ""
        subject = try container.decodeIfPresent(String.self, forKey: .subject) ?? ""
        explanation = try container.decodeIfPresent(QuizExplanation.self, forKey: .explanation) ?? QuizExplanation(text: "")
        category = try container.decodeIfPresent(String.self, forKey: .category)
        customExplanation = try container.decodeIfPresent(String.self, forKey: .customExplanation)
    }
}

private struct QuizStartRequestPayload: Encodable {
    let subjects: [String]
    let count: Int
    let mode: String
}

private struct QuizStartResponsePayload: Decodable {
    let quiz_set: [QuizQuestion]
}

private struct QuizHistoryPayload: Encodable {
    let problem_id: String
    let subject: String
    let selected_answer: String
    let is_correct: Bool
    let category: String?
}

private struct QuizBulkHistoryStatsPayload: Encodable {
    let problem_ids: [String]
    let subjects: [String]
}

struct QuizHistoryStat: Decodable {
    let total: Int
    let correct: Int
}

private struct SaveCustomExplanationPayload: Encodable {
    let text: String
}

private struct UpdateProblemPayload: Encodable {
    let question_text: String
    let choices: [QuizChoice]
    let answer: String
    let explanation: QuizExplanationUpdatePayload
    let category: String?
}

private struct QuizExplanationUpdatePayload: Encodable {
    let text: String
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

    func startQuiz(subjects: [String], mode: String, count: Int) async throws -> [QuizQuestion] {
        do {
            return try await performStartQuiz(subjects: subjects, mode: mode, count: count)
        } catch let error as APIError {
            switch error {
            case .unexpectedStatus(let code, _) where code == 404:
                let resolvedSubjects = try await resolveQuizSubjects(subjects)
                guard !resolvedSubjects.isEmpty else { throw error }
                if resolvedSubjects == subjects { throw error }
                return try await performStartQuiz(subjects: resolvedSubjects, mode: mode, count: count)
            default:
                throw error
            }
        }
    }

    private func performStartQuiz(subjects: [String], mode: String, count: Int) async throws -> [QuizQuestion] {
        let url = URL(string: "/api/quiz/start", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            QuizStartRequestPayload(subjects: subjects, count: count, mode: mode)
        )
        let (data, _) = try await send(request, expectedStatuses: [200])
        do {
            let response = try JSONDecoder().decode(QuizStartResponsePayload.self, from: data)
            return response.quiz_set
        } catch {
            let raw = String(data: data, encoding: .utf8) ?? "(invalid utf8)"
            throw APIError.decoding("quiz/start decode failed: \(error.localizedDescription). raw=\(raw.prefix(280))")
        }
    }

    private func resolveQuizSubjects(_ requested: [String]) async throws -> [String] {
        let available = try await listSubjects()
        if available.isEmpty { return requested }

        let availableSet = Set(available)
        var byStem: [String: String] = [:]
        var duplicateStems = Set<String>()
        for subject in available {
            let stem = subject.hasSuffix(".json") ? String(subject.dropLast(5)) : subject
            if byStem[stem] != nil {
                duplicateStems.insert(stem)
            } else {
                byStem[stem] = subject
            }
        }
        for duplicate in duplicateStems {
            byStem.removeValue(forKey: duplicate)
        }

        let normalizedRequested = requested
            .map { ($0.removingPercentEncoding ?? $0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let resolved = rebuildRequestedSubjects(normalizedRequested, availableSet: availableSet, byStem: byStem)
        return resolved.isEmpty ? requested : resolved
    }

    private func rebuildRequestedSubjects(_ parts: [String], availableSet: Set<String>, byStem: [String: String]) -> [String] {
        guard !parts.isEmpty else { return [] }

        var resolved: [String] = []
        var seen = Set<String>()
        var index = 0

        func resolveOne(_ raw: String) -> String? {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let candidates = [
                trimmed,
                trimmed.hasSuffix(".json") ? trimmed : "\(trimmed).json",
                byStem[trimmed] ?? ""
            ]
            return candidates.first { !$0.isEmpty && availableSet.contains($0) }
        }

        while index < parts.count {
            var bestMatch: String?
            var bestEnd = index

            var combined = ""
            for end in index..<parts.count {
                combined = end == index ? parts[end] : "\(combined),\(parts[end])"
                if let match = resolveOne(combined) {
                    bestMatch = match
                    bestEnd = end
                }
            }

            if let bestMatch {
                if seen.insert(bestMatch).inserted {
                    resolved.append(bestMatch)
                }
                index = bestEnd + 1
                continue
            }

            if let fallback = resolveOne(parts[index]), seen.insert(fallback).inserted {
                resolved.append(fallback)
            }
            index += 1
        }

        return resolved
    }

    private func listSubjects() async throws -> [String] {
        let url = URL(string: "/api/subjects", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, _) = try await send(request, expectedStatuses: [200])
        return (try? JSONDecoder().decode([String].self, from: data)) ?? []
    }

    func submitHistory(problemID: String, subject: String, selectedAnswer: String, isCorrect: Bool, category: String?) async throws {
        let url = URL(string: "/api/history", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            QuizHistoryPayload(
                problem_id: problemID,
                subject: subject,
                selected_answer: selectedAnswer,
                is_correct: isCorrect,
                category: category
            )
        )
        _ = try await send(request, expectedStatuses: [200])
    }

    func getBulkHistoryStats(problemIDs: [String], subjects: [String]) async throws -> [String: QuizHistoryStat] {
        let url = URL(string: "/api/quiz/bulk-history-stats", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            QuizBulkHistoryStatsPayload(problem_ids: problemIDs, subjects: subjects)
        )
        let (data, _) = try await send(request, expectedStatuses: [200])
        return try JSONDecoder().decode([String: QuizHistoryStat].self, from: data)
    }

    func saveCustomExplanation(problemID: String, text: String) async throws {
        let url = URL(string: "/api/problems/\(problemID)/custom-explanation", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(SaveCustomExplanationPayload(text: text))
        _ = try await send(request, expectedStatuses: [204])
    }

    func updateProblem(subject: String, problemID: String, questionText: String, choices: [QuizChoice], answer: String, explanationText: String, category: String?) async throws -> QuizQuestion {
        let escapedSubject = subject.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? subject
        let url = URL(string: "/api/subjects/\(escapedSubject)/problems/\(problemID)", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            UpdateProblemPayload(
                question_text: questionText,
                choices: choices,
                answer: answer,
                explanation: QuizExplanationUpdatePayload(text: explanationText),
                category: category?.isEmpty == true ? nil : category
            )
        )
        let (data, _) = try await send(request, expectedStatuses: [200])
        return try JSONDecoder().decode(QuizQuestion.self, from: data)
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
            let detail = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw APIError.unexpectedStatus(response.statusCode, detail?.isEmpty == true ? nil : detail)
        }
        return (data, response)
    }
}

enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case unexpectedStatus(Int, String?)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "サーバー応答が不正です。"
        case .unauthorized:
            return "認証に失敗しました。"
        case .unexpectedStatus(let code, let detail):
            if let detail, !detail.isEmpty {
                return "サーバーエラー: \(code) (\(detail))"
            }
            return "サーバーエラー: \(code)"
        case .decoding(let message):
            return "データ解析エラー: \(message)"
        }
    }
}
