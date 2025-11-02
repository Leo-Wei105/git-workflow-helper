import * as vscode from "vscode";
import { BranchConfigManager } from "./branchConfigManager";
import { GitOperations } from "./gitOperations";
import { BranchManager } from "./branchManager";

/**
 * 目标分支配置接口
 */
interface TargetBranchConfig {
  name: string;
  description: string;
}

/**
 * 配置管理类 - 负责配置管理
 */
export class ConfigurationManager {
  private config: vscode.WorkspaceConfiguration;
  private gitOps: GitOperations;
  private branchManager: BranchManager;
  private branchConfigManager: BranchConfigManager;
  private readonly configurationSection = 'gitWorkflowHelper';

  constructor(
    config: vscode.WorkspaceConfiguration,
    gitOps: GitOperations,
    branchManager: BranchManager,
    branchConfigManager: BranchConfigManager
  ) {
    this.config = config;
    this.gitOps = gitOps;
    this.branchManager = branchManager;
    this.branchConfigManager = branchConfigManager;
  }

  /**
   * 解析目标分支字符串数组
   */
  private parseTargetBranches(branchStrings: string[] | undefined): TargetBranchConfig[] {
    if (!branchStrings || !Array.isArray(branchStrings)) {
      return [
        { name: "uat", description: "uat" },
        { name: "pre", description: "pre" },
      ];
    }

    return branchStrings
      .filter((str): str is string => typeof str === 'string' && str.trim().length > 0)
      .map(name => ({ name: name.trim(), description: name.trim() }));
  }

  /**
   * 序列化目标分支
   */
  private serializeTargetBranches(branches: TargetBranchConfig[]): string[] {
    return branches.map(b => b.name);
  }

  /**
   * 获取分支前缀列表
   */
  getBranchPrefixes(): Array<{ prefix: string }> {
    return this.branchConfigManager.getBranchPrefixes();
  }

  /**
   * 获取目标分支列表（合并后的值）
   */
  getTargetBranches(): TargetBranchConfig[] {
    const branchStrings = this.config.get<string[]>("targetBranches");
    return this.parseTargetBranches(branchStrings);
  }

  /**
   * 获取工作区目标分支列表
   */
  getWorkspaceTargetBranches(): TargetBranchConfig[] {
    const config = vscode.workspace.getConfiguration(this.configurationSection);
    const targetBranchesInspect = config.inspect<string[]>('targetBranches');
    const branchStrings = targetBranchesInspect?.workspaceValue ?? targetBranchesInspect?.defaultValue;
    return this.parseTargetBranches(branchStrings);
  }

  /**
   * 添加目标分支
   */
  async addTargetBranch(name: string): Promise<void> {
    const currentBranches = this.getTargetBranches();
    if (currentBranches.some((branch) => branch.name === name)) {
      throw new Error(`分支 "${name}" 已存在`);
    }

    const newBranches = [...currentBranches, { name, description: name }];
    const branchStrings = this.serializeTargetBranches(newBranches);
    await this.config.update('targetBranches', branchStrings, vscode.ConfigurationTarget.Workspace);
  }

  /**
   * 删除目标分支
   */
  async removeTargetBranch(name: string): Promise<void> {
    const currentBranches = this.getTargetBranches();
    if (currentBranches.length <= 1) {
      throw new Error("至少需要保留一个目标分支");
    }

    const newBranches = currentBranches.filter((branch) => branch.name !== name);
    const branchStrings = this.serializeTargetBranches(newBranches);
    await this.config.update('targetBranches', branchStrings, vscode.ConfigurationTarget.Workspace);
  }
}
