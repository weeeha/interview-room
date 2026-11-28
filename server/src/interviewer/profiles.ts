import type { InterviewerProfile } from "../../../shared/types.ts";

/** Fixed lines, so they can be rendered to audio ahead of time. No LLM is involved. */
export type FixedLines = {
  opening: string;
  closing: string;
  silencePrompt: string;
  offerNext: string;
};

export const WARM_LINES: FixedLines = {
  opening: "Hi, thanks for coming in. Take your time with each answer. Let's start.",
  closing: "That is all my questions. Thank you, you did well to stay with it. Good luck.",
  silencePrompt: "Take your time. I am happy to wait.",
  offerNext: "That is fine if nothing comes to mind. Shall we move on to the next one?",
};

export const NEUTRAL_LINES: FixedLines = {
  opening: "Hello, thanks for joining. I will ask a few questions. Let's begin.",
  closing: "That covers my questions. Thank you for your time.",
  silencePrompt: "Whenever you are ready.",
  offerNext: "Would you like to move on to the next question?",
};

export const PROBING_LINES: FixedLines = {
  opening: "Hello. I have a set of questions and I will dig into the details. Let's begin.",
  closing: "That is the end of my questions. Thank you.",
  silencePrompt: "I am still waiting for your answer.",
  offerNext: "If you have nothing on this one, we can move on. Shall we?",
};

export const WARM: InterviewerProfile = {
  id: "warm",
  label: "Warm",
  persona:
    "You are a friendly, encouraging interviewer. You speak gently and show interest in the candidate's answers. You never praise at length.",
  maxFollowUpsPerQuestion: 2,
  voiceId: "af_heart",
};

export const NEUTRAL: InterviewerProfile = {
  id: "neutral",
  label: "Neutral",
  persona: "You are a calm, even-toned interviewer. You are polite and brief and you give no praise and no criticism.",
  maxFollowUpsPerQuestion: 2,
  voiceId: "am_michael",
};

export const PROBING: InterviewerProfile = {
  id: "probing",
  label: "Probing",
  persona:
    "You are a direct, exacting interviewer. You press for specifics such as numbers, dates, your own role, and what you would do differently. You stay polite.",
  maxFollowUpsPerQuestion: 2,
  voiceId: "bf_emma",
};

export const PROFILES: InterviewerProfile[] = [WARM, NEUTRAL, PROBING];

const LINES_BY_PROFILE: Record<string, FixedLines> = {
  warm: WARM_LINES,
  neutral: NEUTRAL_LINES,
  probing: PROBING_LINES,
};

export function linesFor(profile: InterviewerProfile): FixedLines {
  return LINES_BY_PROFILE[profile.id] ?? NEUTRAL_LINES;
}
