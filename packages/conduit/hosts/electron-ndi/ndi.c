// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/native/ndi/ndi.c — the NDI sender, bound for node.
//
// Publishes the program output as an NDI network source (Resolume Arena / OBS /
// any NDI receiver on the LAN lists it like a camera). Wraps the Vizrt NDI SDK's
// send API: start(name) creates the named sender, publish(rgba, w, h, topDown)
// sends one frame, stop() removes the source from the network.
//
// Raw N-API (the fold_trackpad precedent — no node-addon-api dependency), so one
// build is ABI-stable across Node and Electron. Links against libndi.dylib from
// the locally installed SDK via the space-free `sdk` symlink beside this file
// (→ /Library/NDI SDK for Apple); the SDK is a LICENSED install, never a silent
// dependency — see BACKLOG "NDI out". Distribution builds must bundle the
// redistributable libndi per the SDK's redist terms (a build-dmg follow-up).
//
// Frames arrive as raw RGBA from the output bus (the same bytes Syphon gets).
// NDI frames are always top-down; a bottom-up frame (legacy FBO path) is row-
// flipped into a scratch buffer here. NDIlib_send_send_video_v2 is the
// SYNCHRONOUS variant — the SDK copies before returning, so the V8-owned buffer
// can't be invalidated under the send.

#include <node_api.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <Processing.NDI.Lib.h>

static bool g_ndi_ok = false;
static NDIlib_send_instance_t g_send = NULL;
static uint8_t* g_flip = NULL;
static size_t g_flip_cap = 0;

static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char name[256] = "Fold";
  if (argc >= 1) {
    size_t n = 0;
    napi_get_value_string_utf8(env, argv[0], name, sizeof(name), &n);
    if (n == 0) strcpy(name, "Fold");
  }
  if (!g_ndi_ok) g_ndi_ok = NDIlib_initialize();
  napi_value out;
  if (!g_ndi_ok) { napi_get_boolean(env, false, &out); return out; }
  if (g_send) { NDIlib_send_destroy(g_send); g_send = NULL; }   // recreate cleanly (name change)
  NDIlib_send_create_t desc;
  memset(&desc, 0, sizeof(desc));
  desc.p_ndi_name = name;
  g_send = NDIlib_send_create(&desc);
  napi_get_boolean(env, g_send != NULL, &out);
  return out;
}

static napi_value Publish(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (!g_send || argc < 3) return NULL;

  void* data = NULL;
  size_t len = 0;
  napi_typedarray_type type;
  napi_value arraybuffer;
  size_t offset;
  if (napi_get_typedarray_info(env, argv[0], &type, &len, &data, &arraybuffer, &offset) != napi_ok) return NULL;

  uint32_t w = 0, h = 0;
  bool top_down = true;
  napi_get_value_uint32(env, argv[1], &w);
  napi_get_value_uint32(env, argv[2], &h);
  if (argc >= 4) napi_get_value_bool(env, argv[3], &top_down);
  if (!data || !w || !h || len < (size_t)w * h * 4) return NULL;

  uint8_t* pixels = (uint8_t*)data;
  const size_t stride = (size_t)w * 4;
  if (!top_down) {
    const size_t total = stride * h;
    if (g_flip_cap < total) {
      free(g_flip);
      g_flip = (uint8_t*)malloc(total);
      g_flip_cap = g_flip ? total : 0;
    }
    if (!g_flip) return NULL;
    for (uint32_t y = 0; y < h; y++) {
      memcpy(g_flip + (size_t)y * stride, pixels + (size_t)(h - 1 - y) * stride, stride);
    }
    pixels = g_flip;
  }

  NDIlib_video_frame_v2_t frame;
  memset(&frame, 0, sizeof(frame));
  frame.xres = (int)w;
  frame.yres = (int)h;
  frame.FourCC = NDIlib_FourCC_video_type_RGBA;
  frame.frame_rate_N = 30000;                       // nominal; receivers pace on arrival
  frame.frame_rate_D = 1000;
  frame.picture_aspect_ratio = (float)w / (float)h;
  frame.frame_format_type = NDIlib_frame_format_type_progressive;
  frame.timecode = NDIlib_send_timecode_synthesize;
  frame.line_stride_in_bytes = (int)stride;
  frame.p_data = pixels;
  NDIlib_send_send_video_v2(g_send, &frame);        // synchronous: SDK copies before returning
  return NULL;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
  (void)info;
  if (g_send) { NDIlib_send_destroy(g_send); g_send = NULL; }   // the source leaves the network
  napi_value undef;
  napi_get_undefined(env, &undef);
  return undef;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  napi_create_function(env, "publish", NAPI_AUTO_LENGTH, Publish, NULL, &fn);
  napi_set_named_property(env, exports, "publish", fn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, NULL, &fn);
  napi_set_named_property(env, exports, "stop", fn);
  return exports;
}

NAPI_MODULE(fold_ndi, Init)
