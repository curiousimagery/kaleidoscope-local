{
  "targets": [
    {
      "target_name": "fold_ndi",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["ndi.c"],
          "include_dirs": ["sdk/include"],
          "libraries": ["<(module_root_dir)/sdk/lib/macOS/libndi.dylib"],
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "13.0",
            "OTHER_LDFLAGS": ["-Wl,-rpath,<(module_root_dir)/sdk/lib/macOS"]
          }
        }]
      ]
    }
  ]
}
