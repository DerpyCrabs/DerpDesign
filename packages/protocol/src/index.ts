/** Shared wire values; consumers validate incoming data at their boundary. */
export type Engine = 'chromium' | 'ladybird';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Viewport { width: number; height: number; deviceScaleFactor: number | "display" }
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface Project {
  id: string; name: string; sourceRoot: string; supportRoot: string;
  server: { command: string[]; cwd: string; url: string; readyTimeoutMs?: number };
}
export interface Pane {
  id: string; name: string; engine: Engine; viewport: Viewport;
  position: Point; route: string; conditions: Record<string, Json>;
}
export interface Demo {
  id: string; projectId: string; name: string; description: string;
  panes: Pane[]; thumbnailCaptureId?: string;
}
export interface Selection { projectId: string | null; demoId: string | null; generation: number }
export interface Capture {
  id: string; projectId: string; demoId: string; paneId: string;
  generation: number; engine: Engine; engineVersion: string;
  sourceFingerprint: string; harnessFingerprint: string;
  viewport: Viewport; conditions: Record<string, Json>;
  screenshotPath: string; inspectionPath?: string; createdAt: string;
}
export interface EngineCapabilities {
  engine: Engine; version: string; available: boolean; reason?: string;
  features: string[];
}
export interface EngineRequest {
  id: string; method: string; params: Record<string, Json>;
}
export interface EngineReply {
  id: string; result?: Json; error?: { code: string; message: string };
}
export type PaneInput =
  | { type: 'pointer'; action: 'move' | 'down' | 'up' | 'leave'; x: number; y: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'key'; action: 'down' | 'up'; key: string; modifiers?: string[] }
  | { type: 'text'; text: string };
