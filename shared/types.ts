export type Room = {
  id: string;
  label: string; // "Interview office"
  kind: "office" | "panel" | "call";
  splatPath: string; // local file, SPZ or PLY
  colliderPath?: string; // optional GLB
  sourcePrompt: string; // text given to Marble
  marbleWorldId?: string; // if made through the API
  coordinateConvention: "marble_raw_opencv";
  metricScaleFactor?: number; // from Marble metadata, if present
  groundPlaneOffset?: number;
  seat: { position: [number, number, number]; yawDeg: number; lookLimitDeg: number };
  interviewerAnchors: Array<{ position: [number, number, number]; label: string }>;
};

export type QuestionBank = {
  id: string;
  title: string;
  sourcePath: string; // local path, never copied into the repo
  questions: Question[];
};

export type Question = {
  id: string;
  text: string;
  referenceAnswer?: string; // used only by the feedback pass
  followUpHints: string[];
  doNotSay: string[]; // guard lines from the bank
  tags: string[];
  hasReferenceAnswer: boolean; // false when the bank marks the answer as missing
};

export type InterviewerProfile = {
  id: string;
  label: string; // "Warm", "Neutral", "Probing"
  persona: string; // prompt text
  maxFollowUpsPerQuestion: number; // default 2
  voiceId: string;
};

export type Session = {
  id: string;
  startedAt: string; // ISO
  endedAt?: string;
  roomId: string;
  bankId: string;
  profileId: string;
  targetDurationSec: number; // default 600
  roleContext?: string; // pasted by the user, kept local
  providers: { stt: string; llm: string; tts: string };
  status: "created" | "running" | "ended" | "reported" | "failed";
  turns: Turn[];
};

export type Turn = {
  index: number;
  role: "interviewer" | "candidate";
  kind: "opening" | "question" | "followup" | "prompt" | "closing" | "answer";
  questionId?: string;
  text: string;
  audioPath?: string;
  startMs: number; // since session start
  endMs: number;
  latency?: { sttMs: number; llmFirstTokenMs: number; ttsFirstAudioMs: number; gapMs: number };
  interrupted?: boolean;
};

export type FeedbackReport = {
  sessionId: string;
  summary: string;
  perQuestion: Array<{
    questionId: string;
    strengths: Array<{ note: string; turnIndex: number; quote: string }>;
    gaps: Array<{ note: string; turnIndex: number; quote: string }>;
    rewrite?: string;
    rubric: { structure: 1 | 2 | 3 | 4; specificity: 1 | 2 | 3 | 4; relevance: 1 | 2 | 3 | 4; concision: 1 | 2 | 3 | 4 };
  }>;
  delivery: {
    wordsPerMinute: number;
    fillerCount: number;
    medianAnswerSec: number;
    longestPauseMs: number;
    interruptedCount: number;
  };
  nextDrill: string[];
};
