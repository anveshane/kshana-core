import { getProjectFileOps } from '../../server/ProjectFileOps.js';
import { getCurrentPhase, getManifestFilePath, loadProject, readProjectFile } from '../../tasks/video/workflow/index.js';
import { type AssetInfo, type PhaseStatus, type ProjectFile, WorkflowPhase } from '../../tasks/video/workflow/types.js';
import type { Blocker, MissingDependency, PhaseCompletion, StateAnalysis } from './types.js';

export class StateAnalyzer {
  async analyzeProjectState(basePath: string, projectInput?: ProjectFile | null): Promise<StateAnalysis> {
    const project = projectInput ?? loadProject(basePath);

    if (!project) {
      return {
        hasProject: false,
        completedPhases: [],
        pendingPhases: [],
        completion: {
          total: 0,
          completed: 0,
          pending: 0,
          percentage: 0,
          missingItems: [],
        },
        requiredFiles: [],
        missingDependencies: [],
        blockers: [
          {
            code: 'NO_PROJECT',
            message: 'No project found in the current workspace.',
            severity: 'high',
          },
        ],
        actionableRemainingWork: ['Create or load a project before continuing.'],
        summary: 'No project was detected.',
      };
    }

    const currentPhase = getCurrentPhase(project);
    const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];
    const phaseStatus: PhaseStatus = phaseInfo?.status ?? 'pending';
    const manifestAssets = this.loadManifestAssets(basePath);

    const completedPhases = Object.entries(project.phases)
      .filter(([, info]) => info.status === 'completed')
      .map(([phase]) => phase as WorkflowPhase);

    const pendingPhases = Object.entries(project.phases)
      .filter(([, info]) => info.status === 'pending' || info.status === 'in_progress')
      .map(([phase]) => phase as WorkflowPhase);

    const requiredFilePaths = this.getRequiredFilesForPhase(currentPhase, project);
    const requiredFiles = requiredFilePaths.map(path => {
      const content = readProjectFile(path, basePath);
      const hasContent = typeof content === 'string' && content.trim().length > 0;
      return {
        path,
        exists: hasContent,
        required: true,
      };
    });

    const missingDependencies: MissingDependency[] = requiredFiles
      .filter(file => !file.exists)
      .map(file => ({
        id: `missing:${file.path}`,
        description: `Required file is missing or empty: ${file.path}`,
        filePath: file.path,
      }));

    const completion = this.calculatePhaseCompletion(currentPhase, phaseStatus, project, manifestAssets, basePath);
    const blockers = this.buildBlockers(missingDependencies, completion, phaseStatus);
    const actionableRemainingWork = this.buildActionableRemainingWork(currentPhase, missingDependencies, completion);

