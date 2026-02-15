import Foundation
import Combine

@MainActor
class QuizViewModel: ObservableObject {
    
    // Quiz State
    @Published var questions: [Question] = []
    @Published var currentQuestionIndex: Int = 0
    @Published var quizState: QuizState = .selecting
    
    // Question State
    @Published var selectedChoice: Choice?
    @Published var isAnswered: Bool = false
    @Published var isCorrect: Bool = false
    
    // Error handling
    @Published var quizError: Error?
    @Published var showingErrorAlert: Bool = false
    
    // Available subjects loaded from local DB
    @Published var subjects: [Subject] = []
    
    private let databaseManager: DatabaseManager
    
    var currentQuestion: Question? {
        guard questions.indices.contains(currentQuestionIndex) else { return nil }
        return questions[currentQuestionIndex]
    }
    
    var progress: String {
        "\(currentQuestionIndex + 1) / \(questions.count)"
    }
    
    enum QuizState {
        case selecting
        case active
        case finished
    }
    
    init(databaseManager: DatabaseManager = .shared) {
        self.databaseManager = databaseManager
        loadSubjects()
    }
    
    func loadSubjects() {
        do {
            self.subjects = try databaseManager.getAllSubjects()
        } catch {
            self.quizError = error
            self.showingErrorAlert = true
        }
    }
    
    func startQuiz(subjectId: String) {
        do {
            self.questions = try databaseManager.getQuestions(subjectId: subjectId).shuffled()
            self.currentQuestionIndex = 0
            self.quizState = .active
            resetQuestionState()
        } catch {
            self.quizError = error
            self.showingErrorAlert = true
        }
    }
    
    func submitAnswer() {
        guard let currentQuestion = currentQuestion, let selectedChoice = selectedChoice else { return }
        
        isAnswered = true
        isCorrect = (selectedChoice.label == currentQuestion.answer)
        
        // Save history
        var historyItem = HistoryItem(
            problemId: currentQuestion.id,
            subject: currentQuestion.subjectId,
            selectedAnswer: selectedChoice.label,
            isCorrect: isCorrect,
            answeredAt: Date(),
            category: currentQuestion.category
        )
        
        do {
            try databaseManager.saveHistoryItem(&historyItem)
        } catch {
            self.quizError = error
            self.showingErrorAlert = true
        }
    }
    
    func nextQuestion() {
        if currentQuestionIndex < questions.count - 1 {
            currentQuestionIndex += 1
            resetQuestionState()
        } else {
            quizState = .finished
        }
    }
    
    func resetQuiz() {
        self.quizState = .selecting
        self.questions = []
        loadSubjects()
    }
    
    private func resetQuestionState() {
        selectedChoice = nil
        isAnswered = false
        isCorrect = false
    }
}
