import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { theme } from "./theme";

function getScoreColor(score: number): string {
  if (score < 50) return theme.red;
  if (score < 70) return theme.yellow;
  return theme.green;
}

function getGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const categories = [
  { label: "Files & Setup", before: 6, after: 24, max: 25 },
  { label: "Quality", before: 12, after: 22, max: 25 },
  { label: "Grounding", before: 7, after: 19, max: 20 },
  { label: "Accuracy", before: 5, after: 13, max: 15 },
  { label: "Freshness", before: 5, after: 10, max: 10 },
  { label: "Bonus", before: 2, after: 5, max: 5 },
];

export const ScoreTransition: React.FC = () => {
  const frame = useCurrentFrame();

  const containerOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  // Linear counter from 47 to 94 over frames 25-55
  const counterProgress = interpolate(frame, [25, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const score = Math.round(interpolate(counterProgress, [0, 1], [47, 94]));
  const barWidth = interpolate(counterProgress, [0, 1], [47, 94]);
  const scoreColor = getScoreColor(score);
  const grade = getGrade(score);
  const glowIntensity = score >= 90 ? interpolate(frame, [58, 70], [0, 1], { extrapolateRight: "clamp" }) : 0;
  const subtitleOpacity = interpolate(frame, [70, 88], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: containerOpacity,
      }}
    >
      <div
        style={{
          backgroundColor: theme.surface,
          borderRadius: 20,
          border: `1px solid ${theme.surfaceBorder}`,
          minWidth: 1100,
          boxShadow: glowIntensity > 0 ? `0 0 80px -20px ${theme.green}20` : theme.terminalGlow,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 24px",
            backgroundColor: theme.surfaceHeader,
            borderBottom: `1px solid ${theme.surfaceBorder}`,
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.red }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.yellow }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.green }} />
          <span style={{ color: theme.textMuted, fontSize: 22, fontFamily: theme.fontMono, marginLeft: 16 }}>
            $ caliber score
          </span>
        </div>

        <div style={{ padding: "48px 64px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 28 }}>
            <span
              style={{
                color: theme.text,
                fontSize: 140,
                fontWeight: 700,
                fontFamily: theme.fontSans,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.03em",
              }}
            >
              {score}
            </span>
            <span style={{ color: theme.textMuted, fontSize: 48, fontFamily: theme.fontSans }}>/100</span>
            <div
              style={{
                marginLeft: "auto",
                padding: "10px 36px",
                borderRadius: 36,
                backgroundColor: `${scoreColor}15`,
                border: `1px solid ${scoreColor}30`,
                color: scoreColor,
                fontSize: 48,
                fontWeight: 700,
                fontFamily: theme.fontSans,
              }}
            >
              Grade {grade}
            </div>
          </div>

          <div
            style={{
              width: "100%",
              height: 12,
              backgroundColor: `${theme.textMuted}20`,
              borderRadius: 6,
              overflow: "hidden",
              marginBottom: 32,
            }}
          >
            <div
              style={{
                width: `${barWidth}%`,
                height: "100%",
                backgroundColor: scoreColor,
                borderRadius: 6,
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 44px" }}>
            {categories.map((cat) => {
              const catValue = Math.round(interpolate(counterProgress, [0, 1], [cat.before, cat.after]));
              const catProgress = catValue / cat.max;
              const catColor = catProgress >= 0.8 ? theme.green : catProgress >= 0.5 ? theme.yellow : theme.red;
              const catOpacity = interpolate(frame, [30, 42], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

              return (
                <div key={cat.label} style={{ display: "flex", alignItems: "center", gap: 16, opacity: catOpacity }}>
                  <span style={{ color: theme.textSecondary, fontSize: 28, fontFamily: theme.fontSans, minWidth: 200 }}>
                    {cat.label}
                  </span>
                  <div style={{ flex: 1, height: 8, backgroundColor: `${theme.textMuted}15`, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${catProgress * 100}%`, height: "100%", backgroundColor: catColor, borderRadius: 4 }} />
                  </div>
                  <span
                    style={{
                      color: catColor,
                      fontSize: 28,
                      fontWeight: 600,
                      fontFamily: theme.fontMono,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 90,
                      textAlign: "right",
                    }}
                  >
                    {catValue}/{cat.max}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "6%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          opacity: subtitleOpacity,
        }}
      >
        <div style={{ fontSize: 40, fontFamily: theme.fontSans, color: theme.text, fontWeight: 600 }}>
          Fully runs on your setup
        </div>
        <div style={{ fontSize: 28, fontFamily: theme.fontSans, color: theme.textMuted }}>
          No code sent anywhere. 100% local scoring. No API key needed.
        </div>
      </div>
    </AbsoluteFill>
  );
};
