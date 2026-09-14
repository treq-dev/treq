package com.treq.mobile.screenshots

import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.treq.mobile.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import tools.fastlane.screengrab.Screengrab
import tools.fastlane.screengrab.locale.LocaleTestRule
import tools.fastlane.screengrab.uiautomator.UiAutomatorScreenshotStrategy

/**
 * Screens captured here become the Play Store listing screenshots via
 * `fastlane screengrab` (see ../../../../../../fastlane/Screengrabfile and
 * `fastlane android screenshots`). Each `Screengrab.screenshot` call is one
 * named screenshot; add a wait for the relevant screen's content before
 * capturing it.
 */
@RunWith(AndroidJUnit4::class)
class ScreenshotTest {

    @get:Rule
    val localeTestRule = LocaleTestRule()

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    private val device: UiDevice =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @Test
    fun capture() {
        Screengrab.setDefaultScreenshotStrategy(UiAutomatorScreenshotStrategy())

        // The RN JS bundle mounts asynchronously; wait for the app's root
        // view to appear before taking the first screenshot.
        device.wait(Until.hasObject(By.pkg("com.treq.mobile").depth(0)), 10_000)
        Screengrab.screenshot("01_home")

        // Add further navigation + Screengrab.screenshot("0N_screen_name")
        // calls here as more screens are ready to be captured.
    }
}
