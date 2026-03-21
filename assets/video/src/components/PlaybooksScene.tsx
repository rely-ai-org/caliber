import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { theme } from "./theme";
import { SkillsShIcon, AwesomeIcon, OpenSkillsIcon } from "./ToolIcons";

const buildSteps = [
  { frame: 20,  icon: "🔍", text: "Scanning Skills.sh registry...", color: theme.brand1 },
  { frame: 30,  icon: "🔍", text: "Scanning Awesome Claude Code...", color: theme.brand2 },
  { frame: 40,  icon: "🔍", text: "Scanning SkillsBench...", color: theme.green },
  { frame: 55,  icon: "⚡", text: "Installed skill: add-api-route", color: theme.brand3 },
  { frame: 65,  icon: "⚡", text: "Installed skill: drizzle-migrate", color: theme.brand3 },
  { frame: 75,  icon: "⚡", text: "Installed skill: auth-middleware", color: theme.brand3 },
  { frame: 85,  icon: "⚡", text: "Installed skill: test-patterns", color: theme.brand3 },
  { frame: 100, icon: "📝", text: "Generated CLAUDE.md — 847 lines", color: theme.accent },
  { frame: 112, icon: "📝", text: "Generated .cursor/rules/ — 12 files", color: theme.accent },
  { frame: 124, icon: "📝", text: "Generated AGENTS.md + copilot-instructions", color: theme.accent },
  { frame: 138, icon: "🔌", text: "Added MCP: context7 — docs lookup", color: "#c4b5fd" },
  { frame: 150, icon: "🔌", text: "Added MCP: postgres — database tools", color: "#c4b5fd" },
  { frame: 165, icon: "🧠", text: "Created CALIBER_LEARNINGS.md — memory", color: theme.green },
  { frame: 178, icon: "🧠", text: "Indexed 14 sessions → patterns extracted", color: theme.green },
  { frame: 192, icon: "✓",  text: "Setup complete — 94/100 Grade A", color: theme.green },
];

const fileTree = [
  { name: "CLAUDE.md", indent: 0, appearsAt: 100, status: "new" },
  { name: ".cursor/", indent: 0, appearsAt: 112, status: "dir" },
  { name: "rules/", indent: 1, appearsAt: 112, status: "dir" },
  { name: "api-patterns.mdc", indent: 2, appearsAt: 114, status: "new" },
  { name: "testing.mdc", indent: 2, appearsAt: 116, status: "new" },
  { name: "security.mdc", indent: 2, appearsAt: 118, status: "new" },
  { name: "AGENTS.md", indent: 0, appearsAt: 124, status: "new" },
  { name: "copilot-instructions.md", indent: 0, appearsAt: 126, status: "new" },
  { name: ".claude/", indent: 0, appearsAt: 138, status: "dir" },
  { name: "settings.local.json", indent: 1, appearsAt: 140, status: "mcp" },
  { name: "CALIBER_LEARNINGS.md", indent: 0, appearsAt: 165, status: "learn" },
];

const registries = [
  { name: "Skills.sh", Icon: SkillsShIcon, color: theme.brand1 },
  { name: "Awesome Claude Code", Icon: AwesomeIcon, color: theme.brand2 },
  { name: "SkillsBench", Icon: OpenSkillsIcon, color: theme.green },
];

