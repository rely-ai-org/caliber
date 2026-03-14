import { trackEvent } from './index.js';

// --- Init flow events ---

export function trackInitProviderSelected(provider: string, model: string): void {
  trackEvent('init_provider_selected', { provider, model });
}

export function trackInitProjectDiscovered(languageCount: number, dependencyCount: number, fileCount: number): void {
  trackEvent('init_project_discovered', { language_count: languageCount, dependency_count: dependencyCount, file_count: fileCount });
}

export function trackInitAgentSelected(agents: string[]): void {
  trackEvent('init_agent_selected', { agents });
}

export function trackInitScoreComputed(score: number, passingCount: number, failingCount: number, earlyExit: boolean): void {
  trackEvent('init_score_computed', { score, passing_count: passingCount, failing_count: failingCount, early_exit: earlyExit });
}

export function trackInitGenerationStarted(isTargetedFix: boolean): void {
  trackEvent('init_generation_started', { is_targeted_fix: isTargetedFix });
}

export function trackInitGenerationCompleted(durationMs: number, retryCount: number): void {
  trackEvent('init_generation_completed', { duration_ms: durationMs, retry_count: retryCount });
}

export function trackInitReviewAction(action: string, reviewMethod?: string): void {
  trackEvent('init_review_action', { action, review_method: reviewMethod });
}

export function trackInitRefinementRound(roundNumber: number, wasValid: boolean): void {
  trackEvent('init_refinement_round', { round_number: roundNumber, was_valid: wasValid });
}

export function trackInitFilesWritten(fileCount: number, createdCount: number, modifiedCount: number, deletedCount: number): void {
  trackEvent('init_files_written', { file_count: fileCount, created_count: createdCount, modified_count: modifiedCount, deleted_count: deletedCount });
}

export function trackInitHookSelected(hookType: string): void {
  trackEvent('init_hook_selected', { hook_type: hookType });
}

export function trackInitSkillsSearch(searched: boolean, installedCount: number): void {
  trackEvent('init_skills_search', { searched, installed_count: installedCount });
}

export function trackInitScoreRegression(oldScore: number, newScore: number): void {
  trackEvent('init_score_regression', { old_score: oldScore, new_score: newScore });
}

// --- Other command events ---

export function trackRegenerateCompleted(action: string, durationMs: number): void {
  trackEvent('regenerate_completed', { action, duration_ms: durationMs });
}

export function trackRefreshCompleted(changesCount: number, durationMs: number): void {
  trackEvent('refresh_completed', { changes_count: changesCount, duration_ms: durationMs });
}

export function trackScoreComputed(score: number, agent?: string[]): void {
  trackEvent('score_computed', { score, agent });
}

export function trackConfigProviderSet(provider: string): void {
  trackEvent('config_provider_set', { provider });
}

export function trackSkillsInstalled(count: number): void {
  trackEvent('skills_installed', { count });
}

export function trackUndoExecuted(): void {
  trackEvent('undo_executed');
}
