use crate::core::browser_review::{is_allowed_browser_url, parse_pick_payload};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};

/// Label of the native child webview embedded inside the main window to
/// preview a page for review. Deliberately does not match any `windows`
/// glob in `capabilities/default.json`, so it is granted zero Tauri IPC
/// permissions — loaded page content cannot call back into the app via
/// `invoke`. Host<->guest messaging instead goes through `on_navigation`
/// URL-scheme interception (see `PICK_URL_PREFIX` below) and one-way
/// `eval()` calls from Rust to the guest.
const BROWSER_WEBVIEW_LABEL: &str = "browser-preview";

/// Scheme used by the injected page script to report a clicked element back
/// to Rust. See `crate::core::browser_review::parse_pick_payload`.
const PICK_URL_PREFIX: &str = "treq-pick:";

/// Injected into every page load in the preview webview. Adds a hover
/// highlight and a capture-phase click listener, active only while
/// `window.__treqSelectMode` is true (toggled from Rust via `eval`).
const SELECTION_SCRIPT: &str = r##"(function () {
  if (window.__treqBrowserReviewInstalled) return;
  window.__treqBrowserReviewInstalled = true;
  window.__treqSelectMode = false;

  var HIGHLIGHT_STYLE = "outline: 2px solid #1e3a8a !important; outline-offset: -2px !important; cursor: crosshair !important;";
  var hovered = null;

  function cssSelector(el) {
    if (el.id) return "#" + el.id;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var part = node.tagName.toLowerCase();
      if (node.classList.length) {
        part += "." + Array.prototype.slice.call(node.classList, 0, 2).join(".");
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function selfOnlyHtml(el) {
    var clone = el.cloneNode(false);
    var html = clone.outerHTML || "";
    // Defensive cap only (e.g. against a huge inline data-URI attribute) --
    // the real prompt-facing truncation happens in browser-panel/utils.ts.
    return html.length > 2000 ? html.slice(0, 2000) : html;
  }

  document.addEventListener("mouseover", function (e) {
    if (!window.__treqSelectMode) return;
    if (hovered) hovered.style.cssText = hovered.__treqPrevStyle || "";
    hovered = e.target;
    hovered.__treqPrevStyle = hovered.style.cssText;
    hovered.style.cssText += HIGHLIGHT_STYLE;
  }, true);

  document.addEventListener("click", function (e) {
    if (!window.__treqSelectMode) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var rect = el.getBoundingClientRect();
    var payload = {
      selector: cssSelector(el),
      tag: el.tagName,
      text_preview: (el.textContent || "").trim().slice(0, 140),
      html_snippet: selfOnlyHtml(el),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
    window.location.href = "treq-pick:" + encodeURIComponent(JSON.stringify(payload));
  }, true);
})();"##;

fn parse_allowed_url(url: &str) -> Result<Url, String> {
    if !is_allowed_browser_url(url) {
        return Err(format!(
            "URL not allowed in the in-app browser (only http://localhost, http://127.0.0.1 and file:// are supported): {url}"
        ));
    }
    Url::parse(url).map_err(|e| format!("Failed to parse URL: {e}"))
}

/// Opens (or navigates, if already open) the embedded page-preview webview
/// at the given position/size, overlaying a placeholder in the React
/// `BrowserPanel`. Creating a child webview must happen on the main thread,
/// hence `async` (matches Tauri's own documented pattern for this API).
#[tauri::command]
pub async fn open_browser_webview(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = parse_allowed_url(&url)?;

    if let Some(webview) = app.get_webview(BROWSER_WEBVIEW_LABEL) {
        webview.navigate(parsed).map_err(|e| e.to_string())?;
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let app_for_nav = app.clone();
    let builder = WebviewBuilder::new(BROWSER_WEBVIEW_LABEL, WebviewUrl::External(parsed))
        .initialization_script(SELECTION_SCRIPT)
        .on_navigation(move |nav_url| {
            let nav_str = nav_url.as_str();
            if nav_str.starts_with(PICK_URL_PREFIX) {
                match parse_pick_payload(nav_str) {
                    Ok(element) => {
                        let _ = app_for_nav.emit("browser-element-picked", element);
                    }
                    Err(err) => {
                        log::warn!("Failed to parse browser pick payload: {err}");
                    }
                }
                false
            } else {
                let _ = app_for_nav.emit("browser-url-changed", nav_str.to_string());
                true
            }
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn navigate_browser_webview(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_allowed_url(&url)?;
    let webview = app
        .get_webview(BROWSER_WEBVIEW_LABEL)
        .ok_or_else(|| "Browser preview is not open".to_string())?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_browser_webview(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_WEBVIEW_LABEL) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_browser_select_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_WEBVIEW_LABEL)
        .ok_or_else(|| "Browser preview is not open".to_string())?;
    webview
        .eval(format!("window.__treqSelectMode = {enabled};"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_browser_webview_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_WEBVIEW_LABEL)
        .ok_or_else(|| "Browser preview is not open".to_string())?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_disallowed_url_before_touching_any_webview() {
        let err = parse_allowed_url("https://example.com").unwrap_err();
        assert!(err.contains("not allowed"));
    }

    #[test]
    fn accepts_localhost_url() {
        assert!(parse_allowed_url("http://localhost:5173/app").is_ok());
    }
}
