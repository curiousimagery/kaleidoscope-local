// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.1"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorPreferences", path: "../../../node_modules/@capacitor/preferences"),
        .package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share"),
        .package(name: "FoldExternalDisplay", path: "../../../native-plugins/fold-external-display"),
        .package(name: "FoldNativeCamera", path: "../../../native-plugins/fold-native-camera"),
        .package(name: "ConduitNdiCapacitor", path: "../../../packages/conduit/hosts/capacitor-ndi")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "FoldExternalDisplay", package: "FoldExternalDisplay"),
                .product(name: "FoldNativeCamera", package: "FoldNativeCamera"),
                .product(name: "ConduitNdiCapacitor", package: "ConduitNdiCapacitor")
            ]
        )
    ]
)
