import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Logo } from "./Logo";
import { theme } from "./theme";
import { ClaudeIcon, CursorIcon, CodexIcon, CopilotIcon } from "./ToolIcons";

const editors = [
  { name: "Claude Code", Icon: ClaudeIcon, color: "#D97757", x: -420, y: -60 },
  { name: "Cursor", Icon: CursorIcon, color: "#7dd3fc", x: 420, y: -60 },
  { name: "Codex", Icon: CodexIcon, color: "#86efac", x: -340, y: 100 },
  { name: "Copilot", Icon: CopilotIcon, color: "#c4b5fd", x: 340, y: 100 },
];

export const EcosystemHub: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [8, 22], [0, 1], { extrapolateRight: "clamp" });
  const taglineOpacity = interpolate(frame, [20, 34], [0, 1], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [36, 50], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${theme.brand3}0a, transparent)`,
      }}
    >
      {/* Static orbit rings */}
      <div
        style={{
          position: "absolute",
          width: 780,
          height: 780,
          borderRadius: "50%",
          border: `1px solid ${theme.brand3}12`,
          opacity: interpolate(frame, [20, 40], [0, 0.6], { extrapolateRight: "clamp" }),
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 660,
          height: 660,
          borderRadius: "50%",
          border: `1px dashed ${theme.surfaceBorder}`,
          opacity: interpolate(frame, [18, 38], [0, 0.3], { extrapolateRight: "clamp" }),
        }}
      />

      <div style={{ marginBottom: 24, zIndex: 1 }}>
        <Logo size={1.6} animate={false} />
      </div>

      <div
        style={{
          fontSize: 120,
          fontWeight: 800,
          fontFamily: theme.fontSans,
          letterSpacing: "-0.04em",
          background: `linear-gradient(135deg, ${theme.brand1}, ${theme.brand3})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          opacity: titleOpacity,
          zIndex: 1,
        }}
      >
        caliber
      </div>

      <div
        style={{
          fontSize: 48,
          fontFamily: theme.fontSans,
          color: theme.textSecondary,
          opacity: taglineOpacity,
          marginTop: 14,
          fontWeight: 400,
          zIndex: 1,
        }}
      >
        AI setup tailored for your codebase
      </div>

      <div
        style={{
          marginTop: 28,
          padding: "20px 48px",
          borderRadius: 40,
          backgroundColor: `${theme.brand3}12`,
          border: `1px solid ${theme.brand3}25`,
          opacity: subtitleOpacity,
          display: "flex",
          alignItems: "center",
          gap: 14,
          zIndex: 1,
        }}
      >
        <span style={{ fontSize: 38, fontFamily: theme.fontSans, color: theme.brand1, fontWeight: 600 }}>
          Bring your own AI
        </span>
        <span style={{ fontSize: 32, fontFamily: theme.fontSans, color: theme.textSecondary }}>
          — API key or coding agent seat
        </span>
      </div>

      {/* Editor pills — simple fade in at fixed positions */}
      {editors.map((editor, i) => {
        const delay = 16 + i * 5;
        const opacity = interpolate(frame, [delay, delay + 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={editor.name}
            style={{
              position: "absolute",
              left: `calc(50% + ${editor.x}px - 120px)`,
              top: `calc(44% + ${editor.y}px - 32px)`,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 32px",
              borderRadius: 36,
              backgroundColor: theme.surface,
              border: `1px solid ${theme.surfaceBorder}`,
              color: theme.text,
              fontSize: 30,
              fontWeight: 500,
              fontFamily: theme.fontSans,
              opacity,
            }}
          >
            <editor.Icon size={36} color={editor.color} />
            {editor.name}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
