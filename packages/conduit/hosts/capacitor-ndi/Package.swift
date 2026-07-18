// swift-tools-version: 5.9
import PackageDescription

// The NDI xcframework is BUILT LOCALLY from the licensed Vizrt SDK install
// (scripts/make-xcframework.sh → ios/ndi.xcframework, .gitignored). Run the
// script once per machine before the first iOS build. libndi is C++ inside,
// hence the c++ linker setting.
// Package/product names follow the npm package name (Capacitor's generated
// CapApp-SPM requires product "ConduitNdiCapacitor"); the Swift plugin class
// and its jsName stay FoldNdi… — renaming those is app-facing churn for later.
let package = Package(
    name: "ConduitNdiCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "ConduitNdiCapacitor",
            targets: ["FoldNdiPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .binaryTarget(name: "NDIlib", path: "ios/ndi.xcframework"),
        .target(
            name: "FoldNdiPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "NDIlib"
            ],
            path: "ios/Sources/FoldNdiPlugin",
            linkerSettings: [
                .linkedLibrary("c++")
            ])
    ]
)
