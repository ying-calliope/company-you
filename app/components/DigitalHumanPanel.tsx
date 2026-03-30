"use client";

import type { CSSProperties, ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type EmotionType = "happy" | "calm" | "worried" | "surprised" | "neutral";

type DigitalHumanPanelProps = {
  latestAssistantText: string;
  isReplying: boolean;
  emotion?: EmotionType;
  onGenderDetected?: (gender: "female" | "male") => void;
};

type PresenceState = "idle" | "thinking" | "speaking";

type AccessoryType = "bow" | "star" | "leaf";

type EyeMood = "round" | "sparkle" | "wink";

type HairShape = "bob" | "long" | "bun";

type FaceShape = "soft" | "round" | "heart";

type FeatureType = "none" | "glasses" | "headset";

type AvatarTheme = {
  aura: string;
  auraSoft: string;
  hair: string;
  hairDeep: string;
  outfit: string;
  outfitSoft: string;
  skin: string;
  blush: string;
  badge: string;
  eyeMood: EyeMood;
  accessory: AccessoryType;
  hairShape: HairShape;
  faceShape: FaceShape;
  feature: FeatureType;
  nickname: string;
  vibes: string[];
};

const defaultTheme: AvatarTheme = {
  aura: "#f7bb7f",
  auraSoft: "#fff0d7",
  hair: "#7b4b34",
  hairDeep: "#432214",
  outfit: "#f0b877",
  outfitSoft: "#fff5e8",
  skin: "#ffe4cf",
  blush: "rgba(255, 143, 171, 0.28)",
  badge: "#fff6ec",
  eyeMood: "sparkle",
  accessory: "bow",
  hairShape: "bob",
  faceShape: "soft",
  feature: "none",
  nickname: "小庆团子",
  vibes: ["奶呼呼", "元气系", "会陪伴"],
};

function estimateSpeakingMs(text: string) {
  const base = Math.max(2200, text.length * 180);
  return Math.min(base, 12000);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3
    ? normalized
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
    : normalized;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mix(hexA: string, hexB: string, amount: number) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
  );
}

function rgba(hex: string, alpha: number) {
  const value = hexToRgb(hex);
  return `rgba(${value.r}, ${value.g}, ${value.b}, ${alpha})`;
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hashSeed(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function sampleThemeFromPixels(data: Uint8ClampedArray, seedText: string): AvatarTheme {
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  let darkest = { hex: "#5b3421", light: Number.POSITIVE_INFINITY };
  let brightest = { hex: "#fff1df", light: Number.NEGATIVE_INFINITY };
  const swatches: string[] = [];

  for (let index = 0; index < data.length; index += 16) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = data[index + 3];
    if (alpha < 160) continue;
    red += r;
    green += g;
    blue += b;
    total += 1;

    const hex = rgbToHex(r, g, b);
    const light = luminance(hex);
    swatches.push(hex);

    if (light < darkest.light) darkest = { hex, light };
    if (light > brightest.light) brightest = { hex, light };
  }

  if (total === 0) {
    return defaultTheme;
  }

  const dominant = rgbToHex(red / total, green / total, blue / total);
  const softened = mix(dominant, "#fff4ea", 0.62);
  const hair = mix(darkest.hex, "#4a2816", 0.25);
  const outfit = mix(dominant, "#ffd9b8", 0.28);
  const skinBase = mix(brightest.hex, "#ffe2d1", 0.68);
  const accentPool = [dominant, darkest.hex, brightest.hex, softened, outfit, ...swatches.slice(0, 8)];
  const seed = hashSeed(seedText + dominant + darkest.hex);
  const accessoryList: AccessoryType[] = ["bow", "star", "leaf"];
  const eyeMoodList: EyeMood[] = ["round", "sparkle", "wink"];
  const hairShapeList: HairShape[] = ["bob", "long", "bun"];
  const faceShapeList: FaceShape[] = ["soft", "round", "heart"];
  const featureList: FeatureType[] = ["none", "glasses", "headset"];
  const nicknameList = ["糯米团", "奶桃桃", "小庆啵啵", "暖糖球", "团团助手", "星糖陪伴官"];
  const vibeList = ["奶呼呼", "元气系", "软萌感", "治愈型", "黏人款", "闪亮眼", "暖烘烘", "会撒娇"];

  const vibes = [
    vibeList[seed % vibeList.length],
    vibeList[(seed >> 3) % vibeList.length],
    vibeList[(seed >> 7) % vibeList.length],
  ].filter((value, index, list) => list.indexOf(value) === index);

  const aura = accentPool[seed % accentPool.length];

  return {
    aura,
    auraSoft: mix(aura, "#fff8ef", 0.72),
    hair,
    hairDeep: mix(hair, "#2a150b", 0.42),
    outfit,
    outfitSoft: mix(outfit, "#fff9f2", 0.7),
    skin: skinBase,
    blush: rgba(mix(dominant, "#ff9bb0", 0.58), 0.32),
    badge: mix(brightest.hex, "#fff8ef", 0.5),
    eyeMood: eyeMoodList[seed % eyeMoodList.length],
    accessory: accessoryList[(seed >> 2) % accessoryList.length],
    hairShape: hairShapeList[(seed >> 5) % hairShapeList.length],
    faceShape: faceShapeList[(seed >> 8) % faceShapeList.length],
    feature: featureList[(seed >> 10) % featureList.length],
    nickname: nicknameList[(seed >> 4) % nicknameList.length],
    vibes,
  };
}

async function analyzeAvatarImage(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片读取失败"));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解析失败"));
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return { dataUrl, theme: defaultTheme };
  }

  ctx.drawImage(img, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size);

  return {
    dataUrl,
    theme: sampleThemeFromPixels(imageData.data, `${file.name}:${file.size}`),
  };
}

