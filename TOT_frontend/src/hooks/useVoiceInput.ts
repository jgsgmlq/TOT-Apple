import { ref } from 'vue';
import { transcribeAudio } from '@/api/asr';

export function useVoiceInput(onTranscribed: (text: string, isFinal: boolean) => void) {
  const isRecording = ref(false);
  const isTranscribing = ref(false);
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // @ts-ignore
        window.$message?.error('无法访问麦克风：浏览器拦截。请使用 localhost 或 HTTPS 访问以开启录音权限。');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          
          // 伪流式：每次拿到增量数据时，合并迄今为止的所有音频，发送一次请求，从而实现“边说边出字”的效果
          if (isRecording.value) {
            const currentBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(currentBlob);
            reader.onloadend = async () => {
              const base64data = reader.result as string;
              try {
                const res = await transcribeAudio({
                  audioBase64: base64data,
                  audioMimeType: currentBlob.type,
                }).send();
                if (res && res.text) {
                  onTranscribed(res.text, false);
                }
              } catch (e) {
                // 静默忽略中间片段的识别错误
              }
            };
          }
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
        // Stop all tracks to release microphone
        stream.getTracks().forEach((track) => track.stop());

        isTranscribing.value = true;
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64data = reader.result as string;
            const res = await transcribeAudio({
              audioBase64: base64data,
              audioMimeType: audioBlob.type,
            }).send();
            if (res && res.text) {
              onTranscribed(res.text, true);
            } else {
              onTranscribed('', true); // 最终没识别出内容也要通知结束
            }
          };
        } catch (error) {
          console.error('ASR Transcription failed:', error);
          // @ts-ignore
          window.$message?.error('语音识别失败，可能音频过长或网络错误');
          onTranscribed('', true);
        } finally {
          isTranscribing.value = false;
        }
      };

      // 每隔 2000ms (2秒) 触发一次 ondataavailable 进行即时识别
      mediaRecorder.start(2000);
      isRecording.value = true;
    } catch (error) {
      console.error('Microphone access denied:', error);
      // @ts-ignore
      window.$message?.error('无法访问麦克风，请检查权限');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording.value) {
      mediaRecorder.stop();
      isRecording.value = false;
    }
  };

  const toggleRecording = () => {
    if (isRecording.value) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return {
    isRecording,
    isTranscribing,
    toggleRecording,
  };
}
