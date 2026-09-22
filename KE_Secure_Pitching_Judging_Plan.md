# KE Secure Digital Pitching & Judging Platform
## Full Technical Plan — Render-Only Deployment

## 1. Goal

Build a secure, paperless pitching and judging platform for confidential startup presentations.

The system should be:
- Fast and lightweight
- Clean and professional
- Easy for judges to use
- Secure against casual downloading and file extraction
- Traceable if screenshots/photos are leaked
- Flexible enough to enable or disable camera-based security features per event
- Fully deployable on Render

Important limitation:
A website cannot guarantee that a judge cannot photograph the screen using a second physical camera. The goal is therefore to combine:
- Controlled access
- Temporary viewing
- Session/device restrictions
- Personalized watermarking
- Real-time admin control
- Security event detection
- Audit logging

---

## 2. Main Roles

### Super Admin
- Manage admin accounts
- Manage system-wide settings
- Review audit logs

### Event Admin
- Create and manage events
- Create judges
- Create pitch sections/sessions
- Upload slide decks
- Configure security settings
- Activate/deactivate decks
- Control current slide
- Monitor judge connections
- Review security alerts

### Judge
- Scan event QR code
- Authenticate
- Join secure session
- View only active presentation
- Optionally score and comment
- Follow presenter slide changes

---

## 3. Main Flow

```text
Admin
  |
  +-- Create Event
  |
  +-- Create Pitch Sections / Rounds
  |
  +-- Create Judge Accounts
  |
  +-- Upload Startup Decks
  |
  +-- Configure Security
  |
  +-- Start Pitch Session
           |
           v
      Generate QR Code
           |
           v
      Judge Scans QR
           |
           v
      Authentication
           |
           v
   Security Requirements
           |
           v
     Secure Slide Viewer
           |
           v
   Admin Activates Deck
           |
           v
   Slides Become Visible
           |
           v
   Admin Ends Presentation
           |
           v
   Slides Immediately Lock
```

---

## 4. Event Structure

```text
Event
  |
  +-- Preliminary Round
  |     +-- Startup A
  |     +-- Startup B
  |     +-- Startup C
  |
  +-- Semi Final
  |
  +-- Final
```

Recommended naming:
- Event
- Pitch Section
- Pitch Session
- Startup
- Deck
- Slide
- Judge Assignment

---

## 5. Admin Security Settings

Each event can enable or disable features.

```text
Presentation Security

Judge Watermark             ON/OFF
One Device Per Judge        ON/OFF
Hide On Tab Switch          ON/OFF
Require Fullscreen          ON/OFF

AI Camera Security

Face Presence Detection     ON/OFF
Multiple Person Detection   ON/OFF
Visible Phone Detection     ON/OFF

Camera Processing
Process Locally             ON

Store Camera Images         OFF

Detection Response
- Log Only
- Warning
- Blur Presentation
- Lock Presentation
```

Recommended default:
- Watermark: ON
- Single device: ON
- Tab switch protection: ON
- Face detection: optional
- Phone detection: optional
- Store camera images: OFF

---

## 6. QR Code Design

Do not place direct file URLs inside the QR code.

Bad:

```text
https://system.com/files/startup-a.pdf
```

Good:

```text
https://judge.example.com/join?token=RANDOM_SHORT_LIVED_TOKEN
```

QR token should reference:
- Event
- Pitch session
- Expiration
- Random nonce

Recommended:
- Expire QR token after a short period
- Require judge authentication after scan
- Bind the session to one device

---

## 7. Judge Onboarding

```text
Scan QR
   |
   v
Validate QR
   |
   v
Judge Login / PIN
   |
   v
Check Judge Assignment
   |
   v
Bind Device Session
   |
   v
Load Event Security Settings
   |
   v
Camera Required?
   |
   +-- No --> Open Viewer
   |
   +-- Yes
          |
          v
   Explain Camera Usage
          |
          v
   Request Permission
          |
          v
   Start Local Detection
```

Before browser camera permission, show a clear notice:

```text
Secure Viewing Mode

This event uses camera-based security to verify
judge presence and detect visible secondary devices.

Camera processing occurs locally on your device.

Images and video are not recorded or uploaded.
```

---

## 8. Face Detection

Face detection is useful and realistic.

Behavior:

