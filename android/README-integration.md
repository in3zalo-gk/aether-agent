# Aether Agent — Android native host

This directory is a standalone, native Java Android application (`app.aether.agent`). It is intentionally separate from the web frontend and server. The app loads only `https://aether-secure.pages.dev`; AI, chat, account and credential handling remain on the server/site.

## Build

Requirements: Android SDK platform 36, Build Tools 36, JDK 17 and Gradle 9.7.1 (the wrapper is included).

```sh
./gradlew assembleDebug
```

For a signed release, keep the keystore outside this repository and pass it only through environment variables:

```sh
AETHER_STORE_FILE=/secure/path/aether-release.jks \
AETHER_STORE_PASSWORD='...' AETHER_KEY_ALIAS=aether \
AETHER_KEY_PASSWORD='...' ./gradlew assembleRelease
```

`*.jks`, `*.keystore`, local SDK settings and build products are ignored. Do not put signing secrets in Gradle files, source code, the site, or chat messages.

## Web integration contract

On the exact top-level HTTPS origin `https://aether-secure.pages.dev`, AndroidX WebKit injects the optional `window.AetherNative` message port:

```js
AetherNative.addEventListener('message', event => {
  // JSON.parse(event.data) => { id, ok, result?, error? }
})
AetherNative.postMessage(JSON.stringify({ id, action, args }))
```

The native listener uses AndroidX `WebViewCompat.addWebMessageListener` with that exact allowed origin and rejects every message that is not from the main frame. No `addJavascriptInterface` bridge is registered.

Before the first action in an app session, the user must explicitly enable native actions for the allowlisted chat. Every command except `browserVisible` and `browserClose` then shows its own native confirmation dialog. There is no arbitrary JavaScript, shell, root, file, camera, microphone, contact, SMS, notification, account or package-wide inspection API.

Supported actions:

- `listApps` — only apps with launcher activities, through Android package visibility queries.
- `launchApp({package})` — launch an installed, launchable app after confirmation.
- `accessibilitySettings` — opens the system setting so the user manually enables/disables the optional service.
- `deviceSnapshot`, `deviceTap({index})`, `deviceText({index,text})` — foreground-only accessibility operations after confirmation. `index` must come from the current accessibility snapshot; taps invoke the indexed clickable node (or clickable ancestor), and text targets the indexed editable node. They fail until the user grants the service. Sensitive banking/wallet/payment/auth packages and password fields are blocked/redacted.
- `browserOpen({url})`, `browserNavigate({url})`, `browserSnapshot`, `browserClick({selector})`, `browserType({selector?,text})`, `browserVisible`, `browserClose` — isolated local browser commands.

The local browser is an on-device WebView overlay with title, back and close controls. It has **no native JavaScript bridge**. Navigation is public HTTPS only; file/content/data/custom schemes, localhost and resolved loopback, link-local, site-local, multicast and unspecified IP addresses are rejected. Browser snapshots return capped rendered text plus numbered links. Click only accepts a snapshot link number; type refuses password inputs. Screenshot capture is deliberately not implemented.

## Security model

- Main WebView: HTTPS exact-host allowlist, no cleartext/mixed content, no file/content access, no universal file access, `FLAG_SECURE` and a legacy bridge guarded by the current top-level frontend origin.
- AndroidX WebMessageListener is not used because this project deliberately has no external dependencies. The legacy bridge exposes only the small request/version surface and requires native user confirmation per action.
- App backup is disabled. `MainActivity` is the sole exported launch component. The accessibility service is exported only because Android requires it for system binding and is protected by `BIND_ACCESSIBILITY_SERVICE`.
- The accessibility service collects no events in the background, has no network code, and can be revoked at any time from Android Accessibility settings.
- The app never performs purchases, authentication, sending or deletion actions. It does not use root, shell commands, or arbitrary browser script execution.

A release signature proves publisher continuity only; it does not make a WebView bridge or third-party site inherently safe. Review the deployed frontend origin, Android platform WebView updates and all native changes before distribution.
