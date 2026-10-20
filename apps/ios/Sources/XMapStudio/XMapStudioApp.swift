import SwiftUI

@main
struct XMapStudioApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()
                .background(Color(red: 37 / 255, green: 37 / 255, blue: 37 / 255))
        }
    }
}