```text
1 Face
  -> Normal viewing

0 Faces
  -> Wait 2-3 seconds
  -> Blur if still missing

2+ Faces
  -> Warning / blur / lock
```

Use a grace period to avoid flickering when a judge briefly moves.

Recommended:
- Check 2–3 times per second
- Use a low-resolution frame
- Process locally
- Do not upload camera frames

---

## 9. Phone Detection

Phone detection is possible only if the secondary phone is visible inside the front camera frame.

Recommended wording:
"Visible secondary-device detection"

Do not claim:
"Prevents judges from taking photos"

Because a second phone can be outside the camera view.

Possible flow:

```text
Camera Frame
   |
   v
Object Detection
   |
   +-- phone = false --> Continue
   |
   +-- phone = true
          |
          v
     Log Security Event
          |
          v
   Warning / Blur / Lock
```

---

## 10. Camera AI Stack

### Face Detection
Recommended:
- MediaPipe

### Phone / Object Detection
Recommended:
- ONNX Runtime Web
- Small YOLO model (nano/tiny)

### Important Performance Rule
Do not run AI at 30 FPS.

Recommended:
- Face detection: 2–3 times/second
- Phone detection: 1–2 times/second
- Process 320x240 or similar small frames

### Run AI in a Web Worker
Keep AI off the main UI thread.

```text
Main Thread
  |
  +-- React UI
  +-- Slide Viewer
  +-- Socket.IO

Web Worker
  |
  +-- Camera Frames
  +-- MediaPipe
  +-- YOLO
  +-- ONNX Runtime
```

---

## 11. Slide Security

Never give judges the original PowerPoint or PDF.

Original files should remain private.

Processing pipeline:

```text
PPTX / PDF
    |
    v
Background Worker
    |
    v
Convert PPTX -> PDF
    |
    v
Render PDF -> Images
    |
    v
Optimize Images
    |
    v
Store Private Slides
```

Recommended slide format:
- WebP
- Around 1600–1920 px width
- Compressed for fast mobile viewing

Judge receives only slide images, never the source file.

---

## 12. Deck Processing Tools

Recommended tools:

| Purpose | Technology |
|---|---|
| PPTX -> PDF | LibreOffice Headless |
| PDF -> Images | Poppler or MuPDF |
| Image optimization | Sharp |
| Queue | BullMQ |
| Queue backend | Render Key Value / Valkey |

Processing should happen in a background worker, not inside a live API request.

---

## 13. Personalized Watermarking

This is one of the strongest protections.

Each judge sees a unique watermark.

Example:

```text
JUDGE J042
KE STARTUP AWARD
CONFIDENTIAL
FINAL ROUND
```

Use repeating watermarks across the slide:

```text
J042 • KE • CONFIDENTIAL

        J042 • KE • CONFIDENTIAL

J042 • KE • CONFIDENTIAL
```

### Recommended Two-Layer Watermark

Layer 1:
- Server-generated
- Baked into slide image pixels
- Harder to remove

Layer 2:
- Browser overlay
- Dynamic timestamp / session info
- Can move position periodically

Example dynamic overlay:
- Judge J042
- Session A
- 16 Sep 2026
- 14:42:18

---

## 14. Real-Time Admin Control

Use Socket.IO.

Admin can:
- Activate deck
- Deactivate deck
- Change current slide
- Force logout
- Disable/enable security controls
- See judge online status

Flow:

```text
Admin clicks ACTIVATE
       |
       v
Socket.IO event
       |
       v
All assigned judges
       |
       v
Deck becomes visible
```

When admin ends presentation:

```text
Deck Deactivated
       |
       v
All Judge Screens Lock
```

---

## 15. Synchronized Slides

Recommended for confidentiality.

Admin/presenter changes slide:

```text
Slide 4 -> Slide 5
```

Socket.IO broadcasts:

```text
slide:change { slide: 5 }
```

All judges automatically follow.

Optional setting:

```text
Allow Judge Navigation
OFF
```

This prevents judges from browsing ahead.

---

## 16. Device Binding

Bind each judge to one device/session.

```text
Judge J042
   |
   v
Device A
   |
   v
Bound Session
```

If the same judge tries Device B:

```text
Access Denied
Judge already connected
```

Admin options:
- Terminate session
- Allow device change
- Force logout

---

## 17. Tab Switching

Use the Page Visibility API.

```js
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hidePresentation();
  }
});
```

