# Local camera models

Camera assets are served by this application. Frames stay in browser memory; only security event metadata is sent to the API.

## Visible phone detection

- Model: EfficientDet-Lite2, int8, version 1, COCO labels.
- Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite
- Saved as: `efficientdet_lite2_int8.tflite` (7,515,971 bytes).
- SHA-256: `b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896`.
- MediaPipe guide: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js

Only the model's `cell phone` category is enabled, with confidence >= 0.45. Phone checks run at most once every 800 ms in their own worker. Repeated detections over at least 1.2 seconds raise one alert; 2 seconds of clear samples rearm it. These are initial thresholds, not a measured accuracy guarantee. Review behavior with actual event cameras before choosing a response mode.

The feature flags possible phones visible to the camera. It cannot determine whether a phone is recording, detect off-camera devices, or reliably identify every partially hidden phone, tablet, or laptop. Lighting, size, angle, and occlusion affect results.

Face checking uses `blaze_face_short_range.tflite`. Wasm files must match the installed `@mediapipe/tasks-vision` package; module workers use `vision_wasm_module_internal.js` and `.wasm`.
