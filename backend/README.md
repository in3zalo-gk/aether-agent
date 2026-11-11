# Aether backend security notes

`POST /api/exec` runs a shell command as the same local user that starts the backend (the Termux app user when it runs in Termux). It is **not** a sandbox, container, or privilege boundary, and it does not elevate privileges. Treat the local API token as authorization to act with that user's existing file and process permissions.

The child shell receives a filtered copy of the backend environment: variables whose names contain `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `ACCESS_KEY`, or `CREDENTIAL` are removed. The configured `AETHER_LOCAL_TOKEN` is additionally redacted from returned stdout and stderr. This reduces accidental disclosure but does not make arbitrary shell commands safe.

On Android/Termux, the backend tries `chromium` and `chromium-browser` under the Termux prefix before `/usr/bin/chromium`; `CHROMIUM_PATH` overrides that lookup. Playwright is adapted by `playwright-runtime.js` solely so it can load on Android/Termux, which is not an officially supported Playwright host.
