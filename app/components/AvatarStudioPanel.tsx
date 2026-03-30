"use client";

import type { ChangeEvent, CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./AvatarStudioPanel.module.css";

type AvatarStudioPanelProps = {
  latestAssistantText: string;
  isReplying: boolean;
  emotion?: "happy" | "calm" | "worried" | "surprised" | "neutral";
  onGenderDetected?: (gender: AvatarGender | null) => void;
};

type PresenceState = "idle" | "thinking" | "speaking";
type AvatarGender = "female" | "male";

type AvatarProfile = {
  nickname: string;
  vibes: string[];
  appearanceSummary: string;
  illustrationPrompt: string;
  hairShape: "bob" | "long" | "bun";
  faceShape: "soft" | "round" | "heart";
  bangs: "none" | "air" | "full" | "side";
  feature: "none" | "glasses" | "headset";
  accessory: "bow" | "star" | "leaf";
  eyeMood: "round" | "sparkle" | "wink";
  gender: AvatarGender;
};

type AvatarApiResponse = {
  requestToken?: string;
  profile?: AvatarProfile;
  illustrationPrompt?: string;
  illustrationUrl?: string;
  illustrationError?: string;
  error?: string;
};

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
  nickname: string;
};

const theme: AvatarTheme = {
  aura: "#dad6cc",
  auraSoft: "#f1efe9",
  hair: "#16181f",
  hairDeep: "#0a0b0f",
  outfit: "#cfd3dc",
  outfitSoft: "#e7e9ee",
  skin: "#f9e3d3",
  blush: "rgba(243, 157, 164, 0.22)",
  badge: "#f4f1ea",
  nickname: "小庆",
};

function createTheme(profile: AvatarProfile | null): AvatarTheme {
  if (!profile) return theme;
  const isFemale = profile.gender === "female";
  const hasHeadset = profile.feature === "headset";

  return {
    aura: isFemale ? "#d9d6cf" : "#d2cec4",
    auraSoft: isFemale ? "#f2efe9" : "#ece9e2",
    hair: isFemale ? "#151820" : "#1b1f28",
    hairDeep: isFemale ? "#090b10" : "#0c0f14",
    outfit: isFemale ? "#d0d4de" : "#c7ccd6",
    outfitSoft: isFemale ? "#e9ebf0" : "#e4e7ed",
    skin: "#f9e3d3",
    blush: isFemale ? "rgba(243, 157, 164, 0.24)" : "rgba(232, 150, 150, 0.18)",
    badge: hasHeadset ? "#efede7" : "#f4f1ea",
    nickname: profile.nickname || theme.nickname,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取失败"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

// 压缩图片使 base64 小于接口限制（绝大多数 API 限制 61440 字符）
function compressImageForApi(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 逾小就直接返回（原图已经小于限制）
      const prefix = dataUrl.split(",")[0] ?? "";
      if (prefix.startsWith("data:image/") && (dataUrl.split(",")[1]?.length ?? 0) <= 61440) {
        resolve(dataUrl);
        return;
      }

      // 逐步降格尝试，确保 base64 部分 ≤ 61440 字符
      const attempts: [number, number][] = [
        [512, 0.7],
        [512, 0.5],
        [384, 0.6],
        [256, 0.7],
        [256, 0.5],
      ];

      for (const [maxDim, quality] of attempts) {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas不可用")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const result = canvas.toDataURL("image/jpeg", quality);
        const b64len = result.split(",")[1]?.length ?? 0;
        if (b64len > 0 && b64len <= 61440) {
          resolve(result);
          return;
        }
      }

      // 最后应急
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas不可用")); return; }
      ctx.drawImage(img, 0, 0, 200, 200);
      resolve(canvas.toDataURL("image/jpeg", 0.4));
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = dataUrl;
  });
}

function estimateSpeakingMs(text: string) {
  const base = Math.max(1800, text.length * 120);
  return Math.min(base, 8000);
}

