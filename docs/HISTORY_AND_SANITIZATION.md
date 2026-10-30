# History preservation and sanitization

This repository was initially prepared for private review on 2026-10-30 and subsequently shared publicly at the owner's request. The source repositories were read only; their branches, files, visibility, and settings were not changed.

## Preserved history

- 115 unique source commits are retained across five imported source branches.
- All original author and committer timestamps, including timezone offsets, are preserved.
- The parent relationships of every source commit are preserved after mapping old commit IDs to sanitized commit IDs.
- R1/R2 shared ancestry is retained without duplicating the shared commits. R4 remains a separate historical root.
- Commits that only affected excluded files are retained as empty commits, so privacy cleanup does not erase the recorded development steps.
- Personal author contact details are normalized to the owner's GitHub noreply identity. Commit messages are preserved except where privacy or credential replacements were needed.
- The integration commit connects the R3 and R4 histories and adds separate version snapshots and reviewer documentation. All 115 source commits are reachable from these two parent histories.

The history was rewritten, so commit IDs differ from the originals. Original cryptographic commit signatures are not asserted to remain valid. The rewrite does not fabricate historical work or assistant attribution.

## Removed or anonymized across all imported branches

- Detected GitHub tokens, cloud connection credentials, and hardcoded application-access credential values.
- Other detected credential literals and their occurrences in historical files and messages.
- Private email addresses, machine home-directory names, cloud subscription identifiers, and observed deployment/resource identifiers.
- Local assistant configuration, operational backups, editor history, local caches, generated build output, private credential-file paths, and per-user Xcode state.
- EXIF and text metadata in historical PNG images, while preserving their image data.

Environment-variable names, placeholder examples, and application authentication/synchronization logic remain where they are part of the implementation. Historical deployment instructions may now contain redacted placeholders and require new environment configuration before use.

No credential values, raw scanner findings, raw source mirrors, or private redaction lists are included in this repository. Removal from this review copy does not revoke a credential or remove it from the original repositories. Credential revocation and rotation were not performed during this integration.

## Checks

Gitleaks and a separate object-level audit are used to check all imported histories, including the non-default source branches and commit metadata. The object audit also checks for the exact previously detected values, credential formats, private email addresses, and excluded paths. See [validation](VALIDATION.md) for the recorded results and limits.

Issues, pull requests, review comments, release assets, and deployment environments are not part of Git history and were not migrated. No original source tags were present at the time of the snapshot.

## Access and study materials

The destination repository was initially private and was subsequently made public at the owner's request. Public visibility permits anyone to read and clone the repository. No collaborator invitations were sent and no application deployment was published. Before publication, the owner explicitly confirmed the rights or permission to publish the included question text, explanations, past-exam data, and their complete Git history. This integration adds no general redistribution license to those materials.
