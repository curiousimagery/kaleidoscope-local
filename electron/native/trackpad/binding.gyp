{
  "targets": [
    {
      "target_name": "fold_trackpad",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["trackpad.mm"],
          "libraries": ["-framework AppKit"],
          "xcode_settings": {
            "OTHER_CFLAGS": ["-fobjc-arc"],
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }]
      ]
    }
  ]
}
