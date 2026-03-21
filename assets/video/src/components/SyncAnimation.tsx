import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { theme } from "./theme";
import { ClaudeIcon, CursorIcon, CodexIcon, CopilotIcon, GitHubIcon } from "./ToolIcons";

const outputFiles = [
  { name: "CLAUDE.md", platform: "Claude Code", Icon: ClaudeIcon, color: "#D97757" },
  { name: ".cursor/rules/", platform: "Cursor", Icon: CursorIcon, color: "#7dd3fc" },
  { name: "AGENTS.md", platform: "Codex", Icon: CodexIcon, color: "#86efac" },
  { name: "copilot-instructions.md", platform: "Copilot", Icon: CopilotIcon, color: "#c4b5fd" },
];

export const SyncAnimation: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const codeSpring = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 80 } });
  const arrowProgress = interpolate(frame, [20, 38], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const loopPulse = Math.sin(((frame % 30) / 30) * Math.PI * 2);
  const loopOpacity = interpolate(frame, [70, 88], [0, 1], { extrapolateRight: "clamp" });

  const arrowRotation = interpolate(frame, [38, 120], [0, 360], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: `radial-gradient(ellipse 50% 40% at 30% 50%, ${theme.green}06, transparent)`,
      }}
    >
      {/* Section label with GitHub icon */}
      <div
        style={{
          position: "absolute",
          top: "6%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          opacity: headerOpacity,
        }}
      >
        <GitHubIcon size={22} color={theme.textMuted} />
        <span
          style={{
            fontSize: 22,
            fontFamily: theme.fontMono,
            color: theme.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
          }}
        >
          Syncs against your Git
        </span>
      </div>

      {/* Headline */}
      <div
        style={{
          position: "absolute",
          top: "13%",
          fontSize: 46,
          fontWeight: 700,
          fontFamily: theme.fontSans,
          color: theme.text,
          opacity: headerOpacity,
          letterSpacing: "-0.02em",
        }}
      >
        Configs evolve with your code
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 44, marginTop: 24 }}>
        {/* Terminal-style diff card with GitHub icon in header */}
        <div
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.surfaceBorder}`,
            borderRadius: theme.radiusLg,
            opacity: codeSpring,
            transform: `scale(${interpolate(codeSpring, [0, 1], [0.95, 1])})`,
            minWidth: 340,
            overflow: "hidden",
            boxShadow: theme.terminalGlow,
          }}
        >
          {/* Terminal header with GitHub icon */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "10px 16px",
              backgroundColor: theme.surfaceHeader,
              borderBottom: `1px solid ${theme.surfaceBorder}`,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.red }} />
            <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.yellow }} />
            <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.green }} />
            <div style={{ marginLeft: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <GitHubIcon size={14} color={theme.textMuted} />
              <span style={{ color: theme.textMuted, fontSize: 14, fontFamily: theme.fontMono }}>
                git diff
              </span>
            </div>
          </div>

          {/* Diff content */}
          <div style={{ padding: "18px 22px", fontFamily: theme.fontMono, fontSize: 19, lineHeight: 2 }}>
            <div>
              <span style={{ color: theme.green, fontWeight: 600 }}>+</span>
              <span style={{ color: "#c4b5fd" }}> export function </span>
              <span style={{ color: theme.text }}>authenticate</span>
            </div>
            <div>
              <span style={{ color: theme.green, fontWeight: 600 }}>+</span>
              <span style={{ color: "#c4b5fd" }}> export function </span>
              <span style={{ color: theme.text }}>authorize</span>
            </div>
            <div>
              <span style={{ color: theme.green, fontWeight: 600 }}>+</span>
              <span style={{ color: "#c4b5fd" }}> export function </span>
              <span style={{ color: theme.text }}>rateLimit</span>
            </div>
            <div style={{ marginTop: 8, color: theme.textMuted, fontSize: 15 }}>
              src/lib/auth.ts — 3 new exports
            </div>
          </div>
        </div>

        {/* Animated sync circle */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: theme.surface,
              border: `1px solid ${theme.surfaceBorder}`,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              opacity: arrowProgress,
              transform: `scale(${arrowProgress})`,
              boxShadow: `0 0 30px ${theme.brand3}18`,
            }}
          >
            <svg
              width={38}
              height={38}
              viewBox="0 0 24 24"
              fill="none"
              style={{ transform: `rotate(${arrowRotation}deg)` }}
            >
              <path
                d="M4 12C4 7.58 7.58 4 12 4C15.37 4 18.24 6.11 19.38 9"
                stroke={theme.brand2}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <path
                d="M20 12C20 16.42 16.42 20 12 20C8.63 20 5.76 17.89 4.62 15"
                stroke={theme.brand2}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <path d="M17 9H20V6" stroke={theme.brand2} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 15H4V18" stroke={theme.brand2} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span
            style={{
              fontSize: 16,
              fontFamily: theme.fontMono,
              color: theme.brand2,
              opacity: arrowProgress,
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            $ caliber refresh
          </span>
        </div>

        {/* Output files with real platform icons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {outputFiles.map((file, i) => {
            const delay = 24 + i * 6;
            const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 75 } });
            return (
              <div
                key={file.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 20px",
                  backgroundColor: theme.surface,
                  border: `1px solid ${theme.surfaceBorder}`,
                  borderRadius: theme.radiusSm,
                  opacity: s,
                  transform: `translateX(${interpolate(s, [0, 1], [20, 0])}px)`,
                }}
              >
                <file.Icon size={24} color={file.color} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ color: theme.text, fontSize: 20, fontFamily: theme.fontMono, fontWeight: 500 }}>
                    {file.name}
                  </span>
                  <span style={{ color: theme.textMuted, fontSize: 15, fontFamily: theme.fontSans }}>
                    {file.platform}
                  </span>
                </div>
                <span style={{ color: theme.green, fontSize: 18, fontWeight: 700, marginLeft: "auto" }}>✓</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Continuous sync bar with GitHub icon */}
      <div
        style={{
          position: "absolute",
          bottom: "7%",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 36px",
          borderRadius: 32,
          backgroundColor: `${theme.brand3}0d`,
          border: `1px solid ${theme.brand3}20`,
          opacity: loopOpacity,
          boxShadow: theme.cardGlow,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.green,
            boxShadow: `0 0 ${8 + loopPulse * 5}px ${theme.green}60`,
          }}
        />
        <GitHubIcon size={20} color={theme.textSecondary} />
        <span style={{ color: theme.text, fontSize: 24, fontFamily: theme.fontSans, fontWeight: 600 }}>
          Every push. Every branch. Always in sync.
        </span>
      </div>
    </AbsoluteFill>
  );
};