When judge leaves the page:
- Blur or hide the slide
- Log the event
- Revalidate when they return

---

## 18. Fullscreen

Optional security feature.

If fullscreen is required and judge exits:
- Warn
- Blur
- Lock

Do not treat fullscreen as strong security. It is mainly a deterrent.

---

## 19. Screenshot Reality

A normal website cannot reliably disable screenshots.

You may block:
- Right click
- Drag
- Save image
- Text selection
- Some keyboard shortcuts

But these are only minor barriers.

Real protection comes from:
- No original file
- Temporary access
- Authentication
- Single-device binding
- Personalized watermarking
- Active/inactive deck state
- Audit logs
- Optional camera security

---

# 20. Recommended Technology Stack

## Language
- TypeScript

## Frontend
- React
- Vite
- Tailwind CSS
- shadcn/ui
- Lucide
- TanStack Query
- React Hook Form
- Zod

## Backend
- Node.js
- Fastify
- Socket.IO
- Zod

## Database
- Render PostgreSQL
- Prisma

## Cache / Queue
- Render Key Value (Valkey / Redis-compatible)
- BullMQ

## File Storage
- Render Private Service
- Render Persistent Disk

## Processing
- Render Background Worker
- LibreOffice Headless
- Poppler or MuPDF
- Sharp

## AI (Client Side)
- MediaPipe
- ONNX Runtime Web
- YOLO Nano / Tiny

## Infrastructure
- Docker
- pnpm
- Turborepo
- render.yaml

## Monitoring
- Render Logs / Metrics
- Sentry (optional)

---

# 21. Render-Only Architecture

```text
                    INTERNET
                        |
                        v
              +------------------+
              | Render Static    |
              | Site             |
              |                  |
              | React + Vite     |
              | Admin + Judge UI |
              +--------+---------+
                       |
                       | HTTPS
                       v
              +------------------+
              | Render Web       |
              | Service          |
              |                  |
              | Fastify API      |
              | Socket.IO        |
              | Auth             |
              +--------+---------+
                       |
       +---------------+------------------+
       |               |                  |
       v               v                  v
+-------------+ +-------------+    +------------------+
| Render      | | Render Key  |    | Private Storage  |
| PostgreSQL  | | Value       |    | Service          |
|             | | (Valkey)    |    | + Persistent Disk|
+-------------+ +------+------+    +---------+--------+
                      |                     |
                      v                     |
              +---------------+             |
              | Render Worker |-------------+
              |               |
              | BullMQ        |
              | LibreOffice   |
              | PDF tools     |
              | Sharp         |
              +---------------+
```

---

## 22. Render Services

Suggested Render workspace:

```text
KE Secure Pitch
|
+-- ke-pitch-web
|   Render Static Site
|
+-- ke-pitch-api
|   Render Web Service
|
+-- ke-pitch-worker
|   Render Background Worker
|
+-- ke-pitch-storage
|   Render Private Service
|   + Persistent Disk
|
+-- ke-pitch-db
|   Render PostgreSQL
|
+-- ke-pitch-cache
    Render Key Value
```

---

## 23. Why React + Vite Instead of Next.js

For this project:
- SEO is not important
- Most pages are authenticated
- Main use is admin dashboard + judge viewer
- SPA can be very lightweight
- Easier to deploy as Render Static Site

Recommended frontend:
- React
- Vite
- TypeScript

---

## 24. API Service

Use:

```text
Node.js
Fastify
TypeScript
Socket.IO
Prisma
Zod
```

API responsibilities:
- Authentication
- Event CRUD
- Judge CRUD
- Pitch management
- QR validation
- Security settings
- Slide authorization
- Scoring
- Audit logs
- Real-time events

---

## 25. Database Tables

Suggested tables:

```text
users
events
judges
judge_assignments

pitch_sections
startups

decks
slides

judge_sessions

event_security_settings

security_events
audit_logs

score_criteria
scores
```

---

## 26. Security Settings Model

Example:

```ts
type EventSecuritySettings = {
  watermark: boolean;
  singleDevice: boolean;
  hideOnTabSwitch: boolean;
  requireFullscreen: boolean;

  faceDetection: boolean;
  multiplePersonDetection: boolean;
  phoneDetection: boolean;

  cameraProcessing: "LOCAL";

  detectionAction:
    | "LOG"
    | "WARN"
    | "BLUR"
    | "LOCK";
};
```

