import chatProviders from "./provider-presets.json";

export type ProviderType = "chat" | "speech_to_text" | "text_to_speech" | "judgment" | "embedding" | "reranker";
export type ProviderPreset = {
  id: string;
  name: string;
  kind: string;
  apiBaseUrl: string;
  websiteUrl: string;
  icon: string;
  thinkingEnabled?: boolean;
  reasoningProtocol?: string;
  defaultReasoningEffort?: string;
};

const compatible = (id: string, name: string, apiBaseUrl: string, icon = "openai", websiteUrl = "") : ProviderPreset => ({
  id,
  name,
  kind: "openai-compatible",
  apiBaseUrl,
  websiteUrl,
  icon,
});

export const providerPresetsByType: Record<ProviderType, ProviderPreset[]> = {
  chat: chatProviders as ProviderPreset[],
  speech_to_text: [
    compatible("siliconcloud-stt", "硅基流动 STT", "https://api.siliconflow.cn/v1", "siliconcloud", "https://cloud.siliconflow.cn"),
    compatible("whisper-api", "Whisper (API)", "https://api.openai.com/v1", "openai", "https://platform.openai.com"),
    compatible("mimo-stt-api", "MiMo STT (API)", "https://api.xiaomimimo.com/v1", "openai"),
    compatible("whisper-local", "Whisper (Local)", "http://localhost:8000/v1"),
    compatible("sensevoice-local", "SenseVoice (Local)", "http://localhost:8000/v1", "qwen"),
    compatible("xinference-stt", "Xinference STT", "http://localhost:9997/v1"),
  ],
  text_to_speech: [
    compatible("siliconcloud-tts", "硅基流动 TTS", "https://api.siliconflow.cn/v1", "siliconcloud", "https://cloud.siliconflow.cn"),
    compatible("openai-tts-api", "OpenAI TTS (API)", "https://api.openai.com/v1", "openai", "https://platform.openai.com"),
    compatible("mimo-tts-api", "MiMo TTS (API)", "https://api.xiaomimimo.com/v1", "openai"),
    compatible("genie-tts", "Genie TTS", "https://api.genie.ai/v1", "google"),
    compatible("edge-tts", "Edge TTS", "http://localhost:8000/v1", "azure"),
    compatible("gsv-tts-local", "GSV TTS (Local)", "http://localhost:9880/v1", "google"),
    compatible("gsvi-tts-api", "GSVI TTS (API)", "https://api.gsv.ai/v1", "google"),
    compatible("fishaudio-tts-api", "FishAudio TTS (API)", "https://api.fish.audio/v1", "cohere"),
    compatible("aliyun-tts-api", "阿里云百炼 TTS (API)", "https://dashscope.aliyuncs.com/api/v1", "qwen", "https://dashscope.aliyun.com"),
    compatible("azure-tts", "Azure TTS", "https://YOUR_RESOURCE_NAME.cognitiveservices.azure.com", "azure", "https://portal.azure.com"),
    compatible("minimax-tts-api", "MiniMax TTS (API)", "https://api.minimaxi.com/v1", "minimax"),
    compatible("volcengine-tts-api", "火山引擎 TTS (API)", "https://openspeech.bytedance.com/api/v3", "volcengine"),
    compatible("gemini-tts", "Gemini TTS", "https://generativelanguage.googleapis.com/v1beta", "google"),
    compatible("elevenlabs-tts-api", "ElevenLabs TTS (API)", "https://api.elevenlabs.io/v1", "openai"),
  ],
  judgment: [
    compatible("siliconcloud-judgment", "硅基流动判断", "https://api.siliconflow.cn/v1", "siliconcloud", "https://cloud.siliconflow.cn"),
    compatible("typesafe-system-one", "TypeSafe System One", "https://api.typesafe.systems/v1", "openai"),
    compatible("openrouter-system-one", "OpenRouter System One", "https://openrouter.ai/api/v1", "openrouter"),
    compatible("vercel-system-one", "Vercel System One", "https://ai-gateway.vercel.sh/v1", "google"),
    compatible("custom-system-one", "Custom System One", "https://api.openai.com/v1", "openai"),
  ],
  embedding: [
    compatible("openai-embedding", "OpenAI Embedding", "https://api.openai.com/v1", "openai", "https://platform.openai.com"),
    compatible("siliconcloud-embedding", "硅基流动 Embedding", "https://api.siliconflow.cn/v1", "siliconcloud", "https://cloud.siliconflow.cn"),
    compatible("gemini-embedding", "Gemini Embedding", "https://generativelanguage.googleapis.com/v1beta/openai", "google", "https://aistudio.google.com"),
    compatible("nvidia-embedding", "NVIDIA Embedding", "https://integrate.api.nvidia.com/v1", "openai", "https://build.nvidia.com"),
    compatible("ollama-embedding", "Ollama Embedding", "http://localhost:11434/v1", "ollama", "https://ollama.com"),
    compatible("dashscope-embedding", "DashScope Embedding", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen", "https://dashscope.aliyun.com"),
  ],
  reranker: [
    compatible("siliconcloud-rerank", "硅基流动重排序", "https://api.siliconflow.cn/v1", "siliconcloud", "https://cloud.siliconflow.cn"),
    compatible("vllm-rerank", "vLLM Rerank", "http://localhost:8000/v1", "openai"),
    compatible("xinference-rerank", "Xinference Rerank", "http://localhost:9997/v1", "google"),
    compatible("dashscope-rerank", "阿里云百炼重排序", "https://dashscope.aliyuncs.com/api/v1", "qwen", "https://dashscope.aliyun.com"),
    compatible("nvidia-rerank", "NVIDIA Rerank", "https://integrate.api.nvidia.com/v1", "openai", "https://build.nvidia.com"),
    compatible("tei-rerank", "TEI Rerank", "http://localhost:8080", "openai"),
  ],
};