export const PlaybooksScene: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  const scrollOffset = frame > 110
    ? interpolate(frame, [110, 192], [0, -200], { extrapolateRight: "clamp" })
    : 0;

  const phaseLabel = frame < 50 ? "Scanning registries..."
    : frame < 95 ? "Installing skills..."
    : frame < 135 ? "Generating configs..."
    : frame < 162 ? "Configuring MCPs..."
    : frame < 192 ? "Building persistent memory..."
    : "Setup complete!";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 40,
      }}
    >
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          fontFamily: theme.fontSans,
          color: theme.text,
          opacity: headerOpacity,
          letterSpacing: "-0.02em",
          marginBottom: 12,
        }}
      >
        Best playbooks, generated for your codebase
      </div>

      <div style={{ display: "flex", gap: 20, marginBottom: 24, opacity: headerOpacity }}>
        {registries.map((reg, i) => {
          const opacity = interpolate(frame, [4 + i * 3, 10 + i * 3], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={reg.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 24px",
                borderRadius: 28,
                backgroundColor: `${reg.color}12`,
                border: `1px solid ${reg.color}25`,
                opacity,
              }}
            >
              <reg.Icon size={26} color={reg.color} />
              <span style={{ fontSize: 24, fontWeight: 500, fontFamily: theme.fontSans, color: reg.color }}>
                {reg.name}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 32, width: 1720, maxHeight: 680 }}>
        {/* Terminal build log */}
        <div
          style={{
            flex: 1,
            backgroundColor: theme.surface,
            border: `1px solid ${theme.surfaceBorder}`,
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: theme.terminalGlow,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 22px",
              backgroundColor: theme.surfaceHeader,
              borderBottom: `1px solid ${theme.surfaceBorder}`,
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.red }} />
            <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.yellow }} />
            <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.green }} />
            <span style={{ color: theme.textMuted, fontSize: 20, fontFamily: theme.fontMono, marginLeft: 14 }}>
              $ caliber init
            </span>
          </div>

          <div style={{ padding: "20px 26px", overflow: "hidden", height: 520 }}>
            <div
              style={{
                fontSize: 20,
                fontFamily: theme.fontMono,
                color: theme.brand2,
                marginBottom: 14,
                fontWeight: 600,
                opacity: interpolate(frame, [16, 22], [0, 1], { extrapolateRight: "clamp" }),
              }}
            >
              {phaseLabel}
            </div>

            <div style={{ transform: `translateY(${scrollOffset}px)` }}>
              {buildSteps.map((step, i) => {
                const stepOpacity = interpolate(frame, [step.frame, step.frame + 5], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });

                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      marginBottom: 8,
                      opacity: stepOpacity,
                      fontFamily: theme.fontMono,
                      fontSize: 22,
                      lineHeight: 1.7,
                    }}
                  >
                    <span style={{ width: 28, textAlign: "center", fontSize: 20 }}>{step.icon}</span>
                    <span style={{ color: step.color }}>{step.text}</span>
                    <span
                      style={{
                        color: theme.green,
                        fontWeight: 700,
                        fontSize: 20,
                        opacity: interpolate(frame, [step.frame + 6, step.frame + 10], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        }),
                      }}
                    >
                      ✓
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* File tree */}
        <div
          style={{
            width: 540,
            backgroundColor: theme.surface,
            border: `1px solid ${theme.surfaceBorder}`,
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 22px",
              backgroundColor: theme.surfaceHeader,
              borderBottom: `1px solid ${theme.surfaceBorder}`,
            }}
          >
            <span style={{ color: theme.textMuted, fontSize: 20, fontFamily: theme.fontMono }}>
              Generated Files
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 18,
                fontFamily: theme.fontMono,
                color: theme.brand3,
                fontWeight: 600,
              }}
            >
              {fileTree.filter(f => frame >= f.appearsAt && f.status !== "dir").length} files
            </span>
          </div>

          <div style={{ padding: "16px 22px" }}>
            {fileTree.map((file, i) => {
              const fileOpacity = interpolate(frame, [file.appearsAt, file.appearsAt + 5], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

              const isDir = file.status === "dir";
              const statusColor = file.status === "new" ? theme.green
                : file.status === "mcp" ? "#c4b5fd"
                : file.status === "learn" ? theme.brand2
                : theme.textMuted;

              const statusBadge = file.status === "new" ? "NEW"
                : file.status === "mcp" ? "MCP"
                : file.status === "learn" ? "MEMORY"
                : null;

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    paddingLeft: file.indent * 24,
                    marginBottom: 6,
                    opacity: fileOpacity,
                    fontFamily: theme.fontMono,
                    fontSize: 20,
                    lineHeight: 1.8,
                  }}
                >
                  <span style={{ color: isDir ? theme.brand1 : theme.textSecondary, fontSize: 18 }}>
                    {isDir ? "📁" : "📄"}
                  </span>
                  <span style={{ color: isDir ? theme.brand1 : theme.text, fontWeight: isDir ? 600 : 400 }}>
                    {file.name}
                  </span>
                  {statusBadge && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 14,
                        fontWeight: 700,
                        padding: "3px 12px",
                        borderRadius: 14,
                        backgroundColor: `${statusColor}15`,
                        color: statusColor,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {statusBadge}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Summary pills */}
      <div
        style={{
          position: "absolute",
          bottom: "3%",
          display: "flex",
          alignItems: "center",
          gap: 28,
          opacity: interpolate(frame, [198, 212], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {[
          { label: "4 Skills", color: theme.brand3 },
          { label: "5 Config files", color: theme.accent },
          { label: "2 MCPs", color: "#c4b5fd" },
          { label: "Persistent memory", color: theme.green },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 28px",
              borderRadius: 32,
              backgroundColor: `${item.color}10`,
              border: `1px solid ${item.color}22`,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: item.color,
              }}
            />
            <span style={{ fontSize: 26, fontWeight: 600, fontFamily: theme.fontSans, color: item.color }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
