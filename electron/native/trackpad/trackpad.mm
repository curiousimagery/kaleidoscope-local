// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/native/trackpad/trackpad.mm — native macOS trackpad gestures.
//
// Chromium forwards trackpad PINCH to the renderer (ctrl+wheel) but swallows
// ROTATE entirely, and browsers get neither as first-class gestures. This tiny
// N-API addon installs an NSEvent LOCAL monitor (our app's windows only) for
// magnify + rotate and streams the deltas to JS through a threadsafe function.
// The events pass through unchanged (return event), so Chromium's own handling
// (e.g. the ctrl+wheel pinch synthesis) is unaffected.
//
// Raw N-API (no node-addon-api dependency) — ABI-stable across Node/Electron,
// so one build works in both. macOS-only by definition; the bridge guards.

#import <AppKit/AppKit.h>
#include <node_api.h>
#include <stdlib.h>

typedef struct { int type; double delta; } GestureEvent;   // type: 1 magnify, 2 rotate

static napi_threadsafe_function g_tsfn = NULL;
static id g_monitor = nil;

// main-thread → JS thread hop: build { type, delta } and invoke the JS callback
static void CallJs(napi_env env, napi_value js_cb, void* ctx, void* data) {
  GestureEvent* ev = (GestureEvent*)data;
  if (env != NULL && js_cb != NULL) {
    napi_value undefined, obj, v;
    napi_get_undefined(env, &undefined);
    napi_create_object(env, &obj);
    napi_create_string_utf8(env, ev->type == 1 ? "magnify" : "rotate", NAPI_AUTO_LENGTH, &v);
    napi_set_named_property(env, obj, "type", v);
    napi_create_double(env, ev->delta, &v);
    napi_set_named_property(env, obj, "delta", v);
    napi_call_function(env, undefined, js_cb, 1, &obj, NULL);
  }
  free(data);
}

static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (g_tsfn != NULL || argc < 1) return NULL;   // already running / no callback

  napi_value name;
  napi_create_string_utf8(env, "fold-trackpad", NAPI_AUTO_LENGTH, &name);
  napi_status st = napi_create_threadsafe_function(
      env, args[0], NULL, name,
      64,        // bounded queue — gesture bursts drop oldest-style via nonblocking calls
      1,         // one producer thread (the AppKit main thread)
      NULL, NULL, NULL,
      CallJs, &g_tsfn);
  if (st != napi_ok) { g_tsfn = NULL; return NULL; }
  // the monitor must never keep the process alive on its own
  napi_unref_threadsafe_function(env, g_tsfn);

  dispatch_async(dispatch_get_main_queue(), ^{
    if (g_monitor != nil) return;
    g_monitor = [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskMagnify | NSEventMaskRotate)
      handler:^NSEvent* (NSEvent* event) {
        if (g_tsfn != NULL) {
          GestureEvent* ev = (GestureEvent*)malloc(sizeof(GestureEvent));
          if (event.type == NSEventTypeMagnify) { ev->type = 1; ev->delta = event.magnification; }
          else { ev->type = 2; ev->delta = -event.rotation; }   // NSEvent rotate is CCW-positive; emit clockwise-positive (screen-natural)
          if (napi_call_threadsafe_function(g_tsfn, ev, napi_tsfn_nonblocking) != napi_ok) free(ev);
        }
        return event;   // pass through — Chromium's own gesture handling continues
      }];
  });
  return NULL;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (g_monitor != nil) { [NSEvent removeMonitor:g_monitor]; g_monitor = nil; }
  });
  if (g_tsfn != NULL) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
  }
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, NULL, &fn);
  napi_set_named_property(env, exports, "stop", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
