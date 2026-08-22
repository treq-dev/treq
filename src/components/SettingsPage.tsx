import { FolderGit2, GitBranch, Plug, Settings, User } from "lucide-react";
import { useRef, useState } from "react";
import useSWR from "swr";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { useThemeStore } from "../stores/themeStore";
import { useTerminalSettingsStore } from "../stores/terminalSettingsStore";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  useZoomSettingsStore,
} from "../stores/zoomSettingsStore";
import { getSetting, setSetting } from "../lib/api";
import { AccountSettings } from "./AccountSettings";
import { GitHubIntegrationSettings } from "./GitHubIntegrationSettings";
import {
  RepositorySettingsContent,
  type RepositorySettingsContentHandle,
} from "./RepositorySettingsContent";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useToast } from "./ui/toast";

type TabValue = "application" | "repository" | "account" | "integrations";

interface SettingsPageProps {
  repoPath: string;
  onClose: () => void;
  currentBranch?: string | null;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  repoPath,
  onClose,
  currentBranch,
}) => {
  const [currentTab, setCurrentTab] = useState<TabValue>("repository");
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<string | null>(null);
  const [conflictDraft, setConflictDraft] = useState<string | null>(null);
  const [fontDraft, setFontDraft] = useState<number | null>(null);
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const [savingRepository, setSavingRepository] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const repositorySettingsRef = useRef<RepositorySettingsContentHandle>(null);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const fontSize = useTerminalSettingsStore((s) => s.fontSize);
  const setFontSize = useTerminalSettingsStore((s) => s.setFontSize);
  const zoom = useZoomSettingsStore((s) => s.zoom);
  const setZoom = useZoomSettingsStore((s) => s.setZoom);
  const { addToast } = useToast();
  const { checkForUpdate } = useAutoUpdate({
    autoCheck: false,
    listenMenu: false,
  });
  const { data: savedModel } = useSWR(["setting", "default_model"], () =>
    getSetting("default_model"),
  );
  const { data: savedAgent } = useSWR(["setting", "default_agent"], () =>
    getSetting("default_agent"),
  );
  const { data: savedConflict } = useSWR(
    ["setting", "conflict_marker_style"],
    () => getSetting("conflict_marker_style"),
  );
  const defaultModel = modelDraft ?? savedModel ?? "";
  const defaultAgent = agentDraft ?? savedAgent ?? "";
  const conflictMarkerStyle = conflictDraft ?? savedConflict ?? "git";
  const localFontSize = fontDraft ?? fontSize;
  const localZoom = zoomDraft ?? zoom;
  const originalFontSize = fontSize;
  const setDefaultModel = setModelDraft;
  const setDefaultAgent = setAgentDraft;
  const setConflictMarkerStyle = setConflictDraft;
  const setLocalFontSize = setFontDraft;
  const setLocalZoom = setZoomDraft;

  const handleSaveApplicationSettings = async () => {
    try {
      await setSetting("default_model", defaultModel);
      await setSetting("default_agent", defaultAgent);
      await setSetting("conflict_marker_style", conflictMarkerStyle);
      await setFontSize(localFontSize);
      await setZoom(localZoom);

      addToast({
        title: "Settings Saved",
        description: "Application settings updated successfully",
        type: "success",
      });
    } catch (error) {
      addToast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  const handleSaveRepositorySettings = async () => {
    await repositorySettingsRef.current?.save();
  };

  return (
    <>
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <div className="border-b border-border px-6 py-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Settings</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            {currentTab === "application" && (
              <Button size="sm" onClick={handleSaveApplicationSettings}>
                Save Settings
              </Button>
            )}
            {currentTab === "repository" && repoPath && (
              <Button
                size="sm"
                onClick={handleSaveRepositorySettings}
                disabled={savingRepository}
              >
                {savingRepository ? "Saving..." : "Save Settings"}
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto p-6">
            <Tabs
              value={currentTab}
              onValueChange={(value) => setCurrentTab(value as TabValue)}
              orientation="vertical"
              className="flex gap-8"
            >
              {/* Left sidebar with vertical tabs */}
              <TabsList className="w-48 flex-shrink-0 sticky top-0">
                <TabsTrigger value="repository">
                  <FolderGit2 className="w-4 h-4" />
                  Repository
                </TabsTrigger>
                <TabsTrigger value="application">
                  <Settings className="w-4 h-4" />
                  Application
                </TabsTrigger>
                <TabsTrigger value="account">
                  <User className="w-4 h-4" />
                  Account
                </TabsTrigger>
                <TabsTrigger value="integrations">
                  <Plug className="w-4 h-4" />
                  Integrations
                </TabsTrigger>
              </TabsList>

              {/* Right content area */}
              <div className="flex-1 min-w-0">
                <TabsContent value="application">
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="theme">Theme</Label>
                      <select
                        id="theme"
                        value={theme}
                        onChange={(e) =>
                          setTheme(
                            e.target.value as "system" | "light" | "dark",
                          )
                        }
                        className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-foreground"
                      >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="ui-zoom">UI Zoom</Label>
                        <span className="text-sm text-muted-foreground">
                          {localZoom}%
                        </span>
                      </div>
                      <Slider
                        id="ui-zoom"
                        aria-label="UI Zoom"
                        min={MIN_ZOOM}
                        max={MAX_ZOOM}
                        step={ZOOM_STEP}
                        value={[localZoom]}
                        onValueChange={([value]) => setLocalZoom(value)}
                        className="mt-3"
                      />
                      <p className="text-sm text-muted-foreground mt-2">
                        Scale the application interface. Use Ctrl/Cmd + + to
                        zoom in and Ctrl/Cmd + - to zoom out in 5% steps.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="font-size">Font Size</Label>
                      <Input
                        id="font-size"
                        type="number"
                        min={8}
                        max={32}
                        value={localFontSize}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          if (!isNaN(value) && value >= 8 && value <= 32) {
                            setLocalFontSize(value);
                          }
                        }}
                        placeholder="14"
                        className="mt-2"
                      />
                      {originalFontSize !== null &&
                        localFontSize !== originalFontSize && (
                          <div className="mt-3 p-3 border rounded-md bg-muted/30">
                            <div className="text-sm text-muted-foreground mb-2">
                              Preview:
                            </div>
                            <div className="space-y-2">
                              <div
                                style={{ fontSize: `${originalFontSize}px` }}
                                className="font-mono text-muted-foreground"
                              >
                                Original ({originalFontSize}px): The quick brown
                                fox jumps over the lazy dog
                              </div>
                              <div
                                style={{ fontSize: `${localFontSize}px` }}
                                className="font-mono"
                              >
                                New ({localFontSize}px): The quick brown fox
                                jumps over the lazy dog
                              </div>
                            </div>
                          </div>
                        )}
                      <p className="text-sm text-muted-foreground mt-2">
                        Font size for terminal, code diff display, and overview
                        files (8-32)
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="default-model">Claude Code Model</Label>
                      <select
                        id="default-model"
                        value={defaultModel}
                        onChange={(e) => setDefaultModel(e.target.value)}
                        className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-foreground"
                      >
                        <option value="">Default</option>
                        <option value="sonnet">Sonnet</option>
                        <option value="opus">Opus</option>
                        <option value="haiku">Haiku</option>
                        <option value="sonnet[1m]">Sonnet (1M)</option>
                        <option value="opusplan">Opus Plan</option>
                      </select>
                      <p className="text-sm text-muted-foreground mt-1">
                        Default model for new Claude Code sessions
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="default-agent">Default Agent</Label>
                      <select
                        id="default-agent"
                        value={defaultAgent}
                        onChange={(e) => setDefaultAgent(e.target.value)}
                        className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-foreground"
                      >
                        <option value="">Default (Claude)</option>
                        <option value="claude">Claude</option>
                        <option value="codex">Codex</option>
                        <option value="cursor">Cursor</option>
                      </select>
                      <p className="text-sm text-muted-foreground mt-1">
                        Default agent for new sessions
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="conflict-marker-style">
                        Conflict Marker Style
                      </Label>
                      <select
                        id="conflict-marker-style"
                        value={conflictMarkerStyle}
                        onChange={(e) => setConflictMarkerStyle(e.target.value)}
                        className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-foreground"
                      >
                        <option value="git">Git Diff3 (Default)</option>
                        <option value="diff">JJ Diff</option>
                        <option value="snapshot">JJ Snapshot</option>
                      </select>
                      <p className="text-sm text-muted-foreground mt-1">
                        Style of conflict markers written to files during
                        rebase. Git Diff3 is compatible with most editors.
                      </p>
                    </div>

                    <div>
                      <Label>Updates</Label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Compare this build against the published version at
                        treq.dev/version. Automatic install is available on
                        macOS.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={checkingUpdate}
                        onClick={async () => {
                          setCheckingUpdate(true);
                          try {
                            await checkForUpdate();
                          } finally {
                            setCheckingUpdate(false);
                          }
                        }}
                      >
                        {checkingUpdate ? "Checking…" : "Check for updates"}
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="repository">
                  {repoPath ? (
                    <div className="space-y-6">
                      {/* Repository Info Section */}
                      {currentBranch && (
                        <div className="space-y-3 text-sm border-b border-border pb-6">
                          <div className="space-y-1">
                            <div className="text-sm text-muted-foreground">
                              Current Branch
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <GitBranch className="w-3 h-3" />
                              <code>{currentBranch}</code>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Repository Settings */}
                      <RepositorySettingsContent
                        ref={repositorySettingsRef}
                        repoPath={repoPath}
                        onSavingChange={setSavingRepository}
                      />
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      Set repository in Application tab
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="account">
                  <AccountSettings />
                </TabsContent>
                <TabsContent value="integrations">
                  <GitHubIntegrationSettings repoPath={repoPath} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Note: Git Init Dialog removed - JJ doesn't need this */}
    </>
  );
};
