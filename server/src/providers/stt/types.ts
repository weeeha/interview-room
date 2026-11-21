export interface STTProvider {
  name: string;
  transcribe(wav: Buffer): Promise<{ text: string; ms: number }>;
}
