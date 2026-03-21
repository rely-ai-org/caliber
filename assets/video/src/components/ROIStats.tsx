import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Logo } from "./Logo";
import { theme } from "./theme";

const stats = [
  { value: "20x", label: "Fewer tokens", desc: "Grounded configs = focused agents", color: theme.brand3 },
  { value: "10x", label: "Faster velocity", desc: "Best practices built in from day one", color: theme.accent },
  { value: "4", label: "Platforms", desc: "Claude · Cursor · Codex · Copilot", color: theme.green },
  { value: "0", label: "Config drift", desc: "Continuous sync keeps it all aligned", color: theme.brand1 },
];

export const ROIStats: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const ctaOpacity = interpolate(frame, [45, 60], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "5%",
          fontSize: 32,
          fontFamily: theme.fontMono,
          color: theme.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          opacity: headerOpacity,
        }}
      >
        The Impact
      </div>

      <div
        style={{
          position: "absolute",
          top: "12%",
          fontSize: 64,
          fontWeight: 700,
          fontFamily: theme.fontSans,
          color: theme.text,
          opacity: headerOpacity,
          letterSpacing: "-0.02em",
        }}
      >
        Maximum velocity. Minimum cost.
      </div>

      <div style={{ display: "flex", gap: 32, marginTop: 14 }}>
        {stats.map((stat, i) => {
          const delay = 6 + i * 5;
          const opacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          // Simple linear counter
          const counterProgress = interpolate(frame, [delay + 4, delay + 20], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const numericValue = parseInt(stat.value, 10);
          const isMultiplier = stat.value.includes("x");
          const displayNum = isNaN(numericValue) ? stat.value : Math.round(numericValue * counterProgress);
          const displayValue = isMultiplier ? `${displayNum}x` : `${displayNum}`;

          return (
            <div
              key={stat.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "44px 40px",
                backgroundColor: theme.surface,
                border: `1px solid ${theme.surfaceBorder}`,
                borderRadius: 20,
                minWidth: 300,
                opacity,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: stat.color,
                  marginBottom: 24,
                }}
              />
              <div
                style={{
                  fontSize: 96,
                  fontWeight: 800,
                  fontFamily: theme.fontSans,
                  color: stat.color,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                  marginBottom: 14,
                }}
              >
                {displayValue}
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  fontFamily: theme.fontSans,
                  color: theme.text,
                  marginBottom: 10,
                  textAlign: "center",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontFamily: theme.fontSans,
                  color: theme.textMuted,
                  textAlign: "center",
                  maxWidth: 260,
                  lineHeight: 1.4,
                }}
              >
                {stat.desc}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "4%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          opacity: ctaOpacity,
        }}
      >
        <Logo size={0.8} animate={false} />
        <div
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.surfaceBorder}`,
            borderRadius: 44,
            padding: "20px 52px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            boxShadow: theme.terminalGlow,
          }}
        >
          <span style={{ color: theme.textMuted, fontFamily: theme.fontMono, fontSize: 36 }}>$</span>
          <span style={{ color: theme.text, fontFamily: theme.fontMono, fontSize: 36, fontWeight: 500 }}>
            npx @rely-ai/caliber init
          </span>
        </div>
        <div style={{ fontSize: 30, fontFamily: theme.fontSans, color: theme.textSecondary, fontWeight: 400 }}>
          One command. Every AI agent. Always in sync.
        </div>
      </div>
    </AbsoluteFill>
  );
};
