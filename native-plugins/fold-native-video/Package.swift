// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FoldNativeVideo",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "FoldNativeVideo",
            targets: ["FoldNativeVideoPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "FoldNativeVideoPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/FoldNativeVideoPlugin")
    ]
)