    return {
      hasProject: true,
      currentPhase,
      phaseStatus,
      completedPhases,
      pendingPhases,
      completion,
      requiredFiles,
      missingDependencies,
      blockers,
      actionableRemainingWork,
      summary: this.buildSummary(currentPhase, phaseStatus, completion, missingDependencies),
    };
  }

  private loadManifestAssets(basePath: string): AssetInfo[] {
    const manifestPath = getManifestFilePath(basePath);
    if (!getProjectFileOps().existsSync(manifestPath)) {
      return [];
    }

    try {
      const manifestContent = getProjectFileOps().readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as { assets?: AssetInfo[] };
      return manifest.assets ?? [];
    } catch {
      return [];
    }
  }

  private getRequiredFilesForPhase(phase: WorkflowPhase, project: ProjectFile): string[] {
    switch (phase) {
      case WorkflowPhase.CONTENT_PLANNING:
        return project.inputType === 'youtube_srt'
          ? ['agent/content/transcript.md', 'agent/original_input.md']
          : ['agent/original_input.md'];
      case WorkflowPhase.IMAGE_GENERATION:
        return ['agent/content/image-placements.md'];
      case WorkflowPhase.INFOGRAPHICS_GENERATION:
        return ['agent/content/infographic-placements.md'];
      case WorkflowPhase.VIDEO_PLACEMENT:
        return ['agent/content/transcript.md', 'agent/plans/content-plan.md'];
      case WorkflowPhase.VIDEO_GENERATION:
        return ['agent/content/video-placements.md'];
      default:
        return [];
    }
  }

  private calculatePhaseCompletion(
    phase: WorkflowPhase,
    phaseStatus: PhaseStatus,
    project: ProjectFile,
    assets: AssetInfo[],
    basePath: string
  ): PhaseCompletion {
    switch (phase) {
      case WorkflowPhase.CONTENT_PLANNING:
        return this.getSingleFileCompletion('agent/plans/content-plan.md', basePath, phaseStatus);
      case WorkflowPhase.IMAGE_GENERATION:
        return this.getPlacementAssetCompletion(project.imagePlacements?.length ?? 0, assets, 'scene_image');
      case WorkflowPhase.INFOGRAPHICS_GENERATION:
        return this.getPlacementAssetCompletion(project.infographicPlacements?.length ?? 0, assets, 'scene_infographic');
      case WorkflowPhase.VIDEO_GENERATION:
        return this.getPlacementAssetCompletion(project.videoPlacements?.length ?? 0, assets, 'scene_video');
      case WorkflowPhase.VIDEO_PLACEMENT:
        return this.getVideoPlacementCompletion(project);
      default:
        return {
          total: 1,
          completed: phaseStatus === 'completed' ? 1 : 0,
          pending: phaseStatus === 'completed' ? 0 : 1,
          percentage: phaseStatus === 'completed' ? 100 : 0,
          missingItems: phaseStatus === 'completed' ? [] : [`Complete phase ${phase}`],
        };
    }
  }

  private getSingleFileCompletion(filePath: string, basePath: string, phaseStatus: PhaseStatus): PhaseCompletion {
    const content = readProjectFile(filePath, basePath);
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const completed = hasContent || phaseStatus === 'completed' ? 1 : 0;
    return {
      total: 1,
      completed,
      pending: completed === 1 ? 0 : 1,
      percentage: completed === 1 ? 100 : 0,
      missingItems: completed === 1 ? [] : [filePath],
    };
  }

  private getVideoPlacementCompletion(project: ProjectFile): PhaseCompletion {
    const transcriptTotal = project.transcriptEntries?.length ?? 0;
    const placementCount = project.videoPlacements?.length ?? 0;

    if (transcriptTotal === 0) {
      return {
        total: 0,
        completed: 0,
        pending: 0,
        percentage: 0,
        missingItems: ['No transcript entries found to map video placements.'],
      };
    }

    const completed = Math.min(placementCount, transcriptTotal);
    const pending = Math.max(transcriptTotal - completed, 0);
    const missingItems: string[] = [];
    for (let i = completed + 1; i <= transcriptTotal; i += 1) {
      missingItems.push(`Video placement for transcript segment ${i}`);
    }

    return {
      total: transcriptTotal,
      completed,
      pending,
      percentage: Math.round((completed / transcriptTotal) * 100),
      missingItems,
    };
  }

  private getPlacementAssetCompletion(
    totalPlacements: number,
    assets: AssetInfo[],
    assetType: AssetInfo['type']
  ): PhaseCompletion {
    const relevantAssets = assets.filter(asset => asset.type === assetType);
    if (totalPlacements <= 0) {
      return {
        total: 0,
        completed: relevantAssets.length,
        pending: 0,
        percentage: 0,
        missingItems: ['No placements found for this phase.'],
      };
    }

    const generatedIndices = new Set<number>();
    for (const asset of relevantAssets) {
      const rawPlacement = asset.metadata?.['placementNumber'] ?? asset.scene_number;
      const numericPlacement = this.parseNumericIndex(rawPlacement);
      if (numericPlacement !== null) {
        generatedIndices.add(numericPlacement);
      }
    }

    let completed = 0;
    const missingItems: string[] = [];
    for (let index = 1; index <= totalPlacements; index += 1) {
      if (generatedIndices.has(index)) {
        completed += 1;
      } else {
        missingItems.push(`Placement ${index}`);
      }
    }

    if (generatedIndices.size === 0 && relevantAssets.length > 0) {
      completed = Math.min(relevantAssets.length, totalPlacements);
      missingItems.length = 0;
      for (let index = completed + 1; index <= totalPlacements; index += 1) {
        missingItems.push(`Placement ${index}`);
      }
    }

    const pending = Math.max(totalPlacements - completed, 0);
    const percentage = totalPlacements === 0 ? 0 : Math.round((completed / totalPlacements) * 100);

    return {
      total: totalPlacements,
      completed,
      pending,
      percentage,
      missingItems,
    };
  }

  private parseNumericIndex(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private buildBlockers(
    missingDependencies: MissingDependency[],
    completion: PhaseCompletion,
    phaseStatus: PhaseStatus
  ): Blocker[] {
    const blockers: Blocker[] = [];
    for (const dependency of missingDependencies) {
      blockers.push({
        code: 'MISSING_DEPENDENCY',
        message: dependency.description,
        severity: 'high',
      });
    }

    if (phaseStatus === 'completed' && completion.pending > 0) {
      blockers.push({
        code: 'PHASE_STATE_MISMATCH',
        message: 'Phase is marked completed but pending work was detected.',
        severity: 'medium',
      });
    }

    return blockers;
  }

  private buildActionableRemainingWork(
    currentPhase: WorkflowPhase,
    missingDependencies: MissingDependency[],
    completion: PhaseCompletion
  ): string[] {
    const tasks: string[] = [];
    for (const dependency of missingDependencies) {
      tasks.push(`Create or restore ${dependency.filePath}`);
    }

    if (completion.pending > 0) {
      const header = `Complete remaining ${completion.pending}/${completion.total} items in ${currentPhase}`;
      tasks.push(header);
      for (const item of completion.missingItems) {
        tasks.push(`Finish ${item}`);
      }
    }

    if (tasks.length === 0) {
      tasks.push('No missing work detected in this phase.');
    }

    return tasks;
  }

  private buildSummary(
    currentPhase: WorkflowPhase,
    phaseStatus: PhaseStatus,
    completion: PhaseCompletion,
    missingDependencies: MissingDependency[]
  ): string {
    const dependencyText =
      missingDependencies.length > 0
        ? `${missingDependencies.length} missing dependencies`
        : 'no missing dependencies';

    return `${currentPhase} is ${phaseStatus}. Completion: ${completion.completed}/${completion.total} (${completion.percentage}%), ${dependencyText}.`;
  }
}
