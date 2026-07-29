use serde::{Deserialize, Serialize};
use url::Url;

/// An element picked by the user while reviewing a page in the in-app browser.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PickedElement {
    pub selector: String,
    pub tag: String,
    pub text_preview: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Restricts the in-app browser to localhost/127.0.0.1 (any port) and local
/// static HTML files — the feature's explicit scope is previewing a dev server
/// or a static file, not general internet browsing.
pub fn is_allowed_browser_url(candidate: &str) -> bool {
    let Ok(url) = Url::parse(candidate) else {
        return false;
    };

    match url.scheme() {
        "file" => true,
        "http" => matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")),
        _ => false,
    }
}

/// Parses the `treq-pick:<url-encoded-json>` pseudo-URL used by the script
/// injected into the preview webview to report a clicked element back to
/// Rust. The child webview is deliberately granted no Tauri IPC capability
/// (it may load untrusted-ish local content), so host<->guest messaging goes
/// through `on_navigation` URL interception instead of `invoke`.
pub fn parse_pick_payload(candidate: &str) -> Result<PickedElement, String> {
    const PREFIX: &str = "treq-pick:";
    let encoded = candidate
        .strip_prefix(PREFIX)
        .ok_or_else(|| format!("Not a {PREFIX} URL"))?;
    let decoded = urlencoding::decode(encoded)
        .map_err(|e| format!("Failed to url-decode pick payload: {e}"))?;
    serde_json::from_str(&decoded).map_err(|e| format!("Failed to parse pick payload: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_localhost_with_any_port() {
        assert!(is_allowed_browser_url("http://localhost:3000"));
        assert!(is_allowed_browser_url("http://localhost:5173/app?x=1"));
        assert!(is_allowed_browser_url("http://localhost/"));
    }

    #[test]
    fn allows_127_0_0_1_with_any_port() {
        assert!(is_allowed_browser_url("http://127.0.0.1:8080/"));
        assert!(is_allowed_browser_url("http://127.0.0.1/"));
    }

    #[test]
    fn allows_file_urls() {
        assert!(is_allowed_browser_url("file:///tmp/preview.html"));
        assert!(is_allowed_browser_url(
            "file:///home/user/project/index.html"
        ));
    }

    #[test]
    fn rejects_https_and_other_hosts() {
        assert!(!is_allowed_browser_url("https://example.com"));
        assert!(!is_allowed_browser_url("http://example.com"));
        assert!(!is_allowed_browser_url("http://192.168.1.5:3000"));
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(!is_allowed_browser_url("ftp://localhost/file"));
        assert!(!is_allowed_browser_url("javascript:alert(1)"));
        assert!(!is_allowed_browser_url("data:text/html,hi"));
    }

    #[test]
    fn rejects_malformed_urls() {
        assert!(!is_allowed_browser_url("not a url"));
        assert!(!is_allowed_browser_url(""));
    }

    #[test]
    fn parses_valid_pick_payload() {
        let element = PickedElement {
            selector: "#checkout > button.primary".to_string(),
            tag: "BUTTON".to_string(),
            text_preview: "Place order".to_string(),
            x: 10.5,
            y: 20.0,
            width: 120.0,
            height: 32.0,
        };
        let json = serde_json::to_string(&element).unwrap();
        let encoded = urlencoding::encode(&json);
        let url = format!("treq-pick:{encoded}");

        let parsed = parse_pick_payload(&url).expect("should parse");
        assert_eq!(parsed, element);
    }

    #[test]
    fn parses_pick_payload_with_special_characters_in_text() {
        let element = PickedElement {
            selector: "div.card[data-id=\"7\"]".to_string(),
            tag: "DIV".to_string(),
            text_preview: "50% off — \"today only\"".to_string(),
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
        let json = serde_json::to_string(&element).unwrap();
        let encoded = urlencoding::encode(&json);
        let url = format!("treq-pick:{encoded}");

        let parsed = parse_pick_payload(&url).expect("should parse");
        assert_eq!(parsed, element);
    }

    #[test]
    fn rejects_payload_without_prefix() {
        let err = parse_pick_payload("https://example.com").unwrap_err();
        assert!(err.contains("treq-pick:"));
    }

    #[test]
    fn rejects_malformed_json_payload() {
        let err = parse_pick_payload("treq-pick:not-json").unwrap_err();
        assert!(err.contains("Failed to parse pick payload"));
    }
}
