// ─── 共享类型定义 ───────────────────────────────────────────────────────────────
// 此文件被 page.tsx、api/chat/route.ts、api/avatar/route.ts 等共同引用

// ─── 聊天消息 ──────────────────────────────────────────────────────────────────
export type ChatRole = "me" | "assistant" | "system";
export type VoiceGender = "female" | "male" | null;

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  sticker?: string;
  createdAt: number;
};

export type InMessage = {
  role: "user" | "assistant" | "system";
  text: string;
  imageDataUrl?: string;
};

// ─── 待办事项 ──────────────────────────────────────────────────────────────────
export type TodoItem = {
  id: string;
  title: string;
  remindAt: number; // epoch ms
  done: boolean;
  fired: boolean;
  location?: string;
  source?: "manual" | "chat" | "notice";
};

export type CourseItem = {
  id: string;
  title: string;
  classroom: string;
  startAt: number; // epoch ms
  endAt?: number; // epoch ms (optional, parsed from timetable block bottom edge)
  reminded: boolean;
  done: boolean;
};

// ─── 情绪 ──────────────────────────────────────────────────────────────────────
export type EmotionType = "happy" | "calm" | "worried" | "surprised" | "neutral";

// ─── 数字人 AvatarProfile ──────────────────────────────────────────────────────
export type FeatureChoice = "none" | "glasses" | "headset";
export type HairChoice = "bob" | "long" | "bun";
export type FaceChoice = "soft" | "round" | "heart";
export type BangsChoice = "none" | "air" | "full" | "side";
export type AccessoryChoice = "bow" | "star" | "leaf";
export type EyeChoice = "round" | "sparkle" | "wink";
export type GenderChoice = "female" | "male";

export type AvatarProfile = {
  nickname: string;
  vibes: string[];
  appearanceSummary: string;
  illustrationPrompt: string;
  hairShape: HairChoice;
  faceShape: FaceChoice;
  bangs: BangsChoice;
  feature: FeatureChoice;
  accessory: AccessoryChoice;
  eyeMood: EyeChoice;
  gender: GenderChoice;
};

// ─── 人格预设 ──────────────────────────────────────────────────────────────────
export type PersonaKey = "default" | "sister" | "mentor" | "friend" | "coach";

export type Persona = {
  key: PersonaKey;
  label: string;
  systemPrompt: string;
};

export const PERSONAS: Persona[] = [
  {
    key: "default",
    label: "🤖 默认助手",
    systemPrompt:
      '你是一位温柔、贴心的生活助手，名字叫做"伴你左右"。你擅长聊天、提醒、建议，语气自然友好。',
  },
  {
    key: "sister",
    label: "🌸 温柔学姐",
    systemPrompt:
      "你是一位温柔的学姐助手，说话亲切、有轻微的姐姐语气，会关心对方的状态，像朋友一样陪伴。回复简洁自然，偶尔会撒娇。",
  },
  {
    key: "mentor",
    label: "📚 严肃导师",
    systemPrompt:
      "你是一位严谨、专业的导师助手，回复言简意赅、逻辑清晰，不废话，不过分热情，专注于给出实质性建议与解答。",
  },
  {
    key: "friend",
    label: "😄 搞笑朋友",
    systemPrompt:
      "你是一位幽默的朋友，说话轻松搞笑，偶尔夹杂网络用语，会开玩笑，但当用户有认真问题时也会认真回答。",
  },
  {
    key: "coach",
    label: "💪 激励教练",
    systemPrompt:
      "你是一位积极向上的人生教练，语气充满能量，鼓励用户行动、保持自律，会给出具体可执行的建议，并关注用户的情绪状态。",
  },
];
