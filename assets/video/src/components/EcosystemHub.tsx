import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { Logo } from "./Logo";
import { theme } from "./theme";
import { ClaudeIcon, CursorIcon, CodexIcon, CopilotIcon } from "./ToolIcons";

const editors = [
  { name: "Claude Code", Icon: ClaudeIcon, color: "#D97757", angle: -40 },
  { name: "Cursor", Icon: CursorIcon, color: "#7dd3fc", angle: 40 },
  { name: "Codex", Icon: CodexIcon, color: "#86efac", angle: 150 },
  { name: "Copilot", Icon: CopilotIcon, color: "#c4b5fd", angle: 210 },
];

export const EcosystemHub: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [10, 28], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [10, 28], [16, 0], { extrapolateRight: "clamp" });
  const taglineOpacity = interpolate(frame, [22, 40], [0, 1], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [48, 68], [0, 1], { extrapolateRight: "clamp" });

  const orbitRotation = interpolate(frame, [0, 120], [0, 12], { extrapolateRight: "clamp" });

  // Blinking cursor for the subtitle
  const cursorVisible = Math.floor(frame / 15) % 2 === 0;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${theme.brand3}0a, transparent)`,
      }}
    >
      {/* Orbital rings */}
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          border: `1px solid ${theme.brand3}12`,
          opacity: interpolate(frame, [20, 45], [0, 0.8], { extrapolateRight: "clamp" }),
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 440,
          height: 440,
          borderRadius: "50%",
          border: `1px dashed ${theme.surfaceBorder}`,
          opacity: interpolate(frame, [18, 40], [0, 0.4], { extrapolateRight: "clamp" }),
        }}
      />

      {/* Center glow */}
      <div
        style={{
          position: "absolute",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.brand3}15, transparent 70%)`,
          filter: "blur(40px)",
          opacity: interpolate(frame, [5, 25], [0, 1], { extrapolateRight: "clamp" }),
        }}
      />

      {/* Logo */}
      <div style={{ marginBottom: 18, zIndex: 1 }}>
        <Logo size={1.1} animate delay={0} />
      </div>

      {/* Brand name */}
      <div
        style={{
          fontSize: 84,
          fontWeight: 800,
          fontFamily: theme.fontSans,
          letterSpacing: "-0.04em",
          background: `linear-gradient(135deg, ${theme.brand1}, ${theme.brand3})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          zIndex: 1,
        }}
      >
        caliber
      </div>

      {/* Primary tagline */}
      <div
        style={{
          fontSize: 34,
          fontFamily: theme.fontSans,
          color: theme.textSecondary,
          opacity: taglineOpacity,
          marginTop: 10,
          fontWeight: 400,
          zIndex: 1,
        }}
      >
        AI setup tailored for your codebase
      </div>

      {/* Key message with terminal-style */}
      <div
        style={{
          marginTop: 20,
          padding: "14px 32px",
          borderRadius: 28,
          backgroundColor: `${theme.brand3}12`,
          border: `1px solid ${theme.brand3}25`,
          opacity: subtitleOpacity,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 1,
          boxShadow: theme.cardGlow,
        }}
      >
        <span style={{ fontSize: 26, fontFamily: theme.fontSans, color: theme.brand1, fontWeight: 600 }}>
          Bring your own AI
        </span>
        <span style={{ fontSize: 22, fontFamily: theme.fontSans, color: theme.textSecondary }}>
          — API key or coding agent seat
        </span>
        {/* Blinking cursor */}
        <div
          style={{
            width: 3,
            height: 24,
            backgroundColor: theme.brand3,
            opacity: cursorVisible ? 1 : 0,
            marginLeft: 2,
          }}
        />
      </div>

      {/* Editor nodes with real icons */}
      {editors.map((editor, i) => {
        const delay = 18 + i * 6;
        const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 65 } });
        const radius = 230;
        const angle = ((editor.angle + orbitRotation) * Math.PI) / 180;
        const x = Math.cos(angle) * radius * s;
        const y = Math.sin(angle) * radius * 0.52 * s;

        const lineProgress = interpolate(frame, [delay + 8, delay + 22], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        const pulsePhase = ((frame - delay) % 45) / 45;
        const pulseOpacity = s > 0.9 ? 0.12 + Math.sin(pulsePhase * Math.PI * 2) * 0.08 : 0;

        return (
          <div key={editor.name}>
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              <defs>
                <linearGradient id={`line-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={theme.brand3} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={editor.color} stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <line
                x1="50%"
                y1="44%"
                x2={`${50 + (x / 12.8)}%`}
                y2={`${44 + (y / 7.2)}%`}
                stroke={`url(#line-${i})`}
                strokeWidth={1.5}
                opacity={lineProgress}
                strokeDasharray="4 6"
              />
            </svg>

            <div
              style={{
                position: "absolute",
                left: `calc(50% + ${x}px - 84px)`,
                top: `calc(44% + ${y}px - 24px)`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 24px",
                borderRadius: 28,
                backgroundColor: theme.surface,
                border: `1px solid ${theme.surfaceBorder}`,
                color: theme.text,
                fontSize: 21,
                fontWeight: 500,
                fontFamily: theme.fontSans,
                opacity: s,
                transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`,
                boxShadow: `0 0 28px ${editor.color}${Math.round(pulseOpacity * 255).toString(16).padStart(2, "0")}`,
              }}
            >
              <editor.Icon size={26} color={editor.color} />
              {editor.name}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
