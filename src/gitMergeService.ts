import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BranchConfigManager } from "./branchConfigManager";
import { BranchManager } from "./branchManager";
import { ConfigurationManager } from "./configurationManager";
import { GitOperations } from "./gitOperations";
import { MergeWorkflow } from "./mergeWorkflow";

/**
 * Git合并服务类
 * 提供自动化的Git分支合并功能
 */
export class GitMergeService {
  private workspaceRoot: string;
  private static isOperationInProgress = false;
  private gitOps: GitOperations;
  private branchManager: BranchManager;
  private configManager: ConfigurationManager;
  private mergeWorkflow: MergeWorkflow;
  private branchConfigManager: BranchConfigManager;

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("请先打开一个工作区文件夹");
    }

    this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    const gitDir = path.join(this.workspaceRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      throw new Error("当前工作区不是Git仓库，请在Git项目中使用此插件");
    }

    this.gitOps = new GitOperations(this.workspaceRoot);
    this.branchManager = new BranchManager(this.gitOps);
    this.branchConfigManager = new BranchConfigManager();

    const config = vscode.workspace.getConfiguration("gitWorkflowHelper");
    this.configManager = new ConfigurationManager(
      config,
      this.gitOps,
      this.branchManager,
      this.branchConfigManager
    );
    this.mergeWorkflow = new MergeWorkflow(
      this.gitOps,
      this.branchManager,
      this.configManager
    );
  }

  /**
   * 合并功能分支主流程
   */
  public async mergeFeatureBranch(): Promise<void> {
    if (GitMergeService.isOperationInProgress) {
      vscode.window.showWarningMessage(
        "已有合并操作正在进行中，请等待完成后再试"
      );
      return;
    }

    GitMergeService.isOperationInProgress = true;
    let currentBranch = "";

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Git合并流程进行中",
          cancellable: false
        },
        async (progress) => {
          try {
            progress.report({ message: "⚠️ 合并过程中请不要手动操作Git！准备合并环境...", increment: 0 });
            currentBranch = await this.mergeWorkflow.prepareMergeEnvironment(progress);
            
            progress.report({ message: "请选择目标分支...", increment: 0 });
            const targetBranch = await this.mergeWorkflow.gatherMergeParameters();
            
            progress.report({ message: `⚠️ 正在合并到 ${targetBranch}，请勿手动操作Git！`, increment: 10 });
            await this.mergeWorkflow.executeMainMergeFlow(currentBranch, targetBranch, progress);
            
            progress.report({ message: "✅ 合并完成！", increment: 100 });
            vscode.window.showInformationMessage(`✓ 合并流程完成！`);
          } catch (error: any) {
            await this.mergeWorkflow.handleMergeError(error, currentBranch);
            throw error;
          }
        }
      );
    } catch (error: any) {
      const errorMessage = error?.message || "未知错误";
      vscode.window.showErrorMessage(`合并失败: ${errorMessage}`);
    } finally {
      GitMergeService.isOperationInProgress = false;
    }
  }

  /**
   * 配置管理 - 直接跳转到插件设置页
   */
  public async manageConfiguration(): Promise<void> {
    await vscode.commands.executeCommand(
      'workbench.action.openWorkspaceSettings',
      '@ext:Leo-Wei105.git-workflow-helper'
    );
  }

}