import { Alova } from '@/utils/http/alova/index';

export interface AsrTranscribePayload {
  audioUrl?: string;
  audioBase64?: string;
  audioMimeType?: string;
  language?: string;
  enableItn?: boolean;
}

export interface AsrTranscribeResult {
  text: string;
  model: string;
  raw?: any;
}

export const transcribeAudio = (payload: AsrTranscribePayload) => {
  return Alova.Post<AsrTranscribeResult>('/asr/transcribe', payload);
};