function withCacheBust(url: string) {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}t=${Date.now()}`;
}

function buildRequestToken(dataUrl: string) {
  let hash = 0;
  for (let index = 0; index < dataUrl.length; index += 89) {
    hash = (hash * 33 + dataUrl.charCodeAt(index)) >>> 0;
  }
  return `${Date.now()}_${dataUrl.length}_${hash}`;
}

export default function AvatarStudioPanel({
  latestAssistantText,
  isReplying,
  emotion = "neutral",
  onGenderDetected,
}: AvatarStudioPanelProps) {
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [avatarProfile, setAvatarProfile] = useState<AvatarProfile | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState("");
  const [generatingError, setGeneratingError] = useState("");
  const [illustrationError, setIllustrationError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [avatarRenderKey, setAvatarRenderKey] = useState(0);
  const [nickname, setNickname] = useState(theme.nickname);
  const [nicknameCustomized, setNicknameCustomized] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechTimerRef = useRef<number | null>(null);
  const lastSpokenRef = useRef("");
  const requestSeqRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const activeRequestTokenRef = useRef("");
  const uploadSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    const text = latestAssistantText.trim();
    if (!text || text === lastSpokenRef.current) return;

    lastSpokenRef.current = text;
    setIsSpeaking(true);

    if (speechTimerRef.current) {
      window.clearTimeout(speechTimerRef.current);
    }

    speechTimerRef.current = window.setTimeout(() => {
      setIsSpeaking(false);
    }, estimateSpeakingMs(text));
  }, [latestAssistantText]);

  useEffect(() => {
    return () => {
      if (speechTimerRef.current) {
        window.clearTimeout(speechTimerRef.current);
      }
      requestAbortRef.current?.abort();
    };
  }, []);

  const activeTheme = useMemo(() => createTheme(avatarProfile), [avatarProfile]);
  const hasGeneratedAvatar = Boolean(generatedImageUrl);
  const showAvatarMeta = Boolean(avatarProfile) || hasGeneratedAvatar || isGenerating;
  const detectedNickname = avatarProfile?.nickname || activeTheme.nickname;
  const shownNickname = nickname.trim() || detectedNickname;

  useEffect(() => {
    if (!nicknameCustomized) {
      setNickname(detectedNickname);
    }
  }, [detectedNickname, nicknameCustomized]);

  const stageStyle: CSSProperties = {
    "--agent-aura": activeTheme.aura,
    "--agent-aura-soft": activeTheme.auraSoft,
    "--agent-hair": activeTheme.hair,
    "--agent-hair-deep": activeTheme.hairDeep,
    "--agent-outfit": activeTheme.outfit,
    "--agent-outfit-soft": activeTheme.outfitSoft,
    "--agent-skin": activeTheme.skin,
    "--agent-blush": activeTheme.blush,
    "--agent-badge": activeTheme.badge,
  } as CSSProperties;

  async function generateFromPhoto(dataUrl: string) {
    if (!dataUrl) return;
    requestAbortRef.current?.abort();
    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setAvatarRenderKey((prev) => prev + 1);
    const requestToken = buildRequestToken(dataUrl);
    activeRequestTokenRef.current = requestToken;

    // 上传新图后先清空旧形象，避免视觉残留。
    setAvatarProfile(null);
    onGenderDetected?.(null);
    setGeneratedImageUrl("");
    setIsGenerating(true);
    setGeneratingError("");
    setIllustrationError("");

    try {
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, requestToken }),
        signal: abortController.signal,
      });

      if (seq !== requestSeqRef.current) return;

      const data = (await res.json().catch(() => null)) as AvatarApiResponse | null;
      if (!data || data.requestToken !== activeRequestTokenRef.current) {
        return;
      }
      if (!res.ok) {
        const reason = data?.error || `HTTP ${res.status}`;
        throw new Error(reason);
      }

      if (data.profile) {
        setAvatarProfile(data.profile);
        onGenderDetected?.(data.profile.gender);
        if (!nicknameCustomized) {
          setNickname(data.profile.nickname || theme.nickname);
        }
      }

      if (data.illustrationUrl) {
        // DashScope 返回的 OSS 签名 URL 不加额外参数，防止破坏签名
        setGeneratedImageUrl(data.illustrationUrl);
      } else {
        setGeneratedImageUrl("");
      }

      setIllustrationError(data.illustrationError || "");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setGeneratingError(error instanceof Error ? error.message : "生成失败，请稍后重试");
      setGeneratedImageUrl("");
    } finally {
      if (seq === requestSeqRef.current) {
        setIsGenerating(false);
      }
    }
  }

  async function onUploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const uploadSeq = uploadSeqRef.current + 1;
    uploadSeqRef.current = uploadSeq;
    requestAbortRef.current?.abort();
    requestSeqRef.current += 1;
    activeRequestTokenRef.current = `upload_${Date.now()}`;

    setGeneratingError("");
    setIllustrationError("");
    setPhotoDataUrl("");
    setGeneratedImageUrl("");
    setAvatarProfile(null);
    onGenderDetected?.(null);
    setAvatarRenderKey((prev) => prev + 1);

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }

    const preview = URL.createObjectURL(file);
    setPhotoPreviewUrl(preview);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (uploadSeq !== uploadSeqRef.current) return;
      // 压缩到 API 限制内（保留预览缩略图不变）
      const apiDataUrl = await compressImageForApi(dataUrl);
      if (uploadSeq !== uploadSeqRef.current) return;
      setPhotoDataUrl(apiDataUrl);
      await generateFromPhoto(apiDataUrl);
    } catch (error) {
      if (uploadSeq !== uploadSeqRef.current) return;
      setGeneratingError(error instanceof Error ? error.message : "读取照片失败");
    }
  }

  const presence: PresenceState = isReplying ? "thinking" : isSpeaking ? "speaking" : "idle";

  const moodLabel =
    isGenerating
      ? "正在生成Q版数字人"
      : !hasGeneratedAvatar
      ? ""
      : presence === "thinking"
      ? "认真思考中"
      : presence === "speaking"
        ? "元气回应中"
        : "待机陪伴中";

  // 动态添加 presence 类
  const stageClassName = [
    styles.minimalStage,
    styles[`presence_${presence}`],
    styles[`expression_${emotion}`],
  ].join(" ");

  return (
    <div className={styles.minimalShell}>
      <div className={stageClassName} style={stageStyle}>
        {hasGeneratedAvatar ? (
          <>
            <div className={styles.stageGlow} />
            <div className={styles.stageAura} />
            <div className={styles.sparkleA} />
            <div className={styles.sparkleB} />
            <div className={styles.heartA} />
            <div className={styles.heartB} />
          </>
        ) : null}

        {hasGeneratedAvatar ? (
          <>
            <div className={styles.voiceWaveLayer} aria-hidden="true">
              <span className={`${styles.voiceWave} ${styles.voiceWaveA}`} />
              <span className={`${styles.voiceWave} ${styles.voiceWaveB}`} />
              <span className={`${styles.voiceWave} ${styles.voiceWaveC}`} />
            </div>
            <div key={`generated-${avatarRenderKey}`} className={styles.generatedAvatar}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.generatedAvatarImage}
                src={generatedImageUrl}
                alt="Q版数字人"
                onError={() => {
                  setGeneratedImageUrl("");
                  setIllustrationError((prev) =>
                    prev ? `${prev}（图片加载失败，请重新生成）` : "图片加载失败，请重新生成",
                  );
                }}
              />
            </div>
          </>
        ) : (
          <div key={`blank-${avatarRenderKey}`} className={styles.blankStage}>
            <span className={styles.blankHint}>{isGenerating ? "正在根据新照片生成形象..." : ""}</span>
          </div>
        )}
      </div>

      <div className={styles.nicknamePanel}>
        <div className={styles.avatarActions}>
          <label className={styles.uploadBtn}>
            上传照片
            <input type="file" accept="image/*" onChange={onUploadPhoto} />
          </label>
          <button
            type="button"
            className={styles.generateBtn}
            onClick={() => void generateFromPhoto(photoDataUrl)}
            disabled={!photoDataUrl || isGenerating}
          >
            {isGenerating ? "生成中..." : "重新生成"}
          </button>
        </div>

        {photoPreviewUrl ? (
          <div className={styles.previewRow}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.previewThumb} src={photoPreviewUrl} alt="用户上传照片" />
            <div className={styles.previewMeta}>
              {avatarProfile?.gender === "female"
                ? "已识别：女性，使用知性温柔女声"
                : avatarProfile?.gender === "male"
                  ? "已识别：男性，使用成熟高冷男声"
                  : "已上传照片，正在匹配形象与声线"}
            </div>
          </div>
        ) : null}

        {generatingError ? <div className={styles.errorText}>生成失败：{generatingError}</div> : null}
        {illustrationError ? <div className={styles.warnText}>出图提醒：{illustrationError}</div> : null}

        <div className={styles.nicknameEditor}>
          <input
            className={styles.nicknameInput}
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setNicknameCustomized(true);
            }}
            placeholder="输入数字人昵称"
            maxLength={16}
            aria-label="数字人昵称"
          />
          <button
            type="button"
            className={styles.nicknameResetBtn}
            onClick={() => {
              setNicknameCustomized(false);
              setNickname(detectedNickname);
            }}
          >
            使用识别昵称
          </button>
        </div>
        {showAvatarMeta ? <strong className={styles.nicknameValue}>{shownNickname}</strong> : null}
        {showAvatarMeta ? <span className={styles.moodText}>{moodLabel}</span> : null}
        {showAvatarMeta && avatarProfile?.vibes?.length ? (
          <div className={styles.vibeRow}>
            {avatarProfile.vibes.map((vibe) => (
              <span key={vibe} className={styles.vibeChip}>
                {vibe}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
