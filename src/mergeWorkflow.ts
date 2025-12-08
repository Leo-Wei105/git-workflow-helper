import * as vscode from "vscode";
import * as path from "path";
import { GitOperations } from "./gitOperations";
import { BranchManager } from "./branchManager";
import { ConfigurationManager } from "./configurationManager";

/**
 * 合并流程类 - 负责合并流程编排
 */
export class MergeWorkflow {
  private gitOps: GitOperations;
  private branchManager: BranchManager;
  private configManager: ConfigurationManager;

  constructor(
    gitOps: GitOperations,
    branchManager: BranchManager,
    configManager: ConfigurationManager
  ) {
    this.gitOps = gitOps;
    this.branchManager = branchManager;
    this.configManager = configManager;
  }

  /**
   * 处理合并冲突
   */
  private async handleMergeConflicts(
    conflictFiles: string[]
  ): Promise<boolean> {
    if (conflictFiles.length === 0) {
      return true;
    }

    const action = await vscode.window.showWarningMessage(
      `检测到 ${conflictFiles.length} 个文件存在合并冲突：\n${conflictFiles.join("\n")}`,
      { modal: true },
      "打开冲突文件",
      "中止合并",
      "手动解决后继续"
    );

    switch (action) {
      case "打开冲突文件":
        if (conflictFiles.length > 0) {
          const filePath = path.join(
            this.gitOps.getWorkspaceRoot(),
            conflictFiles[0]
          );
          const document = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(document);
        }
        return false;

      case "中止合并":
        await this.gitOps.abortMerge();
        return false;

      case "手动解决后继续":
        return await this.waitForConflictResolution();

      default:
        return false;
    }
  }

  /**
   * 等待冲突解决
   */
  private async waitForConflictResolution(): Promise<boolean> {
    const maxAttempts = 10;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const hasConflicts = await this.gitOps.checkMergeConflicts();
      if (!hasConflicts) {
        const hasUnstagedChanges = await this.gitOps.checkUncommittedChanges();
        if (hasUnstagedChanges) {
          const shouldCommit = await vscode.window.showInformationMessage(
            "冲突已解决，是否提交合并结果？",
            { modal: true },
            "提交",
            "取消"
          );

          if (shouldCommit === "提交") {
            await this.gitOps.commitChanges("feat: 合并冲突解决");
            return true;
          }
        }
        return true;
      }

      const continueWaiting = await vscode.window.showInformationMessage(
        "仍有未解决的冲突，请继续解决...",
        { modal: true },
        "重新检查",
        "中止合并"
      );

      if (continueWaiting === "中止合并") {
        await this.gitOps.abortMerge();
        return false;
      }

      attempts++;
    }

    vscode.window.showErrorMessage("等待冲突解决超时");
    return false;
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
      throw new Error("当前目录不是有效的Git仓库");
    }

    if (progress) {
      progress.report({ message: "验证当前分支...", increment: 10 });
    }
    
    const currentBranch = await this.gitOps.getCurrentBranch();
    const branchPrefixes = this.configManager.getBranchPrefixes();
    const isFeatureBranch = await this.branchManager.checkFeatureBranch(branchPrefixes);

    if (!isFeatureBranch) {
      const patterns = branchPrefixes.map(p => p.prefix).join(", ");
      throw new Error(`当前分支不是功能分支。支持的分支前缀: ${patterns}`);
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

    const shouldCommit = await vscode.window.showWarningMessage(
      "检测到未提交的更改，是否现在提交？",
      "是",
      "否"
    );

    if (shouldCommit === "是") {
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
        throw new Error("未输入提交信息，操作已取消");
      }

      await this.gitOps.commitChanges(`feat: ${commitMessage}`);
      await this.gitOps.pushBranch(currentBranch);
    } else {
      throw new Error("请先提交或存储更改后再运行");
    }
  }

  /**
   * 收集合并参数（选择目标分支）
   */
  async gatherMergeParameters(): Promise<string> {
    const targetBranches = this.configManager.getTargetBranches();
    const targetBranchOptions = targetBranches.map((branch) => ({
      label: branch.name,
      value: branch.name,
    }));

    const selected = await vscode.window.showQuickPick(targetBranchOptions, {
      placeHolder: "请选择要合并到的目标分支",
    });

    if (!selected) {
      throw new Error("未选择目标分支，操作已取消");
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
    
    const success = await this.branchManager.safeMergeBranch(
      targetBranch,
      currentBranch,
      this.handleMergeConflicts.bind(this),
      progress
    );

    if (!success) {
      throw new Error(`合并到 ${targetBranch} 分支失败`);
    }
    
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
