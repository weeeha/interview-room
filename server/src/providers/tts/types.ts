export type TTSResult = { wav: Buffer; ms: number };

/**
 * Returns null when the provider has no audio to send. The browser provider always
 * returns null: the client then speaks the sentence with speechSynthesis.
 */
export interface TTSProvider {
  name: string;
  synthesize(text: string, voiceId: string): Promise<TTSResult | null>;
  /** Render a line ahead of time into the cache, so a later synthesize() of the same text is a cache read. */
  prepare?(text: string, voiceId: string): Promise<void>;
}