---

## 27. Security Event Logging

Example events:

```text
14:21:03  J042  FACE_MISSING
14:21:05  J042  FACE_RESTORED
14:26:11  J018  POSSIBLE_PHONE_DETECTED
14:30:45  J033  TAB_HIDDEN
```

Recommended:
- Store event type
- Judge ID
- Event ID
- Pitch session ID
- Timestamp
- Confidence (if AI)
- Do not store camera images by default

---

## 28. Authentication

### Admin
- Email
- Password
- Optional 2FA

Use cookies:
- HttpOnly
- Secure
- SameSite

Avoid long-lived auth tokens in localStorage.

### Judge
Possible options:
- QR + PIN
- QR + account login
- Temporary judge session

---

## 29. Render File Storage

Because deployment must be Render-only:

Use a dedicated Render Private Service with a Persistent Disk.

Example:

```text
/var/data/
|
+-- originals/
|   +-- deck-001.pptx
|   +-- deck-002.pdf
|
+-- slides/
|   +-- deck-001/
|       +-- 001.webp
|       +-- 002.webp
|       +-- 003.webp
|
+-- temporary/
```

Private storage service can expose internal-only endpoints:

```text
POST   /internal/files
GET    /internal/files/:id
DELETE /internal/files/:id
```

Do not expose storage directly to judges.

---

## 30. Why Use a Separate Storage Service

Render Persistent Disks are attached to one service instance and limit horizontal scaling.

Recommended:

```text
API
 |
 | Private Network
 v
Storage Service + Persistent Disk
```

The API stays scalable and storage remains private.

---

## 31. Secure Slide Delivery

Judge requests:

```text
GET /api/v1/presentations/current/slides/7
```

API checks:
- Authenticated?
- Correct judge?
- Correct event?
- Correct pitch?
- Deck active?
- Device allowed?
- Session valid?
- Slide allowed?

If yes:
- API retrieves slide from private storage
- API streams it to judge

If no:
- Return 403

---

## 32. Browser Cache Protection

Confidential slide responses should use:

```http
Cache-Control: private, no-store
```

If using a service worker:
- Never cache slide API routes
- Never make deck content available offline

---

## 33. Performance Strategy

### Initial Judge Page
Load only:
- React
- Router
- Auth
- Basic viewer
- Socket.IO

Do not load AI libraries at first.

### Lazy Load AI

```text
Load Security Settings
       |
       +-- faceDetection = true
       |      -> Load MediaPipe
       |
       +-- phoneDetection = true
              -> Load ONNX + YOLO
```

If AI features are disabled:
- Do not download AI packages or models

---

## 34. Slide Performance

Do not download all slides at once.

If current slide is 7:

```text
Preload:
6
7
8
```

Then preload 9 when moving forward.

This keeps the viewer fast and reduces bandwidth.

---

## 35. Frontend Performance Targets

Recommended goals:
- First load: under ~2 seconds on normal 4G
- Initial JS: keep small
- Slide transition: under ~150 ms perceived
- Admin -> judge real-time action: under ~500 ms target
- AI: lazy-loaded
- Images: WebP
- Fonts: one family if possible
- Avoid unnecessary animation libraries

---

## 36. UI Design Direction

Recommended:
- White / neutral background
- Strong typography
- Clear spacing
- Thin borders
- Minimal shadows
- Large touch targets
- Few colors
- Simple icons
- Clean status indicators

Design inspiration:
- Vercel
- Linear
- Stripe
- Apple

Avoid:
- Overloaded admin templates
- Too many dashboard cards
- Huge gradients
- Heavy animations
- Unnecessary libraries

---

## 37. Judge UI

Keep it extremely simple.

```text
KE STARTUP AWARD

FINAL ROUND

Startup XYZ
-----------------------------

       PRESENTATION

          Slide 04

-----------------------------

Secure Session
Judge J042
```

Optional controls:
- Previous
- Next

Recommended for confidential mode:
- Follow Presenter
- Judge navigation disabled

---

## 38. Event-Day Reliability

Add emergency admin controls.

Example:

```text
Security Override

Temporarily Disable Camera Security

Detection Mode:
LOCK -> WARN ONLY
```

This is important if:
- Browser camera permission fails
- AI behaves poorly on some phones
- Network is unstable

