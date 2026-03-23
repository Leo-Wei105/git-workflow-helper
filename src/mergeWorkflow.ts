import * as path from "path";
import * as vscode from "vscode";
import { BranchConfigManager } from "./branchConfigManager";
import { BranchManager, MergeConflictResolution } from "./branchManager";
import { AppError } from "./errors";
import { GitOperations } from "./gitOperations";
import { MergeTargetConfigManager } from "./mergeTargetConfigManager";

/**
 * 合并流程类 - 负责合并流程编排
 */
export class MergeWorkflow {
  private gitOps: GitOperations;
  private branchManager: BranchManager;
  private branchConfigManager: BranchConfigManager;
  private mergeTargetConfigManager: MergeTargetConfigManager;

  constructor(
    gitOps: GitOperations,
    branchManager: BranchManager,
    branchConfigManager: BranchConfigManager,
    mergeTargetConfigManager: MergeTargetConfigManager
  ) {
    this.gitOps = gitOps;
    this.branchManager = branchManager;
    this.branchConfigManager = branchConfigManager;
    this.mergeTargetConfigManager = mergeTargetConfigManager;
  }

  /**
   * 读取冲突文件批量打开数量配置，并做安全兜底
   */
  private getMaxConflictFilesToOpen(): number {
    const config = vscode.workspace.getConfiguration("gitWorkflowHelper");
    const configured = config.get<number>("maxConflictFilesToOpen", 5);
    if (!Number.isFinite(configured)) {
      return 5;
    }
    return Math.min(20, Math.max(1, Math.floor(configured)));
  }

  /**
   * 打开冲突文件（支持单个选择或批量打开前N个）
   */
  private async openConflictFiles(conflictFiles: string[]): Promise<void> {
    if (conflictFiles.length === 0) {
      return;
    }

    const openAction = await vscode.window.showQuickPick(
      [
        { label: "选择文件打开", value: "pick-one" },
        { label: `批量打开前 ${this.getMaxConflictFilesToOpen()} 个`, value: "open-top-n" },
      ],
      { placeHolder: "请选择冲突文件打开方式" }
    );

    if (!openAction) {
      return;
    }

    if (openAction.value === "open-top-n") {
      const filesToOpen = conflictFiles.slice(0, this.getMaxConflictFilesToOpen());
      for (const relativePath of filesToOpen) {
        const filePath = path.join(this.gitOps.getWorkspaceRoot(), relativePath);
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document, { preview: false });
      }
      return;
    }

    const selected = await vscode.window.showQuickPick(
      conflictFiles.map((file) => ({
        label: file,
        value: file,
      })),
      { placeHolder: "请选择要打开的冲突文件" }
    );

    if (!selected) {
      return;
    }

