# AI Exam Prep — development portfolio

## For the Alignerr review team

This private repository brings together the development history of my personal exam-study applications, from the first quiz application to a more detailed learning and revision tool. I built these projects to support my own study needs and improved them as those needs became clearer.

**Claude Code has been a consistent part of my development workflow throughout these projects. I intend to continue using Claude Code to improve this project and to build and maintain my other projects.** This statement reflects my own account of how I developed the projects. Other AI tools also appear in the historical files; Claude Code was not my only tool. Some applications use Gemini at runtime, which is separate from the coding assistant used during development.

### Suggested review order

1. Start with [the current R4 application](versions/r4/exam-app-template/README.md).
2. Read [the development history](docs/DEVELOPMENT_HISTORY.md) for the progression through R1, R2, the R3 branch, and R4.
3. Read [the reviewer brief](docs/ALIGNERR_REVIEW.md) for the purpose, implemented behavior, limitations, and planned work.
4. See [history and sanitization](docs/HISTORY_AND_SANITIZATION.md) for how the original Git history was preserved while credentials and private identifiers were removed.

## Repository layout

| Folder | Role |
| --- | --- |
| `versions/r1/` | Historical first application: quiz flow, results, and UI fixes |
| `versions/r2/` | Historical R2 main branch: frontend/backend application with Azure storage |
| `versions/r3/` | Snapshot of the R3 development branch from the R2 repository, including later web and iPad/offline work |
| `versions/r4/` | Current review focus: staged study, revision, assessment, and progress synchronization |
| `docs/` | Alignerr brief, chronology, verification results, and history-handling notes |

These are versioned application snapshots in one repository. They remain separate implementations; importing their histories does not combine their runtime features into a single application.

## Run the R4 application locally

Use Node.js 20 or later:

```sh
cd versions/r4/exam-app-template
npm ci
npm test
npm start
```

Open `http://127.0.0.1:4173`. Without `DATABASE_URL`, progress is stored in the browser's LocalStorage. The `.env.example` file contains configuration names and placeholders only. A fixed `APP_USER_ID` is not authentication; the historical cloud configuration is not a public multi-user deployment.

The repository is private. Existing study materials have not been cleared for public redistribution. No license granting redistribution rights is added by this integration.

## Continuing development

I plan to continue improving the application with Claude Code, including browser and database validation, study-data quality, coverage of missing topics, and usability improvements based on my study workflow. I also intend to keep using Claude Code across my other projects. These are plans, not claims that the work has already been completed.

Prepared for private Alignerr review on 2026-10-30. No access invitation or application submission is performed by creating this repository.
