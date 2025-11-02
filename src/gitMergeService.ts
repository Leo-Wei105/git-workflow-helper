import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BranchConfigManager } from "./branchConfigManager";
import { BranchManager } from "./branchManager";
import { BranchUtils } from "./branchUtils";
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
      currentBranch = await this.mergeWorkflow.prepareMergeEnvironment();
      const targetBranch = await this.mergeWorkflow.gatherMergeParameters();
      await this.mergeWorkflow.executeMainMergeFlow(currentBranch, targetBranch);
      vscode.window.showInformationMessage(`✓ 合并流程完成！`);
    } catch (error: any) {
      await this.mergeWorkflow.handleMergeError(error, currentBranch);
      throw error;
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

  /**
   * 管理分支前缀（列表式界面）
   */
  public async manageBranchPrefixes(): Promise<void> {
    while (true) {
      const prefixes = this.branchConfigManager.getWorkspaceConfiguration().branchPrefixes;
      
      const items: (vscode.QuickPickItem & { action: string; prefix?: string })[] = [
        { 
          label: "$(add) 添加新前缀", 
          description: "添加一个新的分支前缀",
          action: "add"
        },
        { 
          label: "$(trash) 重置为默认配置", 
          description: "重置所有前缀为默认值",
          action: "reset"
        },
        { 
          kind: vscode.QuickPickItemKind.Separator,
          label: "当前前缀列表",
          action: ""
        }
      ];

      if (prefixes.length > 0) {
        prefixes.forEach((prefix) => {
          items.push({
            label: `$(circle-outline) ${prefix.prefix}`,
            description: "",
            detail: "点击删除",
            action: "delete",
            prefix: prefix.prefix
          });
        });
      } else {
        items.push({
          label: "暂无配置",
          description: "点击上方添加新前缀",
          action: ""
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "选择操作或点击前缀进行删除",
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (!selected) break;

      if (selected.action === "add") {
        await this.addBranchPrefix();
      } else if (selected.action === "delete" && selected.prefix) {
        const confirmed = await vscode.window.showWarningMessage(
          `确定要删除分支前缀 "${selected.prefix}" 吗？`,
          "确定删除",
          "取消"
        );
        if (confirmed === "确定删除") {
          try {
            await this.branchConfigManager.removeBranchPrefix(
              selected.prefix, 
              vscode.ConfigurationTarget.Workspace
            );
            vscode.window.showInformationMessage(`✓ 已删除分支前缀: ${selected.prefix}`);
          } catch (error: any) {
            vscode.window.showErrorMessage(`删除失败: ${error.message}`);
          }
        }
      } else if (selected.action === "reset") {
        const confirmed = await vscode.window.showWarningMessage(
          "确定要重置所有前缀为默认值吗？这将删除所有自定义前缀。",
          "确定重置",
          "取消"
        );
        if (confirmed === "确定重置") {
          try {
            await this.branchConfigManager.resetConfiguration(vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage("✓ 分支前缀配置已重置为默认值");
          } catch (error: any) {
            vscode.window.showErrorMessage(`重置失败: ${error.message}`);
          }
        }
      } else {
        break;
      }
    }
  }

  /**
   * 管理目标分支（列表式界面）
   */
  public async manageTargetBranches(): Promise<void> {
    while (true) {
      const branches = this.configManager.getWorkspaceTargetBranches();
      
      const items: (vscode.QuickPickItem & { action: string; branchName?: string })[] = [
        { 
          label: "$(add) 添加新分支", 
          description: "添加一个新的目标分支",
          action: "add"
        },
        { 
          kind: vscode.QuickPickItemKind.Separator,
          label: "当前分支列表",
          action: ""
        }
      ];

      if (branches.length > 0) {
        branches.forEach((branch) => {
          items.push({
            label: `$(circle-outline) ${branch.name}`,
            detail: "点击删除",
            action: "delete",
            branchName: branch.name
          });
        });
      } else {
        items.push({
          label: "暂无配置",
          description: "点击上方添加新分支",
          action: ""
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "选择操作或点击分支进行删除",
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (!selected) break;

      if (selected.action === "add") {
        await this.addTargetBranch();
      } else if (selected.action === "delete" && selected.branchName) {
        if (branches.length <= 1) {
          vscode.window.showWarningMessage("至少需要保留一个目标分支");
          continue;
        }
        const confirmed = await vscode.window.showWarningMessage(
          `确定要删除目标分支 "${selected.branchName}" 吗？`,
          "确定删除",
          "取消"
        );
        if (confirmed === "确定删除") {
          try {
            await this.configManager.removeTargetBranch(selected.branchName);
            vscode.window.showInformationMessage(`✓ 已删除目标分支: ${selected.branchName}`);
          } catch (error: any) {
            vscode.window.showErrorMessage(`删除失败: ${error.message}`);
          }
        }
      } else {
        break;
      }
    }
  }

  /**
   * 添加分支前缀
   */
  private async addBranchPrefix(): Promise<void> {
    const prefix = await vscode.window.showInputBox({
      prompt: "请输入分支前缀",
      placeHolder: "例如: feature, bugfix, hotfix",
      validateInput: (value) => {
        const validation = BranchUtils.validatePrefix(value);
        if (!validation.isValid) {
          return validation.error || null;
        }
        const currentPrefixes = this.branchConfigManager.getBranchPrefixes();
        if (currentPrefixes.some((p) => p.prefix === value)) {
          return `分支前缀 "${value}" 已存在`;
        }
        return null;
      },
    });

    if (!prefix) return;

    try {
      await this.branchConfigManager.addBranchPrefix(
        prefix, 
        prefix, 
        false, 
        vscode.ConfigurationTarget.Workspace
      );
      vscode.window.showInformationMessage(`✓ 已添加分支前缀: ${prefix}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`添加前缀失败: ${error.message}`);
    }
  }

  /**
   * 添加目标分支
   */
  private async addTargetBranch(): Promise<void> {
    const branchName = await vscode.window.showInputBox({
      prompt: "请输入新分支名称",
      placeHolder: "例如: dev, staging, prod",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "分支名称不能为空";
        }
        if (!this.branchManager.validateBranchName(value)) {
          return "分支名称包含非法字符或格式不正确";
        }
        const currentBranches = this.configManager.getTargetBranches();
        if (currentBranches.some((branch) => branch.name === value)) {
          return `分支 "${value}" 已存在`;
        }
        return null;
      },
    });

    if (!branchName) return;

    try {
      await this.configManager.addTargetBranch(branchName);
      vscode.window.showInformationMessage(`✓ 已添加目标分支: ${branchName}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`添加分支失败: ${error.message}`);
    }
  }
}