Reliability during a live event is more important than strict automation.

---

## 39. Network Failure

WebSocket should auto-reconnect.

Judge screen:

```text
Connection lost
Reconnecting...
```

After a short grace period:
- Blur the presentation if server state cannot be verified

When connection returns:
- Revalidate session
- Revalidate deck active state
- Restore if allowed

---

## 40. Monorepo Structure

Recommended:

```text
secure-pitch/
|
+-- apps/
|   +-- web/
|   +-- api/
|   +-- worker/
|   +-- storage/
|
+-- packages/
|   +-- database/
|   +-- types/
|   +-- validation/
|   +-- auth/
|   +-- security/
|   +-- config/
|
+-- pnpm-workspace.yaml
+-- turbo.json
+-- render.yaml
+-- package.json
```

Use:
- pnpm
- Turborepo

---

## 41. Render Deployment

Recommended services:

```text
ke-pitch-web
  -> Render Static Site

ke-pitch-api
  -> Render Web Service

ke-pitch-worker
  -> Render Background Worker

ke-pitch-storage
  -> Render Private Service
  -> Persistent Disk

ke-pitch-db
  -> Render PostgreSQL

ke-pitch-cache
  -> Render Key Value
```

Keep services in the same Render region whenever possible.

---

## 42. render.yaml

Use Render Blueprint / `render.yaml` so infrastructure stays in the repository.

Goal:

```text
git push
   |
   v
GitHub
   |
   v
Render
   |
   +-- Web
   +-- API
   +-- Worker
   +-- Storage
   +-- Database
   +-- Key Value
```

---

## 43. Recommended Development Phases

### Phase 1 — Core MVP
- Admin login
- Event CRUD
- Judge CRUD
- Pitch section CRUD
- Startup/deck upload
- PPT/PDF processing
- QR join
- Judge authentication
- Secure slide viewer
- Active/inactive deck
- Socket.IO control
- Personalized watermark

### Phase 2 — Security Controls
- Single-device binding
- Tab visibility detection
- Fullscreen mode
- Audit logs
- Strict file authorization
- Cache protection
- Force logout

### Phase 3 — Camera Security
- Face detection
- Multiple-person detection
- Phone detection
- Start with LOG ONLY
- Test on iPhone + Android
- Later enable warning / blur / lock

### Phase 4 — Judging
- Criteria
- Scoring
- Notes
- Autosave
- Ranking
- Reports
- Export

---

## 44. Best Internal Product Name

Suggested concept:

**Secure Digital Pitching & Judging System**

Possible description:

> A secure, paperless platform for confidential startup pitching that provides controlled real-time slide access, judge-specific watermarking, device/session security, event-controlled presentation visibility, security auditing, and optional on-device AI monitoring for face presence and visible secondary devices.

Important technical disclaimer:

> AI phone detection is an additional risk-control mechanism, not a guarantee against external photography.

---

## 45. Final Recommended Stack

```text
LANGUAGE
TypeScript

FRONTEND
React
Vite
Tailwind CSS
shadcn/ui
TanStack Query
React Hook Form
Zod

BACKEND
Node.js
Fastify
Socket.IO
Zod

DATABASE
Render PostgreSQL
Prisma

CACHE / QUEUE
Render Key Value
BullMQ

FILES
Render Private Service
Render Persistent Disk

PROCESSING
Render Background Worker
LibreOffice Headless
Poppler / MuPDF
Sharp

AI — CLIENT SIDE
MediaPipe
ONNX Runtime Web
YOLO Nano / Tiny

INFRASTRUCTURE
Docker
pnpm
Turborepo
render.yaml

MONITORING
Render Logs / Metrics
Sentry optional
```

---

## Final Recommendation

Build the core secure viewer first.

The most important protections are:
1. Never send the original presentation file
2. Use temporary authorized sessions
3. Use one-device-per-judge binding
4. Activate/deactivate decks in real time
5. Synchronize slides with the presenter
6. Use judge-specific server-baked watermarks
7. Log security events
8. Add camera detection only as an optional extra layer

For speed:
- Use React + Vite
- Lazy-load AI
- Run AI in a Web Worker
- Use low-resolution AI frames
- Preprocess decks before the event
- Use optimized WebP slides
- Preload only current/nearby slides
- Keep the judge UI extremely small and simple
