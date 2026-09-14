import XCTest

/// Screens captured here become the App Store screenshots via
/// `fastlane snapshot` (see ../fastlane/Snapfile and `fastlane ios
/// screenshots`). Each `snapshot("name")` call is one named screenshot.
final class ScreenshotTests: XCTestCase {

    override class var runsForEachTargetApplicationUIConfiguration: Bool { false }

    @MainActor
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCaptureScreenshots() throws {
        let app = XCUIApplication()
        setupSnapshot(app)
        app.launch()

        // The RN JS bundle mounts asynchronously; wait for the app's root
        // view before taking the first screenshot.
        _ = app.wait(for: .runningForeground, timeout: 10)
        snapshot("01_home")

        // Add further navigation + snapshot("0N_screen_name") calls here as
        // more screens are ready to be captured.
    }
}