// 情绪 -> CSS 表情类名映射
function emotionToExpression(emotion: EmotionType): string {
  switch (emotion) {
    case "happy": return "expression_happy";
    case "worried": return "expression_focused";
    case "surprised": return "expression_surprised";
    case "calm": return "expression_calm";
    default: return "";
  }
}

export default function DigitalHumanPanel({
  latestAssistantText,
  isReplying,
  emotion = "neutral",
  onGenderDetected,
}: DigitalHumanPanelProps) {
  const defaultCaption = "您好，我会在这里陪伴您。\n您发来的消息，我会尽量用更自然的方式回应。";
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [customImageUrl, setCustomImageUrl] = useState("");
  const [theme, setTheme] = useState<AvatarTheme>(defaultTheme);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [customizeError, setCustomizeError] = useState("");

  const lastSpokenRef = useRef("");
  const speakingTimerRef = useRef<number | null>(null);
  const speechKickoffRef = useRef<number | null>(null);

  const caption = latestAssistantText.trim() || defaultCaption;
  const presence: PresenceState = isSpeaking ? "speaking" : isReplying ? "thinking" : "idle";
  const expressionClass = emotionToExpression(emotion);

  const statusText = useMemo(() => {
    if (presence === "thinking") return "思考中";
    if (presence === "speaking") return voiceEnabled ? "播报中" : "回应中";
    return "待机中";
  }, [presence, voiceEnabled]);

  const avatarStyle = useMemo(
    () =>
      ({
        "--agent-aura": theme.aura,
        "--agent-aura-soft": theme.auraSoft,
        "--agent-hair": theme.hair,
        "--agent-hair-deep": theme.hairDeep,
        "--agent-outfit": theme.outfit,
        "--agent-outfit-soft": theme.outfitSoft,
        "--agent-skin": theme.skin,
        "--agent-blush": theme.blush,
        "--agent-badge": theme.badge,
      }) as CSSProperties,
    [theme],
  );

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsGeneratingAvatar(true);
    setCustomizeError("");

    try {
      const result = await analyzeAvatarImage(file);
      setCustomImageUrl(result.dataUrl);
      setTheme(result.theme);
      // 回传性别给父组件用于语音选择
      onGenderDetected?.(result.theme.hairShape === "bun" ? "female" : "female");
    } catch (error) {
      setCustomizeError(error instanceof Error ? error.message : "形象生成失败");
    } finally {
      setIsGeneratingAvatar(false);
    }
  }

  function resetAvatarTheme() {
    setCustomImageUrl("");
    setTheme(defaultTheme);
    setCustomizeError("");
  }

  useEffect(() => {
    return () => {
      if (speechKickoffRef.current) {
        window.clearTimeout(speechKickoffRef.current);
      }
      if (speakingTimerRef.current) {
        window.clearTimeout(speakingTimerRef.current);
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    const text = latestAssistantText.trim();
    if (!text || text === lastSpokenRef.current) return;

    lastSpokenRef.current = text;
    speechKickoffRef.current = window.setTimeout(() => {
      setIsSpeaking(true);
    }, 0);

    if (speakingTimerRef.current) {
      window.clearTimeout(speakingTimerRef.current);
    }
    speakingTimerRef.current = window.setTimeout(() => {
      setIsSpeaking(false);
    }, estimateSpeakingMs(text));

    if (!voiceEnabled || typeof window === "undefined" || !window.speechSynthesis) {
      return;
    }

    const speech = window.speechSynthesis;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    utterance.onend = () => {
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
    };
    speech.speak(utterance);
  }, [latestAssistantText, voiceEnabled]);

  return (
    <div className="digitalHumanShell">
      <div className="digitalHumanTopbar">
        <span className={`chip digitalStateChip ${presence}`}>
          <span className="digitalStateDot" />
          {statusText}
        </span>
        <button
          className={`btn ${voiceEnabled ? "btnPrimary" : ""}`}
          type="button"
          onClick={() => {
            setVoiceEnabled((prev) => {
              const next = !prev;
              if (!next && typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.cancel();
              }
              return next;
            });
          }}
        >
          {voiceEnabled ? "已开播报" : "静音模式"}
        </button>
      </div>

      <div className="digitalCustomizer cardInset">
        <div className="digitalCustomizerHeader">
          <div>
            <div className="digitalCaptionLabel">形象定制</div>
            <div className="digitalCustomizerTitle">上传一张图片，生成可爱版智能体</div>
          </div>
          <label className="btn btnPrimary digitalUploadBtn">
            {isGeneratingAvatar ? "生成中..." : customImageUrl ? "重新选图" : "上传图片"}
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleAvatarUpload}
              disabled={isGeneratingAvatar}
            />
          </label>
        </div>

        <div className="digitalCustomizeGrid">
          <div className="digitalPreviewCard">
            {customImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={customImageUrl} alt="用户上传的形象参考" className="digitalPreviewImage" />
            ) : (
              <div className="digitalPreviewPlaceholder">
                <span>上传自拍、宠物、插画都可以</span>
                <strong>我会提取颜色做成萌系形象</strong>
              </div>
            )}
          </div>

          <div className="digitalCustomizeMeta">
            <div className="digitalMetric soft">
              <span className="digitalMetricLabel">形象昵称</span>
              <strong>{theme.nickname}</strong>
            </div>
            <div className="digitalVibes">
              {theme.vibes.map((vibe) => (
                <span key={vibe} className="chip digitalVibeChip">
                  {vibe}
                </span>
              ))}
            </div>
            <div className="digitalSwatches">
              {[theme.aura, theme.hair, theme.outfit, theme.badge].map((color) => (
                <span
                  key={color}
                  className="digitalSwatch"
                  style={{ background: color }}
                  title={color}
                />
              ))}
            </div>
            <button className="btn" type="button" onClick={resetAvatarTheme}>
              恢复默认形象
            </button>
          </div>
        </div>

        {customizeError ? <div className="digitalErrorText">{customizeError}</div> : null}
      </div>

      <div className={`digitalStage ${presence}`} style={avatarStyle}>
        <div className="digitalGlow" />
        <div className="digitalAura" />
        <div className="digitalSparkle digitalSparkleA" />
        <div className="digitalSparkle digitalSparkleB" />
        <div className="digitalSparkle digitalSparkleC" />

        <div
          className={`digitalAvatar ${theme.hairShape} ${theme.feature} ${customImageUrl ? "isCustomized" : ""} ${expressionClass}`}
          aria-label="数字人小庆"
        >
          <div className="digitalHalo" />
          {customImageUrl ? (
            <div className="digitalImageEcho">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={customImageUrl} alt="形象定制纹理" className="digitalImageEchoPhoto" />
            </div>
          ) : null}
          <div className={`digitalAccessory ${theme.accessory}`} />
          <div className="digitalHair" />
          <div className={`digitalFace ${theme.eyeMood} ${theme.faceShape}`}>
            <div className="digitalBrows">
              <span />
              <span />
            </div>
            <div className="digitalEyes">
              <span />
              <span />
            </div>
            {theme.feature === "glasses" ? <div className="digitalGlasses" /> : null}
            {theme.feature === "headset" ? <div className="digitalHeadset" /> : null}
            <div className="digitalCheeks">
              <span />
              <span />
            </div>
            <div className="digitalMouth" />
          </div>
          <div className="digitalBody">
            <div className="digitalPendant" />
            <div className="digitalBodyGlow" />
          </div>
        </div>

        {customImageUrl ? (
          <div className="digitalReferenceBadge">
            <div className="digitalReferenceLabel">灵感图</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={customImageUrl} alt="定制参考图" className="digitalReferenceImage" />
          </div>
        ) : null}

        <div className="digitalBars" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, index) => (
            <span
              key={index}
              style={{ animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>
      </div>

      <div className="digitalCaptionCard">
        <div className="digitalCaptionLabel">当前播报</div>
        <div className="digitalCaptionText">{caption}</div>
      </div>

      <div className="digitalMetrics">
        <div className="digitalMetric">
          <span className="digitalMetricLabel">交互模式</span>
          <strong>语音 + 动态形象</strong>
        </div>
        <div className="digitalMetric">
          <span className="digitalMetricLabel">形象生成</span>
          <strong>{customImageUrl ? "图片定制已启用" : "等待上传图片"}</strong>
        </div>
      </div>
    </div>
  );
}