import { FaceRobot } from "@gravity-ui/icons";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AzureIcon from "@lobehub/icons/es/Azure/components/Color";
import CohereIcon from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoIcon from "@lobehub/icons/es/Doubao/components/Color";
import FireworksIcon from "@lobehub/icons/es/Fireworks/components/Color";
import GoogleIcon from "@lobehub/icons/es/Google/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MinimaxIcon from "@lobehub/icons/es/Minimax/components/Color";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import OllamaIcon from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Color";
import QwenIcon from "@lobehub/icons/es/Qwen/components/Color";
import SiliconCloudIcon from "@lobehub/icons/es/SiliconCloud/components/Color";
import TogetherIcon from "@lobehub/icons/es/Together/components/Color";
import VolcengineIcon from "@lobehub/icons/es/Volcengine/components/Color";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import ZhipuIcon from "@lobehub/icons/es/Zhipu/components/Color";

export function ProviderIcon({ icon, name, size = 20, className }: { icon?: string; name: string; size?: number; className?: string }) {
  const props = { className, size, title: `${name} 图标` };
  switch (icon === "openai-compatible" || icon === "compatible" ? "openai" : icon === "local" ? "ollama" : icon) {
    case "anthropic": return <AnthropicIcon {...props} style={{ color: "#F1F0E8" }} />;
    case "azure": return <AzureIcon {...props} />;
    case "cohere": return <CohereIcon {...props} />;
    case "deepseek": return <DeepSeekIcon {...props} />;
    case "doubao": return <DoubaoIcon {...props} />;
    case "fireworks": return <FireworksIcon {...props} />;
    case "google": return <GoogleIcon {...props} />;
    case "groq": return <GroqIcon {...props} style={{ color: "#F55036" }} />;
    case "minimax": return <MinimaxIcon {...props} />;
    case "mistral": return <MistralIcon {...props} />;
    case "moonshot": return <MoonshotIcon {...props} style={{ color: "#16191E" }} />;
    case "ollama": return <OllamaIcon {...props} style={{ color: "#FFFFFF" }} />;
    case "openai": return <OpenAIIcon {...props} style={{ color: "#000000" }} />;
    case "openrouter": return <OpenRouterIcon {...props} />;
    case "qwen": return <QwenIcon {...props} />;
    case "siliconcloud": return <SiliconCloudIcon {...props} />;
    case "together": return <TogetherIcon {...props} />;
    case "volcengine": return <VolcengineIcon {...props} />;
    case "xai": return <XAIIcon {...props} style={{ color: "#FFFFFF" }} />;
    case "zhipu": return <ZhipuIcon {...props} />;
    default: return <FaceRobot className={className ?? "h-5 w-5"} aria-label={`${name} 图标`} />;
  }
}
