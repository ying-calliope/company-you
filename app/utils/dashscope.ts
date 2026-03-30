import type { InMessage } from "../types";

/**
 * 从环境变量中获取 DashScope API Key
 */
export function getDashScopeKey() {
  return process.env.DASHSCOPE_API_KEY || process.env.ALIBABA_API_KEY || process.env.OPENAI_API_KEY;
}

/**
 * 根据是否包含图片数据，返回合适的 DashScope API Endpoint
 * @param hasImage 是否包含图片
 */
export function getEndpoint(hasImage: boolean) {
  const _unused = hasImage;
  void _unused;

  const configured = process.env.DASHSCOPE_BASE_URL?.trim();
  if (configured) {
    if (/\/chat\/completions\/?$/i.test(configured)) {
      return configured;
    }
    return `${configured.replace(/\/+$/, "")}/chat/completions`;
  }
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

/**
 * 将应用内部消息格式转换为 OpenAI 兼容格式
 * @param msg 内部消息
 */
export function toOpenAIMessage(msg: InMessage) {
  if (msg.role === "system") {
    return { role: "system", content: msg.text };
  }
  if (msg.role === "assistant") {
    return { role: "assistant", content: msg.text };
  }

  // user role
  if (msg.imageDataUrl) {
    return {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: msg.imageDataUrl } },
        { type: "text", text: msg.text },
      ],
    };
  }
  return { role: "user", content: msg.text };
}
