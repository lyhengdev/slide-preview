import { z } from "zod";

export const slugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");

export const emailSchema = z.string().email().max(255);

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6).max(200),
});

export const createEventSchema = z.object({
  title: z.string().min(2).max(200),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
});

export const securitySettingsSchema = z.object({
  watermark: z.boolean().optional(),
  watermarkText: z.string().max(40).nullable().optional(),
  singleDevice: z.boolean().optional(),
  hideOnTabSwitch: z.boolean().optional(),
  blockScreenshots: z.boolean().optional(),
  requireFullscreen: z.boolean().optional(),
  faceDetection: z.boolean().optional(),
  multiplePersonDetection: z.boolean().optional(),
  phoneDetection: z.boolean().optional(),
  detectionAction: z.enum(["LOG", "WARN", "BLUR", "LOCK"]).optional(),
  allowJudgeNavigation: z.boolean().optional(),
});

export const createJudgeSchema = z.object({
  name: z.string().min(1).max(200),
  email: emailSchema.nullable().optional(),
  pin: z.string().min(4).max(12).optional(),
});

export const createSectionSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["PRELIMINARY", "SEMI_FINAL", "FINAL"]).default("PRELIMINARY"),
  order: z.number().int().default(0),
});

export const createStartupSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  pitchSectionId: z.string().optional(),
});

export const judgeJoinSchema = z.object({
  token: z.string().min(8),
  deviceId: z.string().min(1).max(200),
});

export const judgeLoginSchema = judgeJoinSchema.extend({
  judgeCode: z.string().min(1).max(40),
  pin: z.string().min(1).max(12),
});

export const updateSectionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(["PRELIMINARY", "SEMI_FINAL", "FINAL"]).optional(),
  order: z.number().int().optional(),
});

export const updateStartupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  pitchSectionId: z.string().nullable().optional(),
});

export const updateJudgeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: emailSchema.nullable().optional(),
  active: z.boolean().optional(),
  pin: z.string().min(4).max(12).optional(),
});

export const securityOverrideSchema = z.object({
  pitchSessionId: z.string().min(1).optional(),
  detectionAction: z.enum(["LOG", "WARN", "BLUR", "LOCK"]).nullable().optional(),
});

export const judgePinSchema = z.object({
  pin: z.string().min(1).max(12),
});

export const securityEventSchema = z.object({
  type: z.string().min(1).max(60),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const changeSlideSchema = z.object({
  slide: z.number().int().min(1),
});

export const beginPitchSchema = z.object({
  startupId: z.string().min(1),
  pitchSectionId: z.string().optional(),
});

export const refreshJoinTokenSchema = z.object({
  pitchSessionId: z.string().min(1),
});