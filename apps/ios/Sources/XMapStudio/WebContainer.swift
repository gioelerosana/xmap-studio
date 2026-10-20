import SwiftUI
import UIKit
import WebKit

/// La UI web di XMap Studio dentro un WKWebView a tutto schermo.
struct WebContainer: UIViewRepresentable {
    func makeCoordinator() -> WebCoordinator { WebCoordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        let handler = AppSchemeHandler()
        if let handler {
            configuration.setURLSchemeHandler(handler, forURLScheme: AppSchemeHandler.scheme)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 37 / 255, green: 37 / 255, blue: 37 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        // Lo scroll è gestito dalla mappa (pan, pinch): niente rimbalzo né zoom nativi.
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif

        if handler != nil {
            webView.load(URLRequest(url: AppSchemeHandler.startURL))
        } else {
            webView.loadHTMLString(
                "<meta name=viewport content='width=device-width'><body style='font:17px -apple-system;color:#eee;background:#252525;padding:2em'>"
                    + "<h2>Build web mancante</h2><p>La cartella <code>web</code> non è nel bundle. Esegui <code>apps/ios/scripts/prepare-web.sh</code> e ricompila.</p>",
                baseURL: nil
            )
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
