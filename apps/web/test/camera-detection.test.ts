import assert from "node:assert/strict";
import { test } from "node:test";
import { createCameraPolicy, type CameraResult, type CameraSecurityConfig } from "../src/lib/camera-detection.ts";

const phoneOnly: CameraSecurityConfig = { faceDetection: false, multiplePersonDetection: false, phoneDetection: true, detectionAction: "LOG" };
const phone = (confidence = 0.8): CameraResult => ({ type: "result", kind: "phone", phones: confidence ? 1 : 0, confidence });
const face = (faces: number): CameraResult => ({ type: "result", kind: "face", faces, confidence: 0.85 });

function confirmPhone(policy: ReturnType<typeof createCameraPolicy>, start = 0) {
  policy.update(phone(), start);
  policy.update(phone(), start + 800);
  return policy.update(phone(), start + 1600);
}

test("phone-only mode ignores faces and reports sustained phone evidence with confidence", () => {
  const policy = createCameraPolicy(phoneOnly);
  policy.update(face(0), 0);
  assert.deepEqual(policy.update(face(0), 3000).events, []);
  assert.deepEqual(policy.update(phone(), 4000).concerns, []);
  assert.deepEqual(policy.update(phone(), 4800).events, []);
  const result = policy.update(phone(0.72), 5600);
  assert.deepEqual(result.concerns, ["phone"]);
  assert.equal(result.events[0]?.type, "POSSIBLE_PHONE_DETECTED");
  assert.equal(result.events[0]?.confidence, 0.72);
  assert.equal(result.events[0]?.metadata?.category, "cell phone");
});

test("low confidence and isolated detections do not trigger an alert", () => {
  const policy = createCameraPolicy(phoneOnly);
  for (const now of [0, 800, 1600, 2400]) assert.deepEqual(policy.update(phone(0.4), now).events, []);
  policy.update(phone(), 3200);
  policy.update(phone(0), 4000);
  assert.deepEqual(policy.update(phone(), 4800).concerns, []);
});

test("one alert per sighting, no flicker on one missed frame, and rearm after a clear view", () => {
  const policy = createCameraPolicy(phoneOnly);
  assert.equal(confirmPhone(policy).events.length, 1);
  assert.deepEqual(policy.update(phone(), 2400).events, []);
  assert.deepEqual(policy.update(phone(0), 3200).concerns, ["phone"]);
  assert.deepEqual(policy.update(phone(), 4000).events, []);
  for (const now of [4800, 5600, 6400]) assert.deepEqual(policy.update(phone(0), now).concerns, ["phone"]);
  assert.deepEqual(policy.update(phone(0), 7200).concerns, []);
  assert.equal(confirmPhone(policy, 8000).events.length, 1);
});

test("a long pause cannot count as sustained visibility or a clear view", () => {
  const policy = createCameraPolicy(phoneOnly);
  policy.update(phone(), 0);
  assert.deepEqual(policy.update(phone(), 10000).events, []);
  policy.update(phone(), 10800);
  assert.equal(policy.update(phone(), 11600).events.length, 1);
  policy.update(phone(0), 12400);
  assert.deepEqual(policy.update(phone(0), 30000).concerns, ["phone"]);
});

test("face recovery cannot remove an ongoing phone restriction", () => {
  const policy = createCameraPolicy({ ...phoneOnly, faceDetection: true });
  policy.update(face(0), 0);
  confirmPhone(policy);
  policy.update(face(0), 1600);
  assert.deepEqual(policy.update(face(0), 3200).concerns, ["missing-face", "phone"]);
  const recovered = policy.update(face(1), 3600);
  assert.deepEqual(recovered.concerns, ["phone"]);
  assert.equal(recovered.events[0]?.type, "FACE_RESTORED");
});

test("multiple-person checking works independently and disabled phone checking emits nothing", () => {
  const policy = createCameraPolicy({ ...phoneOnly, phoneDetection: false, multiplePersonDetection: true });
  assert.deepEqual(confirmPhone(policy).events, []);
  const result = policy.update(face(2), 1000);
  assert.deepEqual(result.concerns, ["multiple-people"]);
  assert.equal(result.events[0]?.type, "MULTIPLE_PERSONS");
  assert.equal(result.events[0]?.confidence, 0.85);
  policy.update(face(0), 1600);
  assert.deepEqual(policy.update(face(0), 2000).concerns, []);
});
