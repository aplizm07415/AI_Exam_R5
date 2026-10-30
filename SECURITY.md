# Security and review configuration

Keep credentials in environment variables or an appropriate secret store. Do not commit real `.env` files, API/session keys, cookies, browser storage state, operational backups, or private account configuration. Use the included `.env.example` files only as configuration-name references.

The R4 application is a personal study tool. A fixed `APP_USER_ID` identifies a storage partition and is not authentication. Historical versions and cloud setup instructions require separate security review before any externally accessible deployment.

This portfolio contains sanitized development history. The original source repositories were not modified, and previously used credentials were not revoked as part of this integration. See [history and sanitization](docs/HISTORY_AND_SANITIZATION.md) and [validation](docs/VALIDATION.md).
