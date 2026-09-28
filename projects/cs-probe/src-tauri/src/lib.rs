//! Seams probe native shell. It hosts the same web build as the PWA; the Rust core runs as WASM in the
//! webview (the platform shell is a seam — Core & Seams SEAMS.md). The shell adds only what the web
//! can't do: native file pickers now; a wasmtime module host later (DOCTRINE §7).

use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default());
            // tao builds the iOS window from inner_size, so desktop sizes stay desktop-only
            // (memory: tauri-ios-full-screen-needs-three-fixes, fix 1 of 3).
            #[cfg(desktop)]
            let builder = builder.title("Seams probe").inner_size(1100.0, 760.0).min_inner_size(400.0, 600.0);
            let window = builder.build()?;
            // Fix 2 of 3 (fix 3 is the status-bar keys in Info.ios.plist).
            #[cfg(target_os = "ios")]
            cover_the_screen(&window)?;
            #[cfg(not(target_os = "ios"))]
            let _ = window;
            Ok(())
        })
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(|_, _| {}),
        Err(e) => eprintln!("cs-probe: could not start: {e}"),
    }
}

/// Let the page have the whole screen, home-indicator strip included. wry never sets the
/// WKWebView scroll view's contentInsetAdjustmentBehavior, so UIKit insets the content by the
/// bottom safe area before WebKit lays out, and viewport-fit=cover can't reclaim it. `never` (2)
/// hands WebKit the full bounds. Found on the iPad in tauri-v2-sandbox (S6·7).
#[cfg(target_os = "ios")]
fn cover_the_screen<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    use objc2::runtime::AnyObject;
    window.with_webview(|webview| {
        let wk = webview.inner().cast::<AnyObject>();
        if wk.is_null() {
            return;
        }
        // SAFETY: inner() is wry's live WKWebView and with_webview runs on the main thread, where
        // UIKit requires it. Every WKWebView has scrollView, and the setter takes an NSInteger.
        unsafe {
            let scroll: *mut AnyObject = objc2::msg_send![wk, scrollView];
            if !scroll.is_null() {
                let () = objc2::msg_send![scroll, setContentInsetAdjustmentBehavior: 2_isize];
            }
        }
    })
}
