import type { DetectionAction, EventSecuritySettings } from "@ke/database";

export type {
  User,
  Event,
  EventSecuritySettings,
  PitchSection,
  Judge,
  JudgeAssignment,
  Startup,
  Deck,
  Slide,
  JudgeSession,
  PitchSession,
  SecurityEvent,
  AuditLog,
  Role,
  EventStatus,
  SectionType,
  DeckStatus,
  JudgeSessionStatus,
  PitchSessionStatus,
  DetectionAction,
  SecurityEventType,
} from "@ke/database";

export interface TokenPayload {
  sub: string;
  type: "admin" | "judge";
  eventId?: string;
  exp: number;
  iat: number;
}

export interface AdminContext {
  userId: string;
  role: string;
  isAdmin: true;
}

export interface JudgeContext {
  judgeId: string;
  eventId: string;
  sessionId: string;
  isAdmin: false;
}

export type AuthContext = AdminContext | JudgeContext;

export interface SlideView {
  number: number;
  width: number;
  height: number;
  url: string;
}

export interface JudgeViewState {
  sessionActive: boolean;
  pitchSessionId: string | null;
  deckActive: boolean;
  currentSlide: number;
  slideCount: number;
  startupName: string | null;
  security: Pick<
    EventSecuritySettings,
    | "watermark"
    | "watermarkText"
    | "hideOnTabSwitch"
    | "requireFullscreen"
    | "faceDetection"
    | "multiplePersonDetection"
    | "phoneDetection"
    | "detectionAction"
  > & { allowJudgeNavigation: boolean };
}

export interface SecuritySettingsPayload {
  watermark: boolean;
  watermarkText: string | null;
  singleDevice: boolean;
  hideOnTabSwitch: boolean;
  requireFullscreen: boolean;
  faceDetection: boolean;
  multiplePersonDetection: boolean;
  phoneDetection: boolean;
  detectionAction: DetectionAction;
}

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  FACE_MISSING: "Face missing",
  FACE_RESTORED: "Face restored",
  MULTIPLE_PERSONS: "Multiple persons detected",
  POSSIBLE_PHONE_DETECTED: "Possible secondary device",
  TAB_HIDDEN: "Tab hidden",
  TAB_VISIBLE: "Tab visible",
  FULLSCREEN_EXIT: "Fullscreen exited",
  SCREENSHOT_ATTEMPT: "Screenshot attempt",
  DEVICE_CHANGE_BLOCKED: "Device change blocked",
  JOIN_DENIED: "Join denied",
};