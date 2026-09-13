# Mobile release pipeline

`.github/workflows/mobile-release.yml` builds `mobile/` for Android and iOS,
signs both, and uploads to the Play Store **internal testing** track and
TestFlight **internal testing** group. It runs on `workflow_dispatch` or a
`mobile-v*` tag push - never on every push, since it uploads to real store
listings.

Both platforms build the real `crates/treq-mobile-ssh` native library for
release (see `mobile/android/app/build.gradle`'s `buildTreqMobileSshNativeLibs`
task and `mobile/scripts/build-ios-xcframework.sh`), so an app built by this
workflow is the same code path as `android-build`/`ios-build` in
`mobile.yml`, just release-configured and signed.

## Required GitHub secrets

### Android (Play Store)

| Secret | What it is |
| --- | --- |
| `TREQ_ANDROID_KEYSTORE_BASE64` | `base64 -i release.keystore` of your upload keystore. Generate one with `keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -alias treq-upload -keystore release.keystore` and keep it somewhere safe outside the repo - losing it means you can never update the app under the same listing. |
| `TREQ_ANDROID_KEYSTORE_PASSWORD` | Keystore password. |
| `TREQ_ANDROID_KEY_ALIAS` | Key alias (`treq-upload` above). |
| `TREQ_ANDROID_KEY_PASSWORD` | Key password (often the same as the keystore password). |
| `TREQ_PLAY_STORE_JSON_KEY_BASE64` | `base64 -i key.json` of a Google Play Console **service account** JSON key with "Release manager" access to the app, created under Play Console -> Setup -> API access. |

The app (`com.treq.mobile`) must already exist in Play Console with at least
one manual upload before the API can push to it (Google requires the first
APK/AAB to be uploaded through the console).

### iOS (TestFlight)

Signing uses [fastlane match](https://docs.fastlane.tools/actions/match/)
against a private git repo holding your distribution certificate + App
Store provisioning profile, authenticated with an App Store Connect API key
(no Apple ID password/2FA needed in CI).

| Secret | What it is |
| --- | --- |
| `TREQ_APPLE_ID` | The Apple ID email on the developer account. |
| `TREQ_APPLE_TEAM_ID` | Developer Portal team ID. |
| `TREQ_ITC_TEAM_ID` | App Store Connect team ID (same as above for most single-team accounts). |
| `TREQ_ASC_KEY_ID` | App Store Connect API key ID (Users and Access -> Keys). |
| `TREQ_ASC_ISSUER_ID` | App Store Connect API issuer ID (same page). |
| `TREQ_ASC_KEY_CONTENT` | Base64 of the downloaded `.p8` key file (`base64 -i AuthKey_XXXX.p8`). |
| `TREQ_MATCH_GIT_URL` | Git URL of the private repo `match` stores certs/profiles in (run `fastlane match init` once, locally, to create it). |
| `TREQ_MATCH_PASSWORD` | Passphrase `match` uses to encrypt that repo's contents. |

The app (`com.treq.mobile`) must already exist in App Store Connect, and
`fastlane match appstore` must have been run once locally (by someone with
account access) to generate and store the distribution cert + profile before
CI can run in `readonly` mode.

## What "dev and testing" means here

- Android uploads land on the **internal testing** track
  (`release_status: completed`), visible immediately to testers added to
  that track in Play Console - not a public/production release.
- iOS uploads go to TestFlight with `distribute_external: false`, so they
  reach only internal testers (people with an App Store Connect role on the
  app) and never go through App Review or reach public TestFlight links.

Promoting either to a wider audience is a manual step in the respective
console - this pipeline deliberately stops short of that.

## Known gap

The iOS half wires a freshly-built `TreqMobileSsh.xcframework` into the
Xcode project via a local CocoaPods pod (`mobile/ios/TreqMobileSsh.podspec`)
and `mobile/scripts/build-ios-xcframework.sh`. This has not been run against
a real Apple Developer signing identity yet - the first real run of the
`ios` job is the actual verification of the signing + TestFlight upload
path, the same way `mobile/README.md` notes for `ios-build` in the PR-check
workflow.
