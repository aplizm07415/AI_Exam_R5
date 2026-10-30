# AI_Exam_R5 — Alignerr reviewer brief

## Project and motivation

I am building a personal study tool for Japanese professional qualification exams, with R4 focused on four subjects of the first-stage Small and Medium Enterprise Management Consultant examination. The project began with quiz practice and evolved toward keeping useful study records, organizing revision, and distinguishing genuine understanding from repeated exposure to the same question.

## My use of Claude Code

I have consistently used Claude Code throughout these projects as part of my development workflow. I plan to continue using it to improve the application and across my other projects. I also use other AI tools where appropriate; historical references to them remain in this repository. AI used by the application at runtime is separate from the assistant used to develop it.

## Reviewable R4 behavior

- Practice questions with server-side grading and explanations returned after grading.
- Staged study targets and topic-based progress tracking.
- Revision scheduling and explicit handling of an “I don't know” response.
- Saved and resumable practice and mock-exam sessions.
- Local progress storage, optional Neon/PostgreSQL persistence, and conflict-handling code for progress synchronization.
- Question corrections, version tracking, and quarantine of items with insufficient source material.
- Automated tests covering grading, study records, synchronization, and user interactions through the test harness.

These statements describe repository code and documents. They do not claim live production validation, expert review of every question, a commercial customer base, or a guaranteed examination outcome.

## Planned work with Claude Code

1. Validate the current flows in real desktop and mobile browsers and against an isolated test database.
2. Improve question quality, source traceability, and coverage of missing topics.
3. Refine study planning, synchronization, and usability based on actual study needs.
4. Continue applying Claude Code to improvements in this application and to other personal projects.

## Review boundaries

The repository remains private. Credentials, local authentication settings, operational backups, and machine-specific caches were excluded or redacted across every imported branch. Historical deployment endpoints and private contact identifiers were anonymized. Real credentials must be supplied separately through environment variables for any optional cloud integration. No production cloud resources were created or changed during the integration.

Study materials remain included for private review only; public redistribution rights have not been established. Historical versions may need their original build process or further maintenance. The versions coexist here as a portfolio, not as a newly merged production application.
