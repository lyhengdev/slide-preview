import { FaceDetector, FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { PHONE_SCORE_THRESHOLD, type CameraResult, type CameraWorkerMessage, type DetectorKind } from "../lib/camera-detection";

// Separate worker instances keep each task's Wasm runtime isolated.
let faceDetector: FaceDetector | null = null;
let phoneDetector: ObjectDetector | null = null;
let initialization: Promise<void> | null = null;
let kind: DetectorKind;

function send(message: CameraWorkerMessage) {
  postMessage(message);
}

async function init(detectorKind: DetectorKind): Promise<void> {
  kind = detectorKind;
  const mediaBase = new URL(`${import.meta.env.BASE_URL}mediapipe`, self.location.origin).href;
  const fileset = await FilesetResolver.forVisionTasks(mediaBase, true);
  if (kind === "phone") {
    phoneDetector = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${mediaBase}/efficientdet_lite2_int8.tflite`, delegate: "CPU" },
      runningMode: "IMAGE",
      categoryAllowlist: ["cell phone"],
      scoreThreshold: PHONE_SCORE_THRESHOLD,
      maxResults: 3,
    });
  } else {
    faceDetector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${mediaBase}/blaze_face_short_range.tflite`, delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.55,
    });
  }
}

type WorkerMessage = { type: "init"; kind: DetectorKind } | { type: "frame"; bitmap: ImageBitmap };

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === "init") {
    try {
      initialization ??= init(event.data.kind);
      await initialization;
      send({ type: "ready" });
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : "Could not load detection model" });
    }
    return;
  }

  const bitmap = event.data.bitmap;
  try {
    let result: CameraResult;
    if (kind === "phone" && phoneDetector) {
      const detections = phoneDetector.detect(bitmap).detections;
      result = { type: "result", kind, phones: detections.length, confidence: Math.max(0, ...detections.flatMap((d) => d.categories.map((c) => c.score))) };
    } else if (kind === "face" && faceDetector) {
      const detections = faceDetector.detect(bitmap).detections;
      result = { type: "result", kind, faces: detections.length, confidence: detections.length ? Math.min(...detections.flatMap((d) => d.categories.map((c) => c.score))) : 0 };
    } else {
      throw new Error("Camera detector is not ready");
    }
    send(result);
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "Could not process camera frame" });
  } finally {
    bitmap.close();
  }
};