    const filePath = path.join(this.gitOps.getWorkspaceRoot(), selected.value);
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
  }

  /**
   * 处理合并冲突
   */
  private async handleMergeConflicts(
    conflictFiles: string[]
  ): Promise<MergeConflictResolution> {
    if (conflictFiles.length === 0) {
      return "resolved";
    }

    const action = await vscode.window.showWarningMessage(
      `检测到 ${conflictFiles.length} 个文件存在合并冲突：\n${conflictFiles.join("\n")}`,
      "打开冲突文件",
      "中止合并",
      "手动解决后继续"
    );

    switch (action) {
      case "打开冲突文件":
        await this.openConflictFiles(conflictFiles);
        return "pending";

      case "中止合并":
        await this.gitOps.abortMerge();
        return "aborted";

      case "手动解决后继续":
        return await this.waitForConflictResolution();

      default:
        return "pending";
    }
  }

  /**
   * 等待冲突解决
   */
  private async waitForConflictResolution(): Promise<MergeConflictResolution> {
    while (true) {
      const hasConflicts = await this.gitOps.checkMergeConflicts();
      if (!hasConflicts) {
        const hasUnstagedChanges = await this.gitOps.checkUncommittedChanges();
        if (hasUnstagedChanges) {
          const shouldCommit = await vscode.window.showInformationMessage(
            "冲突已解决，是否提交合并结果？",
            "提交",
            "取消"
          );

          if (shouldCommit === "提交") {
            await this.gitOps.commitStagedChanges("feat: 合并冲突解决");
            return "resolved";
          }
          return "aborted";
        }
        return "resolved";
      }

      const continueWaiting = await vscode.window.showInformationMessage(
        "仍有未解决的冲突，请继续解决...",
        "重新检查",
        "中止合并"
      );

      if (continueWaiting === "中止合并") {
        await this.gitOps.abortMerge();
        return "aborted";
      }
    }
  }

  /**
   * 准备合并环境
   */
  async prepareMergeEnvironment(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<string> {
    if (progress) {
      progress.report({ message: "检查Git仓库状态...", increment: 10 });
    }
    
    if (!(await this.gitOps.checkGitRepository())) {
      throw new AppError("当前目录不是有效的Git仓库", "NOT_GIT_REPO", {
        stage: "prepareMergeEnvironment",
      });
    }

    if (progress) {
      progress.report({ message: "验证当前分支...", increment: 10 });
    }
    
    const currentBranch = await this.gitOps.getCurrentBranch();
    const branchPrefixes = this.branchConfigManager.getBranchPrefixes();
    const isFeatureBranch = await this.branchManager.checkFeatureBranch(branchPrefixes);

    if (!isFeatureBranch) {
      const patterns = branchPrefixes.map(p => p.prefix).join(", ");
      throw new AppError(
        `当前分支不是功能分支。支持的分支前缀: ${patterns}`,
        "UNKNOWN",
        { stage: "prepareMergeEnvironment" }
      );
    }

    if (progress) {
      progress.report({ message: "确保远程分支存在...", increment: 10 });
    }
    
    await this.branchManager.ensureRemoteBranchExists(currentBranch);
    
    if (progress) {
      progress.report({ message: "检查未提交的更改...", increment: 10 });
    }
    
    await this.handleUncommittedChanges(currentBranch);

    return currentBranch;
  }

  /**
   * 处理未提交的更改
   */
  private async handleUncommittedChanges(currentBranch: string): Promise<void> {
    if (!(await this.gitOps.checkUncommittedChanges())) {
      return;
    }

    const action = await vscode.window.showWarningMessage(
      "检测到未提交的更改，请选择处理方式",
      "仅提交已暂存",
      "暂存全部后提交",
      "取消"
    );

    if (!action || action === "取消") {
      throw AppError.userCancelled("请先提交或存储更改后再运行");
    }

    if (action === "仅提交已暂存") {
      const hasStagedChanges = await this.gitOps.checkStagedChanges();
      if (!hasStagedChanges) {
        throw new AppError("当前没有已暂存内容，请先暂存后重试", "UNKNOWN", {
          stage: "handleUncommittedChanges",
        });
      }
    }

    if (action === "暂存全部后提交") {
      await this.gitOps.stageAllChanges();
    }

    const commitMessage = await vscode.window.showInputBox({
      prompt: "请输入commit内容",
      placeHolder: "输入提交信息...",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "提交信息不能为空";
        }
        if (value.length > 100) {
          return "提交信息长度不能超过100个字符";
        }
        return null;
      },
    });

    if (!commitMessage) {
      throw AppError.userCancelled("未输入提交信息，操作已取消");
    }

    await this.gitOps.commitStagedChanges(`feat: ${commitMessage}`);
    await this.gitOps.pushBranch(currentBranch);
  }

  /**
   * 收集合并参数（选择目标分支）
   */
  async gatherMergeParameters(): Promise<string> {
    const targetBranches = this.mergeTargetConfigManager.getTargetBranches();
    const targetBranchOptions = targetBranches.map((branch) => ({
      label: branch.name,
      value: branch.name,
    }));

    const selected = await vscode.window.showQuickPick(targetBranchOptions, {
      placeHolder: "请选择要合并到的目标分支",
    });

    if (!selected) {
      throw AppError.userCancelled("未选择目标分支，操作已取消");
    }

    return selected.value;
  }

  /**
   * 执行主合并流程
   */
  async executeMainMergeFlow(
    currentBranch: string,
    targetBranch: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    progress.report({ message: `切换到目标分支 ${targetBranch}...`, increment: 20 });
    await this.mergeFeatureToTarget(currentBranch, targetBranch, progress);
    
    progress.report({ message: `切回原分支 ${currentBranch}...`, increment: 20 });
    await this.gitOps.checkoutBranch(currentBranch);
    
    const currentBranchExists = await this.gitOps.checkRemoteBranchExists(currentBranch);
    if (currentBranchExists) {
      progress.report({ message: `设置上游分支关联...`, increment: 10 });
      await this.gitOps.ensureBranchUpstream(currentBranch);
    }
  }

  /**
   * 合并功能分支到目标分支
   */
  private async mergeFeatureToTarget(
    currentBranch: string,
    targetBranch: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    progress.report({ message: `合并 ${currentBranch} 到 ${targetBranch}...`, increment: 30 });
    
    await this.branchManager.safeMergeBranch(
      targetBranch,
      currentBranch,
      this.handleMergeConflicts.bind(this),
      progress
    );
    
    progress.report({ message: `推送合并结果到远程...`, increment: 20 });
  }

  /**
   * 处理合并错误
   */
  async handleMergeError(error: any, currentBranch: string): Promise<void> {
    console.error("合并过程中发生错误:", error);

    if (currentBranch) {
      try {
        await this.gitOps.checkoutBranch(currentBranch);
      } catch {
        vscode.window.showErrorMessage(
          `无法切回原分支 ${currentBranch}，请手动切换`
        );
      }
    }
  }
}
