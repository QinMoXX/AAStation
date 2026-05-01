import { useCallback, useEffect, useState } from 'react';
import { toast } from '../../store/toast-store';
import {
  collectSkills,
  getSkillsToolConfig,
  listSkills,
  enableSkill,
  disableSkill,
  enableAllSkills,
  disableAllSkills,
  type SkillInfo,
} from '../../lib/tauri-api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { RefreshCw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

type PluginSubTab = 'skills';

export default function AgentPluginsPage() {
  const [subTab, setSubTab] = useState<PluginSubTab>('skills');

  // -----------------------------------------------------------------------
  // Skills management
  // -----------------------------------------------------------------------
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsCollecting, setSkillsCollecting] = useState(false);
  const [skillsToolConfig, setSkillsToolConfig] = useState<
    Record<
      string,
      {
        name?: string;
        skills_path?: string;
        mode?: string;
        enabled_skills?: string[];
      }
    >
  >({});
  const [expandedSkillTool, setExpandedSkillTool] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const [skillList, toolConfig] = await Promise.all([
        listSkills(),
        getSkillsToolConfig() as Promise<
          Record<
            string,
            {
              name?: string;
              skills_path?: string;
              mode?: string;
              enabled_skills?: string[];
            }
          >
        >,
      ]);
      setSkills(skillList);
      setSkillsToolConfig(toolConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`加载技能列表失败：${msg}`);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab !== 'skills') return;
    loadSkills();
  }, [subTab, loadSkills]);

  const handleCollectSkills = async () => {
    if (skillsCollecting) return;
    setSkillsCollecting(true);
    try {
      const result = await collectSkills();
      setSkills(result.skills);
      const toolConfig = (await getSkillsToolConfig()) as Record<
        string,
        { name?: string; skills_path?: string; mode?: string; enabled_skills?: string[] }
      >;
      setSkillsToolConfig(toolConfig);
      const totalFound = result.tools.reduce((sum, t) => sum + t.skills_found, 0);
      toast.success(`扫描完成，发现 ${totalFound} 个技能，已收集到中心目录。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`扫描技能失败：${msg}`);
    } finally {
      setSkillsCollecting(false);
    }
  };

  const handleEnableSkill = async (skillName: string, toolId: string) => {
    try {
      await enableSkill(skillName, toolId);
      toast.success(`已为 ${skillsToolConfig[toolId]?.name ?? toolId} 启用技能 "${skillName}"`);
      await loadSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`启用技能失败：${msg}`);
    }
  };

  const handleDisableSkill = async (skillName: string, toolId: string) => {
    try {
      await disableSkill(skillName, toolId);
      toast.success(`已为 ${skillsToolConfig[toolId]?.name ?? toolId} 禁用技能 "${skillName}"`);
      await loadSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`禁用技能失败：${msg}`);
    }
  };

  const handleEnableAllSkills = async (toolId: string) => {
    try {
      await enableAllSkills(toolId);
      toast.success(`已为 ${skillsToolConfig[toolId]?.name ?? toolId} 启用所有技能`);
      await loadSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`启用所有技能失败：${msg}`);
    }
  };

  const handleDisableAllSkills = async (toolId: string) => {
    try {
      await disableAllSkills(toolId);
      toast.success(`已为 ${skillsToolConfig[toolId]?.name ?? toolId} 禁用所有技能`);
      await loadSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`禁用所有技能失败：${msg}`);
    }
  };

  const renderSkillsPanel = () => {
    const toolIds = Object.keys(skillsToolConfig);

    return (
      <div className="max-w-[980px] w-full mx-auto flex flex-col gap-3.5">
        <div className="flex justify-between gap-3 flex-wrap items-start">
          <div>
            <h2 className="text-xl font-bold text-foreground m-0">技能管理</h2>
            <p className="text-[13px] text-muted mt-2">
              统一管理各 AI 工具的 Skills，支持一键扫描收集和按需启用。
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadSkills}
              disabled={skillsLoading}
              className="gap-1.5"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', skillsLoading && 'animate-spin')} />
              {skillsLoading ? '加载中...' : '刷新'}
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={handleCollectSkills}
              disabled={skillsCollecting}
              className="gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {skillsCollecting ? '扫描中...' : '扫描收集技能'}
            </Button>
          </div>
        </div>

        {/* Skills directory info */}
        <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
          <CardContent className="p-4">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5 text-xs">
              <div className="rounded-xl border border-border bg-surface/60 p-3">
                <div className="text-dim mb-1">已收集技能数</div>
                <div className="text-xl text-foreground font-bold">{skills.length}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface/60 p-3">
                <div className="text-dim mb-1">已配置工具数</div>
                <div className="text-xl text-foreground font-bold">{toolIds.length}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface/60 p-3">
                <div className="text-dim mb-1">中心目录</div>
                <div className="text-foreground">~/.aastation/skills/</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Skills list */}
        <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
          <CardHeader>
            <CardTitle>技能列表</CardTitle>
            <CardDescription>管理各 AI 工具中启用的技能，点击工具标签可启用/禁用</CardDescription>
          </CardHeader>
          <CardContent>
            {skills.length === 0 ? (
              <div className="text-sm text-muted py-8 text-center">
                暂无技能，点击上方"扫描收集技能"从已配置的工具中收集。
              </div>
            ) : (
              <div className="space-y-2.5">
                {skills.map((skill) => (
                  <div
                    key={skill.name}
                    className="rounded-xl border border-border bg-surface/55 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-foreground">{skill.name}</span>
                        {skill.hasSkillMd && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            SKILL.md
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-wrap shrink-0">
                        {toolIds.map((toolId) => {
                          const isEnabled = skill.enabledInTools.includes(toolId);
                          const toolName = skillsToolConfig[toolId]?.name ?? toolId;
                          return (
                            <button
                              key={toolId}
                              type="button"
                              onClick={() =>
                                isEnabled
                                  ? handleDisableSkill(skill.name, toolId)
                                  : handleEnableSkill(skill.name, toolId)
                              }
                              className={cn(
                                'text-[11px] px-2 py-1 rounded-lg border transition-colors cursor-pointer',
                                isEnabled
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                  : 'border-border bg-surface/40 text-muted hover:bg-surface/70 hover:text-foreground',
                              )}
                              title={isEnabled ? `点击禁用 ${toolName}` : `点击启用 ${toolName}`}
                            >
                              {toolName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {skill.description && (
                      <p className="text-xs text-muted mt-1 truncate">
                        {skill.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tool status overview */}
        <Card className="border-border bg-card/92 shadow-[var(--color-shadow-soft)]">
          <CardHeader>
            <CardTitle>工具状态</CardTitle>
            <CardDescription>各工具的技能加载状态与批量操作</CardDescription>
          </CardHeader>
          <CardContent>
            {toolIds.length === 0 ? (
              <div className="text-sm text-muted py-4 text-center">
                暂无已配置工具，请先运行"扫描收集技能"初始化。
              </div>
            ) : (
              <div className="space-y-2.5">
                {toolIds.map((toolId) => {
                  const tool = skillsToolConfig[toolId];
                  const enabledCount = skills.filter((s) =>
                    s.enabledInTools.includes(toolId),
                  ).length;
                  const isExpanded = expandedSkillTool === toolId;
                  return (
                    <div
                      key={toolId}
                      className="rounded-xl border border-border bg-card/92 shadow-[var(--color-shadow-soft)]"
                    >
                      <div className="p-3.5">
                        <div className="flex justify-between items-center">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSkillTool((v) => (v === toolId ? null : toolId))
                            }
                            className="bg-transparent border-none text-foreground p-0 m-0 cursor-pointer text-left flex-1"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-sm font-semibold text-foreground">
                                {tool?.name ?? toolId}
                              </span>
                              <Badge
                                variant={enabledCount > 0 ? 'success' : 'outline'}
                                className="text-[10px]"
                              >
                                {enabledCount}/{skills.length} 已启用
                              </Badge>
                            </div>
                            <div className="text-[11px] text-dim mt-0.5">
                              {tool?.skills_path ?? ''}
                            </div>
                          </button>
                          <div className="flex gap-1.5">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleEnableAllSkills(toolId)}
                              disabled={skills.length === 0}
                            >
                              全部启用
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleDisableAllSkills(toolId)}
                              disabled={enabledCount === 0}
                            >
                              全部禁用
                            </Button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {skills.map((skill) => {
                              const isEnabled = skill.enabledInTools.includes(toolId);
                              return (
                                <button
                                  key={skill.name}
                                  type="button"
                                  onClick={() =>
                                    isEnabled
                                      ? handleDisableSkill(skill.name, toolId)
                                      : handleEnableSkill(skill.name, toolId)
                                  }
                                  className={cn(
                                    'text-[11px] px-2 py-1 rounded-lg border transition-colors cursor-pointer',
                                    isEnabled
                                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                      : 'border-border bg-surface/40 text-muted hover:text-foreground',
                                  )}
                                >
                                  {skill.name}
                                </button>
                              );
                            })}
                            {skills.length === 0 && (
                              <span className="text-xs text-dim">暂无技能</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="ui-page ui-accent-plugins flex flex-1 overflow-hidden">
      <Tabs
        value={subTab}
        onValueChange={(val) => setSubTab(val as PluginSubTab)}
        orientation="vertical"
        className="flex flex-1"
      >
        <aside className="w-[228px] border-r border-border-soft bg-sidebar-surface/72 p-[28px_14px_22px] flex flex-col gap-2">
          <div className="px-2 pb-3">
            <div className="text-foreground text-base font-bold">Agent 插件管理</div>
          </div>
          <TabsList className="flex flex-col h-auto bg-transparent gap-1 p-0">
            {[
              { key: 'skills' as const, title: '技能管理', desc: '统一管理 AI 工具 Skills' },
            ].map((item) => (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className="w-full justify-start rounded-xl border border-transparent px-3 py-2.5 text-left data-[state=active]:border-border data-[state=active]:bg-card"
              >
                <div>
                  <div className="text-[13px] font-semibold">{item.title}</div>
                  <div className="text-[11px] mt-0.5 opacity-85">{item.desc}</div>
                </div>
              </TabsTrigger>
            ))}
          </TabsList>
        </aside>

        <main
          className="min-w-0 flex-1 overflow-auto px-6 pb-6"
          style={{
            paddingTop: 'calc(var(--window-controls-safe-top) + 4px)',
            paddingRight: 'calc(var(--window-controls-safe-right) + 12px)',
          }}
        >
          <TabsContent value="skills" className="mt-0">
            {renderSkillsPanel()}
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}
