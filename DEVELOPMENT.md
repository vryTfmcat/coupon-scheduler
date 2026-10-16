# Development ownership

This project is maintained from one working checkout on Mac. Other devices may run the built Obsidian plugin, but do not keep an editable development copy.

## Changing development machines

1. Save and review all source changes; run tests and the production build.
2. Commit and push the complete source history. Back up any untracked private inputs separately.
3. Clone the repository on the destination and restore private files outside Git.
4. Verify the commit, install dependencies and rerun tests/build.
5. Retire the old editable checkout only after verification; update the private project index.

Plugin business data stays in the user's Vault and is never bundled with source or releases. Credentials, local plugin settings, personal migration inputs and repair backups must not enter Git. Install only `main.js`, `manifest.json` and `styles.css`; do not overwrite `data.json`.
