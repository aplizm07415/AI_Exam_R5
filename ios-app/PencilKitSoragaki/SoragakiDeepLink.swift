import Foundation

struct QuizDeepLink {
    let baseURL: URL
    let subjects: [String]
    let mode: String
    let count: Int
}

struct SoragakiDeepLink {
    let baseURL: URL
    let date: String

    static func parse(_ url: URL) -> SoragakiDeepLink? {
        guard url.scheme == "quizapp", url.host == "soragaki" else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        let date = components.queryItems?.first(where: { $0.name == "date" })?.value
        let base = components.queryItems?.first(where: { $0.name == "base" })?.value

        guard let date, !date.isEmpty else { return nil }
        guard let base, let baseURL = URL(string: base) else { return nil }

        return SoragakiDeepLink(baseURL: baseURL, date: date)
    }
}

enum AppDeepLink {
    case soragaki(SoragakiDeepLink)
    case quiz(QuizDeepLink)

    static func parse(_ url: URL) -> AppDeepLink? {
        guard url.scheme == "quizapp" else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        guard let base = components.queryItems?.first(where: { $0.name == "base" })?.value,
              let baseURL = URL(string: base) else {
            return nil
        }

        if url.host == "soragaki" {
            guard let date = components.queryItems?.first(where: { $0.name == "date" })?.value,
                  !date.isEmpty else {
                return nil
            }
            return .soragaki(SoragakiDeepLink(baseURL: baseURL, date: date))
        }

        if url.host == "quiz" {
            let subjectsValue = components.queryItems?.first(where: { $0.name == "subjects" })?.value ?? ""
            let subjects = subjectsValue
                .split(separator: ",")
                .map { String($0).removingPercentEncoding ?? String($0) }
                .filter { !$0.isEmpty }
            let mode = components.queryItems?.first(where: { $0.name == "mode" })?.value ?? "random"
            let countRaw = components.queryItems?.first(where: { $0.name == "count" })?.value ?? "10"
            let count = max(1, Int(countRaw) ?? 10)
            return .quiz(QuizDeepLink(baseURL: baseURL, subjects: subjects, mode: mode, count: count))
        }

        return nil
    }
}
