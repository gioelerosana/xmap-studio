import SwiftUI

@main
struct XMapStudioApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()
                .background(Color(red: 37 / 255, green: 37 / 255, blue: 37 / 255))
                // File .xmind condivisi o aperti da un'altra app (Condividi, Apri in).
                .onOpenURL { FileInbox.shared.receive($0) }
        }
    }
}
