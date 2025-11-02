import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execAsync = promisify(exec);

/**
 * Git操作类 - 负责所有Git命令操作
 */
export class GitOperations {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 执行Git命令并返回输出
   */
  async execGitCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceRoot,
        encoding: "utf8",
      });

      if (stderr && !stderr.includes("warning")) {
        console.warn("Git命令警告:", stderr);
      }

      return stdout.trim();
    } catch (error: any) {
      const errorMessage = error.stderr || error.message || "未知错误";
      throw new Error(`Git命令执行失败: ${errorMessage}`);
    }
  }

  /**
   * 检查Git仓库状态
   */
  async checkGitRepository(): Promise<boolean> {
    try {
      await this.execGitCommand("git status");
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取当前分支名
   */
  async getCurrentBranch(): Promise<string> {
    return await this.execGitCommand("git branch --show-current");
  }

  /**
   * 检查是否有未提交的更改
   */
  async checkUncommittedChanges(): Promise<boolean> {
    const status = await this.execGitCommand("git status --porcelain");
    return status.length > 0;
  }

  /**
   * 检查是否存在合并冲突
   */
  async checkMergeConflicts(): Promise<boolean> {
    try {
      const status = await this.execGitCommand("git status --porcelain");
      return status.split("\n").some((line) => {
        const statusCode = line.substring(0, 2);
        return ["UU", "AA", "DD", "AU", "UA", "DU", "UD"].includes(statusCode);
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取冲突文件列表
   */
  async getConflictFiles(): Promise<string[]> {
    try {
      const status = await this.execGitCommand(
        "git diff --name-only --diff-filter=U"
      );
      return status ? status.split("\n").filter((file) => file.trim()) : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * 检查远程分支是否存在
   */
  async checkRemoteBranchExists(branchName: string): Promise<boolean> {
    try {
      const remoteBranch = await this.execGitCommand(
        `git ls-remote --heads origin ${branchName}`
      );
      return !!remoteBranch;
    } catch (error) {
      return false;
    }
  }

  /**
   * 推送分支到远程（带上游设置）
   */
  async pushBranch(
    branchName: string,
    setUpstream: boolean = false
  ): Promise<void> {
    const command = setUpstream
      ? `git push -u origin ${branchName}`
      : `git push origin ${branchName}`;
    await this.execGitCommand(command);
  }

  /**
   * 切换分支
   */
  async checkoutBranch(branchName: string): Promise<void> {
    await this.execGitCommand(`git checkout ${branchName}`);
  }

  /**
   * 拉取远程分支
   */
  async pullBranch(branchName: string): Promise<void> {
    await this.execGitCommand(`git pull origin ${branchName}`);
  }

  /**
   * 合并分支
   */
  async mergeBranch(sourceBranch: string): Promise<void> {
    await this.execGitCommand(`git merge ${sourceBranch}`);
  }

  /**
   * 提交更改
   */
  async commitChanges(message: string): Promise<void> {
    await this.execGitCommand("git add .");
    await this.execGitCommand(`git commit -m "${message}"`);
  }

  /**
   * 中止合并
   */
  async abortMerge(): Promise<void> {
    await this.execGitCommand("git merge --abort");
  }

  /**
   * 确保分支有正确的上游关联
   */
  async ensureBranchUpstream(branchName: string): Promise<void> {
    try {
      // 检查当前分支的上游设置
      const upstream = await this.execGitCommand(
        `git rev-parse --abbrev-ref ${branchName}@{upstream}`
      );
      const expectedUpstream = `origin/${branchName}`;

      // 如果上游不正确，重新设置
      if (upstream !== expectedUpstream) {
        await this.execGitCommand(
          `git branch --set-upstream-to=origin/${branchName} ${branchName}`
        );
      }
    } catch (error) {
      // 如果没有上游分支，设置它
      await this.execGitCommand(
        `git branch --set-upstream-to=origin/${branchName} ${branchName}`
      );
    }
  }

  /**
   * 安全切换分支（保证上游关联）
   */
  async safeCheckoutBranch(branchName: string): Promise<void> {
    await this.checkoutBranch(branchName);
    await this.ensureBranchUpstream(branchName);
  }
}

/**
 * 分支管理类 - 负责分支相关操作和验证
 */
export class BranchManager {
  private gitOps: GitOperations;

  constructor(gitOps: GitOperations) {
    this.gitOps = gitOps;
  }

  /**
   * 验证分支名称是否合法
   */
  validateBranchName(branchName: string): boolean {
    const invalidChars = /[\s~^:?*\[\]\\]/;
    const invalidPatterns = /^-|--|\.\.|@{|\.lock$|\/$/;

    if (!branchName || branchName.length === 0) {
      return false;
    }

    if (invalidChars.test(branchName) || invalidPatterns.test(branchName)) {
      return false;
    }

    if (branchName.startsWith(".") || branchName.endsWith(".")) {
      return false;
    }

    return true;
  }

  /**
   * 检查当前分支是否为功能分支
   */
  async checkFeatureBranch(
    featureConfig: FeatureBranchConfig
  ): Promise<boolean> {
    try {
      const currentBranch = await this.gitOps.getCurrentBranch();
      return featureConfig.patterns.some((pattern) =>
        currentBranch.toLowerCase().includes(pattern.toLowerCase())
      );
    } catch (error) {
      throw new Error("无法获取当前分支信息，请确保在Git仓库中操作");
    }
  }

  /**
   * 自动检测主分支
   * 按优先级顺序检测远程仓库中可能的主分支
   * @returns 检测到的主分支名称,未检测到则返回null
   */
  async autoDetectMainBranch(): Promise<string | null> {
    try {
      // 获取所有远程分支
      const branches = await this.gitOps.execGitCommand("git branch -r");
      if (!branches) {
        return null;
      }

      // 处理远程分支列表
      const remoteBranches = branches
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean);

      // 按优先级定义可能的主分支
      const priorityBranches = [
        "origin/master",
        "origin/release",
        "origin/main",
      ];

      // 遍历优先级分支列表
      for (const branch of priorityBranches) {
        const matchedBranch = remoteBranches.find((rb) => rb === branch);
        if (matchedBranch) {
          const branchName = matchedBranch.replace("origin/", "");
          // 确认远程分支确实存在
          if (await this.gitOps.checkRemoteBranchExists(branchName)) {
            return branchName;
          }
        }
      }

      return null;
    } catch (error) {
      console.error("自动检测主分支失败:", error);
      return null;
    }
  }

  /**
   * 安全合并分支（带冲突处理）
   */
  async safeMergeBranch(
    targetBranch: string,
    sourceBranch: string,
    conflictHandler: (conflictFiles: string[]) => Promise<boolean>
  ): Promise<boolean> {
    try {
      await this.gitOps.safeCheckoutBranch(targetBranch);
      await this.gitOps.pullBranch(targetBranch);

      try {
        await this.gitOps.mergeBranch(sourceBranch);
      } catch (mergeError) {
        const hasConflicts = await this.gitOps.checkMergeConflicts();

        if (hasConflicts) {
          const conflictFiles = await this.gitOps.getConflictFiles();
          const resolved = await conflictHandler(conflictFiles);
          if (!resolved) {
            return false;
          }
        } else {
          throw mergeError;
        }
      }

      await this.gitOps.pushBranch(targetBranch);
      return true;
    } catch (error) {
      console.error(`合并到 ${targetBranch} 失败:`, error);
      throw error;
    }
  }

  /**
   * 确保远程分支存在并设置正确的上游关联
   */
  async ensureRemoteBranchExists(branchName: string): Promise<void> {
    const exists = await this.gitOps.checkRemoteBranchExists(branchName);

    if (!exists) {
      // 首次推送时设置上游分支
      await this.gitOps.pushBranch(branchName, true);
    } else {
      // 确保本地分支有正确的上游关联
      await this.gitOps.ensureBranchUpstream(branchName);
    }
  }
}

/**
 * 配置管理类 - 负责配置管理
 */
export class ConfigurationManager {
  private config: vscode.WorkspaceConfiguration;
  private configHelper: ConfigHelper;
  private gitOps: GitOperations;
  private branchManager: BranchManager;

  constructor(
    config: vscode.WorkspaceConfiguration,
    gitOps: GitOperations,
    branchManager: BranchManager
  ) {
    this.config = config;
    this.configHelper = new ConfigHelper(config);
    this.gitOps = gitOps;
    this.branchManager = branchManager;
  }

  /**
   * 获取功能分支配置
   */
  getFeatureBranchConfig(): FeatureBranchConfig {
    const defaultConfig: FeatureBranchConfig = {
      patterns: ["feature", "feat", "bugfix", "hotfix", "fix"],
      description: "功能分支命名模式",
    };

    return this.config.get<FeatureBranchConfig>(
      "featureBranchConfig",
      defaultConfig
    );
  }

  /**
   * 获取目标分支列表
   */
  getTargetBranches(): TargetBranchConfig[] {
    const defaultBranches: TargetBranchConfig[] = [
      { name: "uat", description: "测试环境" },
      { name: "pre", description: "预发布环境" },
    ];

    return this.config.get<TargetBranchConfig[]>(
      "targetBranches",
      defaultBranches
    );
  }

  /**
   * 获取主分支名称
   */
  async getMainBranch(): Promise<string> {
    const autoDetect = this.config.get<boolean>("autoDetectMainBranch", false);

    if (autoDetect) {
      try {
        const detectedBranch = await this.branchManager.autoDetectMainBranch();
        if (detectedBranch) {
          return detectedBranch;
        }

        vscode.window.showWarningMessage(
          "未找到标准的主分支(master/release/main)，请手动配置主分支"
        );
      } catch (error) {
        console.warn("自动检测主分支失败，使用配置的分支:", error);
      }
    }

    const configuredBranch = this.config.get<string>("mainBranch", "master");

    try {
      const exists = await this.gitOps.checkRemoteBranchExists(
        configuredBranch
      );
      if (!exists) {
        throw new Error(
          `配置的主分支 "${configuredBranch}" 在远程仓库中不存在，请检查配置`
        );
      }
      return configuredBranch;
    } catch (error) {
      throw new Error(
        `配置的主分支 "${configuredBranch}" 在远程仓库中不存在，请检查配置`
      );
    }
  }

  /**
   * 设置主分支
   */
  async setMainBranch(branchName: string): Promise<void> {
    const exists = await this.gitOps.checkRemoteBranchExists(branchName);
    if (!exists) {
      throw new Error(
        `分支 "${branchName}" 在远程仓库中不存在，请检查分支名称`
      );
    }

    await this.configHelper.updateConfig("mainBranch", branchName);
  }

  /**
   * 添加目标分支
   */
  async addTargetBranch(name: string, description: string): Promise<void> {
    const currentBranches = this.getTargetBranches();

    if (currentBranches.some((branch) => branch.name === name)) {
      throw new Error(`分支 "${name}" 已存在`);
    }

    const newBranches = [...currentBranches, { name, description }];
    await this.configHelper.updateConfig("targetBranches", newBranches);
  }

  /**
   * 删除目标分支
   */
  async removeTargetBranch(name: string): Promise<void> {
    const currentBranches = this.getTargetBranches();

    if (currentBranches.length <= 1) {
      throw new Error("至少需要保留一个目标分支");
    }

    const newBranches = currentBranches.filter(
      (branch) => branch.name !== name
    );
    await this.configHelper.updateConfig("targetBranches", newBranches);
  }

  /**
   * 添加功能分支模式
   */
  async addFeaturePattern(pattern: string): Promise<void> {
    const currentConfig = this.getFeatureBranchConfig();

    if (currentConfig.patterns.includes(pattern.toLowerCase())) {
      throw new Error("该模式已存在");
    }

    const newConfig = {
      ...currentConfig,
      patterns: [...currentConfig.patterns, pattern.toLowerCase()],
    };

    await this.configHelper.updateConfig("featureBranchConfig", newConfig);
  }

  /**
   * 删除功能分支模式
   */
  async removeFeaturePattern(pattern: string): Promise<void> {
    const currentConfig = this.getFeatureBranchConfig();

    if (currentConfig.patterns.length <= 1) {
      throw new Error("至少需要保留一个分支模式");
    }

    const newConfig = {
      ...currentConfig,
      patterns: currentConfig.patterns.filter((p) => p !== pattern),
    };

    await this.configHelper.updateConfig("featureBranchConfig", newConfig);
  }

  /**
   * 切换自动检测
   */
  async toggleAutoDetect(): Promise<boolean> {
    const currentValue = this.config.get<boolean>(
      "autoDetectMainBranch",
      false
    );
    const newValue = !currentValue;

    await this.configHelper.updateConfig("autoDetectMainBranch", newValue);
    return newValue;
  }

  /**
   * 重置配置
   */
  async resetConfiguration(
    resetType: "all" | "main" | "target" | "feature"
  ): Promise<void> {
    await this.configHelper.batchReset(resetType);
  }

  /**
   * 获取当前配置信息
   */
  getCurrentConfigInfo(): string {
    const mainBranch = this.config.get<string>("mainBranch", "master");
    const autoDetect = this.config.get<boolean>("autoDetectMainBranch", false);
    const targetBranches = this.getTargetBranches();
    const featureConfig = this.getFeatureBranchConfig();

    return [
      "📋 当前配置信息:",
      "",
      `🌿 主分支: ${mainBranch}`,
      `🔍 自动检测主分支: ${autoDetect ? "开启" : "关闭"}`,
      "",
      "🎯 目标分支:",
      ...targetBranches.map(
        (branch) => `  • ${branch.name}: ${branch.description}`
      ),
      "",
      "🔧 功能分支模式:",
      `  • 支持的模式: ${featureConfig.patterns.join(", ")}`,
    ].join("\n");
  }
}

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
   * 显示进度消息
   */
  private showProgress(message: string): void {
    vscode.window.showInformationMessage(`🔄 ${message}`);
    console.log(message);
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
      `检测到 ${
        conflictFiles.length
      } 个文件存在合并冲突：\n${conflictFiles.join("\n")}`,
      "打开冲突文件",
      "中止合并",
      "手动解决后继续"
    );

    switch (action) {
      case "打开冲突文件":
        if (conflictFiles.length > 0) {
          const filePath = path.join(
            this.gitOps["workspaceRoot"],
            conflictFiles[0]
          );
          const document = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(document);
        }
        return false;

      case "中止合并":
        await this.gitOps.abortMerge();
        vscode.window.showInformationMessage("合并已中止");
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
  async prepareMergeEnvironment(): Promise<string> {
    if (!(await this.gitOps.checkGitRepository())) {
      throw new Error("当前目录不是有效的Git仓库");
    }

    this.showProgress("检查当前分支...");
    const currentBranch = await this.gitOps.getCurrentBranch();

    // 验证功能分支
    const featureConfig = this.configManager.getFeatureBranchConfig();
    const isFeatureBranch = await this.branchManager.checkFeatureBranch(
      featureConfig
    );

    if (!isFeatureBranch) {
      const patterns = featureConfig.patterns.join(", ");
      throw new Error(`当前分支不是功能分支。支持的分支模式: ${patterns}`);
    }

    // 确保远程分支存在
    await this.branchManager.ensureRemoteBranchExists(currentBranch);

    // 处理未提交的更改
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

    const shouldCommit = await UIHelper.showConfirm(
      "检测到未提交的更改，是否现在提交？",
      "是",
      "否"
    );

    if (shouldCommit) {
      const commitMessage = await UIHelper.showInput(
        "请输入commit内容",
        "输入提交信息...",
        UIHelper.createValidator({ required: true, maxLength: 100 })
      );

      if (!commitMessage) {
        throw new Error("未输入提交信息，操作已取消");
      }

      await this.gitOps.commitChanges(`feat: ${commitMessage}`);
      await this.gitOps.pushBranch(currentBranch);
      this.showProgress("更改已提交");
    } else {
      throw new Error("请先提交或存储更改后再运行");
    }
  }

  /**
   * 收集合并参数
   */
  async gatherMergeParameters(): Promise<{
    mainBranch: string;
    targetBranch: string;
  }> {
    const mainBranch = await this.configManager.getMainBranch();
    this.showProgress(`检测到主分支: ${mainBranch}`);

    const targetBranches = this.configManager.getTargetBranches();
    const targetBranchOptions = targetBranches.map((branch) => ({
      label: branch.name,
      description: branch.description,
      value: branch.name,
    }));

    const targetBranch = await UIHelper.showSelection(
      targetBranchOptions,
      "请选择要合并到的目标分支"
    );

    if (!targetBranch) {
      throw new Error("未选择目标分支，操作已取消");
    }

    return { mainBranch, targetBranch };
  }

  /**
   * 执行主合并流程
   */
  async executeMainMergeFlow(
    currentBranch: string,
    mainBranch: string,
    targetBranch: string
  ): Promise<void> {
    this.showProgress(`开始合并流程，目标分支: ${targetBranch}`);

    // 合并功能分支到目标分支
    await this.mergeFeatureToTarget(currentBranch, targetBranch);

    // 切回原分支并确保上游关联正确
    await this.gitOps.safeCheckoutBranch(currentBranch);

    this.showProgress(`已切回功能分支: ${currentBranch}，上游关联已确保正确`);
  }

  /**
   * 更新主分支
   */
  private async updateMainBranch(mainBranch: string): Promise<void> {
    this.showProgress(`更新${mainBranch}分支...`);
    await this.gitOps.checkoutBranch(mainBranch);
    await this.gitOps.pullBranch(mainBranch);
  }

  /**
   * 合并主分支到功能分支
   */
  private async mergeMainToFeature(
    currentBranch: string,
    mainBranch: string
  ): Promise<void> {
    this.showProgress(`合并${mainBranch}到feature分支...`);
    await this.gitOps.checkoutBranch(currentBranch);

    const success = await this.branchManager.safeMergeBranch(
      currentBranch,
      mainBranch,
      this.handleMergeConflicts.bind(this)
    );

    if (!success) {
      throw new Error(`合并${mainBranch}到${currentBranch}失败`);
    }

    await this.gitOps.pushBranch(currentBranch);
  }

  /**
   * 合并功能分支到目标分支
   */
  private async mergeFeatureToTarget(
    currentBranch: string,
    targetBranch: string
  ): Promise<void> {
    this.showProgress(`合并${currentBranch}到${targetBranch}分支...`);

    const success = await this.branchManager.safeMergeBranch(
      targetBranch,
      currentBranch,
      this.handleMergeConflicts.bind(this)
    );

    if (!success) {
      throw new Error(`合并到 ${targetBranch} 分支失败`);
    }
  }

  /**
   * 处理合并错误
   */
  async handleMergeError(error: any, currentBranch: string): Promise<void> {
    console.error("合并过程中发生错误:", error);

    if (currentBranch) {
      try {
        await this.gitOps.checkoutBranch(currentBranch);
      } catch (e) {
        console.error("切回原分支失败：", e);
        vscode.window.showErrorMessage(
          `无法切回原分支 ${currentBranch}，请手动切换`
        );
      }
    }
  }
}

/**
 * 目标分支配置接口
 */
interface TargetBranchConfig {
  name: string;
  description: string;
}

/**
 * 功能分支命名规则配置接口
 */
interface FeatureBranchConfig {
  patterns: string[];
  description: string;
}

/**
 * UI交互抽象层
 */
class UIHelper {
  /**
   * 显示选择对话框
   */
  static async showSelection<T>(
    items: (vscode.QuickPickItem & { value: T })[],
    placeHolder: string
  ): Promise<T | undefined> {
    const selected = await vscode.window.showQuickPick(items, { placeHolder });
    return selected?.value;
  }

  /**
   * 显示输入框
   */
  static async showInput(
    prompt: string,
    placeHolder: string,
    validator?: (value: string) => string | null
  ): Promise<string | undefined> {
    return await vscode.window.showInputBox({
      prompt,
      placeHolder,
      validateInput: validator,
    });
  }

  /**
   * 显示确认对话框
   */
  static async showConfirm(
    message: string,
    confirmText = "确定",
    cancelText = "取消"
  ): Promise<boolean> {
    const result = await vscode.window.showWarningMessage(
      message,
      confirmText,
      cancelText
    );
    return result === confirmText;
  }

  /**
   * 通用输入验证器
   */
  static createValidator(options: {
    required?: boolean;
    maxLength?: number;
    minLength?: number;
    pattern?: RegExp;
    customValidator?: (value: string) => string | null;
  }) {
    return (value: string): string | null => {
      if (options.required && (!value || value.trim().length === 0)) {
        return "此项不能为空";
      }

      if (options.minLength && value.length < options.minLength) {
        return `长度不能少于${options.minLength}个字符`;
      }

      if (options.maxLength && value.length > options.maxLength) {
        return `长度不能超过${options.maxLength}个字符`;
      }

      if (options.pattern && !options.pattern.test(value)) {
        return "格式不正确";
      }

      if (options.customValidator) {
        return options.customValidator(value);
      }

      return null;
    };
  }
}

/**
 * 配置管理抽象层
 */
class ConfigHelper {
  private config: vscode.WorkspaceConfiguration;

  constructor(config: vscode.WorkspaceConfiguration) {
    this.config = config;
  }

  /**
   * 更新配置项
   */
  async updateConfig(key: string, value: any): Promise<void> {
    await this.config.update(key, value, vscode.ConfigurationTarget.Workspace);
  }

  /**
   * 重置配置项
   */
  async resetConfig(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.updateConfig(key, undefined);
    }
  }

  /**
   * 批量重置配置
   */
  async batchReset(
    resetType: "all" | "main" | "target" | "feature"
  ): Promise<void> {
    const resetMap = {
      all: [
        "mainBranch",
        "targetBranches",
        "featureBranchConfig",
        "autoDetectMainBranch",
      ],
      main: ["mainBranch", "autoDetectMainBranch"],
      target: ["targetBranches"],
      feature: ["featureBranchConfig"],
    };

    await this.resetConfig(resetMap[resetType]);
  }
}

/**
 * Git合并服务类
 * 提供自动化的Git分支合并功能
 */
export class GitMergeService {
  private workspaceRoot: string;
  private static isOperationInProgress = false; // 并发控制标志
  private gitOps: GitOperations; // Git操作实例
  private branchManager: BranchManager; // 分支管理实例
  private configManager: ConfigurationManager; // 配置管理实例
  private mergeWorkflow: MergeWorkflow; // 合并流程实例

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("请先打开一个工作区文件夹");
    }

    this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    this.gitOps = new GitOperations(this.workspaceRoot);
    this.branchManager = new BranchManager(this.gitOps);

    const config = vscode.workspace.getConfiguration("gitWorkflowHelper");
    this.configManager = new ConfigurationManager(
      config,
      this.gitOps,
      this.branchManager
    );
    this.mergeWorkflow = new MergeWorkflow(
      this.gitOps,
      this.branchManager,
      this.configManager
    );

    // 检查是否是Git仓库
    const gitDir = path.join(this.workspaceRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      throw new Error("当前工作区不是Git仓库，请在Git项目中使用此插件");
    }
  }

  /**
   * 获取插件配置
   */
  private getConfiguration() {
    return vscode.workspace.getConfiguration("gitWorkflowHelper");
  }

  /**
   * 验证分支名称是否合法
   */
  private validateBranchName(branchName: string): boolean {
    return this.branchManager.validateBranchName(branchName);
  }

  /**
   * 检查当前分支是否为功能分支
   */
  private async checkFeatureBranch(): Promise<boolean> {
    const featureConfig = this.configManager.getFeatureBranchConfig();
    return await this.branchManager.checkFeatureBranch(featureConfig);
  }

  /**
   * 检查操作是否正在进行中
   */
  private checkOperationInProgress(): boolean {
    if (GitMergeService.isOperationInProgress) {
      vscode.window.showWarningMessage(
        "已有合并操作正在进行中，请等待完成后再试"
      );
      return true;
    }
    return false;
  }

  /**
   * 设置操作状态
   */
  private setOperationStatus(inProgress: boolean): void {
    GitMergeService.isOperationInProgress = inProgress;
  }

  /**
   * 获取功能分支配置
   */
  private getFeatureBranchConfig(): FeatureBranchConfig {
    return this.configManager.getFeatureBranchConfig();
  }

  /**
   * 获取主分支名称
   */
  private async getMainBranch(): Promise<string> {
    return await this.configManager.getMainBranch();
  }

  /**
   * 获取目标分支列表
   */
  private getTargetBranches(): TargetBranchConfig[] {
    return this.configManager.getTargetBranches();
  }

  /**
   * 合并Feature分支主流程（重构版本）
   */
  public async mergeFeatureBranch(): Promise<void> {
    if (this.checkOperationInProgress()) {
      return;
    }

    this.setOperationStatus(true);
    let currentBranch = "";

    try {
      currentBranch = await this.mergeWorkflow.prepareMergeEnvironment();
      const { mainBranch, targetBranch } =
        await this.mergeWorkflow.gatherMergeParameters();

      await this.mergeWorkflow.executeMainMergeFlow(
        currentBranch,
        mainBranch,
        targetBranch
      );

      vscode.window.showInformationMessage("✅ 合并流程完成！");
    } catch (error: any) {
      await this.mergeWorkflow.handleMergeError(error, currentBranch);
      throw error;
    } finally {
      this.setOperationStatus(false);
    }
  }

  /**
   * 快速提交并合并（重构版本）
   */
  public async quickCommitAndMerge(): Promise<void> {
    if (this.checkOperationInProgress()) {
      return;
    }

    this.setOperationStatus(true);

    try {
      if (!(await this.gitOps.checkGitRepository())) {
        throw new Error("当前目录不是有效的Git仓库");
      }

      if (!(await this.gitOps.checkUncommittedChanges())) {
        vscode.window.showInformationMessage("没有需要提交的更改");
        return;
      }

      const commitMessage = await UIHelper.showInput(
        "请输入commit内容",
        "输入提交信息...",
        UIHelper.createValidator({ required: true, maxLength: 100 })
      );

      if (!commitMessage) {
        throw new Error("未输入提交信息，操作已取消");
      }

      await this.gitOps.commitChanges(`feat: ${commitMessage}`);
      vscode.window.showInformationMessage("✅ 更改已提交");

      const shouldMerge = await UIHelper.showConfirm(
        "提交完成，是否继续执行合并流程？",
        "是",
        "否"
      );

      if (shouldMerge) {
        await this.mergeFeatureBranch();
      }
    } catch (error: any) {
      console.error("快速提交过程中发生错误:", error);
      throw error;
    } finally {
      this.setOperationStatus(false);
    }
  }

  /**
   * 配置管理（简化版本）
   */
  public async manageConfiguration(): Promise<void> {
    const configActions = [
      { label: "设置主分支", value: "main-branch" },
      { label: "管理目标分支", value: "target-branches" },
      { label: "配置功能分支模式", value: "feature-patterns" },
      { label: "切换自动检测", value: "auto-detect" },
      { label: "重置配置", value: "reset" },
      { label: "查看当前配置", value: "view-config" },
    ];

    const action = await UIHelper.showSelection(
      configActions,
      "选择要执行的配置操作"
    );

    if (!action) return;

    switch (action) {
      case "main-branch":
        await this.configureMainBranchSimplified();
        break;
      case "target-branches":
        await this.manageTargetBranchesSimplified();
        break;
      case "feature-patterns":
        await this.configureFeaturePatternsSimplified();
        break;
      case "auto-detect":
        await this.toggleAutoDetectSimplified();
        break;
      case "reset":
        await this.resetConfigurationSimplified();
        break;
      case "view-config":
        await this.showCurrentConfiguration();
        break;
    }
  }

  /**
   * 简化的主分支配置
   */
  private async configureMainBranchSimplified(): Promise<void> {
    const config = this.getConfiguration();
    const currentMainBranch = config.get<string>("mainBranch", "master");

    const branchOptions = [
      {
        label: "master",
        value: "master",
        picked: currentMainBranch === "master",
      },
      { label: "main", value: "main", picked: currentMainBranch === "main" },
      {
        label: "release",
        value: "release",
        picked: currentMainBranch === "release",
      },
      { label: "自定义", value: "custom" },
    ];

    const selected = await UIHelper.showSelection(
      branchOptions,
      "选择主分支名称"
    );
    if (!selected) return;

    let branchName = selected;

    if (selected === "custom") {
      const customBranch = await UIHelper.showInput(
        "请输入自定义主分支名称",
        "例如: main, master, release",
        UIHelper.createValidator({
          required: true,
          customValidator: (value) =>
            this.validateBranchName(value) ? null : "分支名称包含非法字符",
        })
      );

      if (!customBranch) return;
      branchName = customBranch;
    }

    try {
      await this.configManager.setMainBranch(branchName);
      vscode.window.showInformationMessage(`✅ 主分支已设置为: ${branchName}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(error.message);
    }
  }

  /**
   * 简化的目标分支管理
   */
  private async manageTargetBranchesSimplified(): Promise<void> {
    const actions = [
      { label: "查看当前分支", value: "view" },
      { label: "添加新分支", value: "add" },
      { label: "删除分支", value: "remove" },
    ];

    const action = await UIHelper.showSelection(
      actions,
      "选择目标分支管理操作"
    );
    if (!action) return;

    switch (action) {
      case "view":
        await this.showCurrentTargetBranches();
        break;
      case "add":
        await this.addTargetBranchSimplified();
        break;
      case "remove":
        await this.removeTargetBranchSimplified();
        break;
    }
  }

  /**
   * 显示当前目标分支
   */
  private async showCurrentTargetBranches(): Promise<void> {
    const targetBranches = this.getTargetBranches();
    const branchList = targetBranches
      .map((branch) => `• ${branch.name}: ${branch.description}`)
      .join("\n");

    vscode.window.showInformationMessage(
      `当前配置的目标分支:\n\n${branchList}`,
      { modal: true }
    );
  }

  /**
   * 简化的添加目标分支
   */
  private async addTargetBranchSimplified(): Promise<void> {
    const branchName = await UIHelper.showInput(
      "请输入新分支名称",
      "例如: dev, staging, prod",
      UIHelper.createValidator({
        required: true,
        customValidator: (value) => {
          if (!this.validateBranchName(value)) {
            return "分支名称包含非法字符或格式不正确";
          }
          const currentBranches = this.getTargetBranches();
          if (currentBranches.some((branch) => branch.name === value)) {
            return `分支 "${value}" 已存在`;
          }
          return null;
        },
      })
    );

    if (!branchName) return;

    const branchDescription = await UIHelper.showInput(
      "请输入分支描述",
      "例如: 开发环境, 预发布环境",
      UIHelper.createValidator({ required: true, maxLength: 50 })
    );

    if (!branchDescription) return;

    const currentBranches = this.getTargetBranches();
    const newBranches = [
      ...currentBranches,
      { name: branchName, description: branchDescription },
    ];

    await new ConfigHelper(this.getConfiguration()).updateConfig(
      "targetBranches",
      newBranches
    );
    vscode.window.showInformationMessage(
      `✅ 已添加目标分支: ${branchName} (${branchDescription})`
    );
  }

  /**
   * 简化的删除目标分支
   */
  private async removeTargetBranchSimplified(): Promise<void> {
    const targetBranches = this.getTargetBranches();

    if (targetBranches.length <= 1) {
      vscode.window.showWarningMessage("至少需要保留一个目标分支");
      return;
    }

    const branchOptions = targetBranches.map((branch) => ({
      label: branch.name,
      description: branch.description,
      value: branch.name,
    }));

    const branchToRemove = await UIHelper.showSelection(
      branchOptions,
      "选择要删除的目标分支"
    );
    if (!branchToRemove) return;

    const confirmed = await UIHelper.showConfirm(
      `确定要删除目标分支 "${branchToRemove}" 吗？`,
      "确定删除"
    );

    if (confirmed) {
      const newBranches = targetBranches.filter(
        (branch) => branch.name !== branchToRemove
      );
      await new ConfigHelper(this.getConfiguration()).updateConfig(
        "targetBranches",
        newBranches
      );
      vscode.window.showInformationMessage(
        `✅ 已删除目标分支: ${branchToRemove}`
      );
    }
  }

  /**
   * 简化的功能分支模式配置
   */
  private async configureFeaturePatternsSimplified(): Promise<void> {
    const currentConfig = this.getFeatureBranchConfig();

    const actions = [
      { label: "查看当前模式", value: "view" },
      { label: "添加新模式", value: "add" },
      { label: "删除模式", value: "remove" },
      { label: "重置为默认", value: "reset" },
    ];

    const action = await UIHelper.showSelection(
      actions,
      "选择功能分支模式配置操作"
    );
    if (!action) return;

    const configHelper = new ConfigHelper(this.getConfiguration());

    switch (action) {
      case "view":
        const patterns = currentConfig.patterns.join(", ");
        vscode.window.showInformationMessage(`当前功能分支模式: ${patterns}`, {
          modal: true,
        });
        break;

      case "add":
        const newPattern = await UIHelper.showInput(
          "请输入新的分支命名模式",
          "例如: task, story, epic",
          UIHelper.createValidator({
            required: true,
            customValidator: (value) => {
              return currentConfig.patterns.includes(value.toLowerCase())
                ? "该模式已存在"
                : null;
            },
          })
        );

        if (newPattern) {
          const newConfig = {
            ...currentConfig,
            patterns: [...currentConfig.patterns, newPattern.toLowerCase()],
          };
          await configHelper.updateConfig("featureBranchConfig", newConfig);
          vscode.window.showInformationMessage(
            `✅ 已添加分支模式: ${newPattern}`
          );
        }
        break;

      case "remove":
        if (currentConfig.patterns.length <= 1) {
          vscode.window.showWarningMessage("至少需要保留一个分支模式");
          return;
        }

        const patternOptions = currentConfig.patterns.map((pattern) => ({
          label: pattern,
          value: pattern,
        }));
        const patternToRemove = await UIHelper.showSelection(
          patternOptions,
          "选择要删除的分支模式"
        );

        if (patternToRemove) {
          const newConfig = {
            ...currentConfig,
            patterns: currentConfig.patterns.filter(
              (p) => p !== patternToRemove
            ),
          };
          await configHelper.updateConfig("featureBranchConfig", newConfig);
          vscode.window.showInformationMessage(
            `✅ 已删除分支模式: ${patternToRemove}`
          );
        }
        break;

      case "reset":
        await configHelper.batchReset("feature");
        vscode.window.showInformationMessage("✅ 功能分支模式已重置为默认值");
        break;
    }
  }

  /**
   * 简化的自动检测切换
   */
  private async toggleAutoDetectSimplified(): Promise<void> {
    const config = this.getConfiguration();
    const currentValue = config.get<boolean>("autoDetectMainBranch", false);
    const newValue = !currentValue;

    await new ConfigHelper(config).updateConfig(
      "autoDetectMainBranch",
      newValue
    );
    const status = newValue ? "已开启" : "已关闭";
    vscode.window.showInformationMessage(`✅ 主分支自动检测${status}`);

    if (newValue) {
      try {
        const detectedBranch = await this.getMainBranch();
        vscode.window.showInformationMessage(`检测到主分支: ${detectedBranch}`);
      } catch (error) {
        vscode.window.showWarningMessage("自动检测主分支失败，请手动配置");
      }
    }
  }

  /**
   * 简化的重置配置
   */
  private async resetConfigurationSimplified(): Promise<void> {
    const resetOptions = [
      { label: "重置所有配置", value: "all" as const },
      { label: "重置主分支配置", value: "main" as const },
      { label: "重置目标分支配置", value: "target" as const },
      { label: "重置功能分支模式", value: "feature" as const },
    ];

    const selected = await UIHelper.showSelection(
      resetOptions,
      "选择要重置的配置范围"
    );
    if (!selected) return;

    const confirmed = await UIHelper.showConfirm(
      `确定要重置${
        resetOptions.find((opt) => opt.value === selected)?.label
      }吗？此操作不可撤销。`,
      "确定重置"
    );

    if (!confirmed) return;

    try {
      await this.configManager.resetConfiguration(selected);

      const resetNames = {
        all: "所有配置",
        main: "主分支配置",
        target: "目标分支配置",
        feature: "功能分支模式",
      };

      vscode.window.showInformationMessage(
        `✅ ${resetNames[selected]}已重置为默认值`
      );

      const shouldShowConfig = await UIHelper.showConfirm(
        "配置重置完成，是否查看当前配置？",
        "查看配置",
        "关闭"
      );

      if (shouldShowConfig) {
        await this.showCurrentConfiguration();
      }
    } catch (error) {
      console.error("重置配置时发生错误:", error);
      vscode.window.showErrorMessage("重置配置失败，请重试");
    }
  }

  /**
   * 显示当前配置信息
   */
  private async showCurrentConfiguration(): Promise<void> {
    try {
      const configInfo = this.configManager.getCurrentConfigInfo();
      vscode.window.showInformationMessage(configInfo, { modal: true });
    } catch (error) {
      console.error("获取配置信息时发生错误:", error);
      vscode.window.showErrorMessage("获取配置信息失败");
    }
  }

  /**
   * 获取当前Git状态信息
   */
  public async getGitStatus(): Promise<string> {
    try {
      const currentBranch = await this.gitOps.getCurrentBranch();
      const hasUncommitted = await this.gitOps.checkUncommittedChanges();
      const isFeatureBranch = await this.checkFeatureBranch();
      const mainBranch = await this.getMainBranch();

      const statusInfo = [
        `当前分支: ${currentBranch}`,
        `主分支: ${mainBranch}`,
        `是否为功能分支: ${isFeatureBranch ? "是" : "否"}`,
        `未提交更改: ${hasUncommitted ? "有" : "无"}`,
      ].join("\n");

      return statusInfo;
    } catch (error) {
      return `获取Git状态失败: ${error}`;
    }
  }

  /**
   * 验证Git环境
   */
  public async validateGitEnvironment(): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      if (!(await this.gitOps.checkGitRepository())) {
        issues.push("当前目录不是有效的Git仓库");
      }

      try {
        await this.gitOps.execGitCommand("git remote -v");
      } catch (error) {
        issues.push("无法连接到远程仓库");
      }

      try {
        await this.getMainBranch();
      } catch (error: any) {
        issues.push(`主分支配置有误: ${error.message}`);
      }

      const targetBranches = this.getTargetBranches();
      if (targetBranches.length === 0) {
        issues.push("未配置目标分支");
      }

      const featureConfig = this.getFeatureBranchConfig();
      if (featureConfig.patterns.length === 0) {
        issues.push("未配置功能分支模式");
      }
    } catch (error: any) {
      issues.push(`环境验证失败: ${error.message}`);
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}
