import Foundation

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
