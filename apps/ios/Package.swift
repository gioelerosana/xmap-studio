// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "XMapStudio",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        // Un progetto xtool contiene esattamente un prodotto library: l'app.
        .library(
            name: "XMapStudio",
            targets: ["XMapStudio"]
        ),
    ],
    targets: [
        .target(
            name: "XMapStudio"
        ),
    ],
    // Il wrapper è un guscio sottile attorno alla UI web: niente concorrenza stretta di Swift 6.
    swiftLanguageModes: [.v5]
)
