import Foundation
import WebKit

/// File arrivati da altre app (Condividi, Apri in, File): li legge e li consegna alla UI
/// web con `window.xmapReceiveFile(nome, base64)` (`apps/web/src/app/incomingFiles.ts`).
/// Quelli arrivati prima che la pagina sia caricata (avvio a freddo) aspettano in coda.
@MainActor
final class FileInbox {
    static let shared = FileInbox()

    private weak var webView: WKWebView?
    private var pending: [(name: String, data: Data)] = []

    func receive(_ url: URL) {
        guard url.isFileURL else { return }
        // Con LSSupportsOpeningDocumentsInPlace l'URL è quello originale, fuori dalla sandbox.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var coordinatorError: NSError?
        var data: Data?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
            data = try? Data(contentsOf: readURL)
        }
        guard let data else { return }
        pending.append((url.lastPathComponent, data))
        flush()
    }

    func webViewDidLoad(_ webView: WKWebView) {
        self.webView = webView
        flush()
    }

    private func flush() {
        guard let webView else { return }
        while !pending.isEmpty {
            let file = pending.removeFirst()
            webView.callAsyncJavaScript(
                "window.xmapReceiveFile?.(name, data)",
                arguments: ["name": file.name, "data": file.data.base64EncodedString()],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }
}
