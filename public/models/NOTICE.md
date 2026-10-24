# u2netp-uint8.onnx

The model behind Remove background. It runs in the browser through
onnxruntime-web (MIT), is served only from this app's own origin, and is
checked against its SHA-256 (`MODEL_SHA256` in `web/src/bgremove/client.js`)
before use. Photos never leave the device.

- **Model:** U²-Net-p, the small U²-Net, from "U²-Net: Going Deeper with
  Nested U-Structure for Salient Object Detection" (Qin et al., Pattern
  Recognition 2020).
- **Source:** https://github.com/xuebinqin/U-2-Net. The ONNX export used is
  `u2netp.onnx` from https://github.com/danielgatis/rembg (release v0.0.0,
  4,574,861 bytes, sha256
  `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`).
- **Licence:** Apache License 2.0
  (https://www.apache.org/licenses/LICENSE-2.0), the licence of the U-2-Net
  repository and its weights.

## Changes made for Home Studio

- Only the final mask output (1×1×320×320) is kept; the side outputs and
  the nodes only they used were removed, and the graph was converted to
  ONNX opset 13.
- Every convolution weight is stored as uint8 per output channel and
  expanded by a `DequantizeLinear` node, so the file is about a quarter of
  the original size (1,261,298 bytes) while the convolutions still run in
  float32. On a test image the mask matches the original model's
  (IoU 0.998).
- Input: 1×3×320×320 float32, RGB divided by the image's brightest value,
  then normalised with ImageNet's mean (0.485, 0.456, 0.406) and standard
  deviation (0.229, 0.224, 0.225).

A replacement model must ship under a new file name with its new SHA-256:
the service worker keeps a cached copy of this one for good. Keep it small:
`tests/bgremove.test.js` refuses any model over 5 MB, because larger files
made the change too big to export.
