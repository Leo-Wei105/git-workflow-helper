import * as vscode from "vscode";
import { BranchConfigManager } from "./branchConfigManager";
import {
  BranchCreationOptions,
  BranchCreationResult,
  BranchPrefix,
  DateFormat,
  GitBranch,
} from "./branchTypes";
import { BranchUtils } from "./branchUtils";
import { GitOperations } from "./gitOperations";

export class BranchCreator {
  private configManager: BranchConfigManager;
  private gitOps: GitOperations;

  constructor(configManager: BranchConfigManager) {
    this.configManager = configManager;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("请先打开一个工作区");
    }
    this.gitOps = new GitOperations(workspaceFolder.uri.fsPath);
  }

  /**
   * 获取Git用户名
   */
  private async getGitUsername(): Promise<string> {
    const config = this.configManager.getConfiguration();

    if (config.customGitName) {
      return config.customGitName;
    }

    try {
      const username = await this.gitOps.execGitCommand("git config user.name");
      if (!username) {
        throw new Error("未设置Git用户名，请先配置Git用户名或在插件设置中指定");
      }
      return username;
    } catch (error) {
      throw new Error("获取Git用户名失败，请检查Git配置");
    }
  }

  /**
   * 获取所有分支
   */
  private async getAllBranches(): Promise<GitBranch[]> {
    try {
      const branches: GitBranch[] = [];
      let currentBranch = "";
      
      try {
        currentBranch = await this.gitOps.getCurrentBranch();
      } catch {
        currentBranch = "";
      }

      // 获取本地分支
      const localBranchOutput = await this.gitOps.execGitCommand(
        'git branch --format="%(refname:short)|%(objectname:short)"'
      );
      if (localBranchOutput) {
        localBranchOutput.split("\n").filter((line) => line.trim()).forEach((line) => {
          const [name, commit] = line.split("|");
          if (name?.trim()) {
            branches.push({
              name: name.trim(),
              current: name.trim() === currentBranch,
              isRemote: false,
              commit: commit || "",
            });
          }
        });
      }

      // 获取远程分支
      try {
        const remoteBranchOutput = await this.gitOps.execGitCommand(
          'git branch -r --format="%(refname:short)|%(objectname:short)"'
        );
        if (remoteBranchOutput) {
          remoteBranchOutput.split("\n").filter((line) => line.trim()).forEach((line) => {
            const [name, commit] = line.split("|");
            if (name?.trim() && !name.includes("HEAD")) {
              branches.push({
                name: name.trim(),
                current: false,
                isRemote: true,
                commit: commit || "",
              });
            }
          });
        }
      } catch {
        // 如果没有远程分支，忽略错误
      }

      return branches;
    } catch (error) {
      throw new Error(`获取分支列表失败: ${error}`);
    }
  }

  /**
   * 检查分支是否存在
   */
  private async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.gitOps.execGitCommand(`git rev-parse --verify ${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否为远程分支
   */
  private isRemoteBranch(branchName: string): boolean {
    return branchName.includes("/") && !branchName.startsWith("refs/heads/");
  }

  /**
   * 创建并切换到新分支
   */
  private async createAndCheckoutBranch(
    branchName: string,
    baseBranch: string
  ): Promise<void> {
    const config = this.configManager.getConfiguration();
    const isRemoteBaseBranch = this.isRemoteBranch(baseBranch);

    try {
      if (config.autoCheckout) {
        await this.gitOps.execGitCommand(`git checkout -b ${branchName} ${baseBranch}`);
        vscode.window.showInformationMessage(`✓ 成功创建分支: ${branchName}`);
      } else {
        await this.gitOps.execGitCommand(`git branch ${branchName} ${baseBranch}`);
        vscode.window.showInformationMessage(`✓ 成功创建分支: ${branchName}`);
      }

      if (isRemoteBaseBranch) {
        try {
          await this.gitOps.execGitCommand(`git branch --unset-upstream ${branchName}`);
        } catch {
          // 忽略错误
        }
      }
    } catch (error) {
      throw new Error(`创建分支失败: ${error}`);
    }
  }

  /**
   * 切换到现有分支
   */
  private async checkoutBranch(branchName: string): Promise<void> {
    await this.gitOps.checkoutBranch(branchName);
  }

  /**
   * 选择分支前缀
   */
  private async selectBranchPrefix(): Promise<BranchPrefix | undefined> {
    const prefixes = this.configManager.getBranchPrefixes();

    if (prefixes.length === 0) {
      throw new Error("没有可用的分支前缀，请先配置分支前缀");
    }

    // 如果只有一个前缀，直接使用
    if (prefixes.length === 1) {
      return prefixes[0];
    }

    // 创建选择项
    const items = prefixes.map((prefix) => ({
      label: prefix.prefix,
      description: "",
      detail: "",
      prefix: prefix,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "选择分支前缀",
      matchOnDescription: true,
    });

    return selected?.prefix;
  }

  /**
   * 选择基分支
   */
  private async selectBaseBranch(): Promise<string | undefined> {
    const branches = await this.getAllBranches();

    if (branches.length === 0) {
      throw new Error("没有可用的分支");
    }

    // 按本地分支优先排序
    const sortedBranches = branches.sort((a, b) => {
      if (a.current) {
        return -1;
      }
      if (b.current) {
        return 1;
      }
      if (!a.isRemote && b.isRemote) {
        return -1;
      }
      if (a.isRemote && !b.isRemote) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    // 创建选择项
    const items = sortedBranches.map((branch) => ({
      label: branch.name,
      description: branch.isRemote ? "远程分支" : "本地分支",
      detail: branch.current ? "当前分支" : "",
      branchName: branch.name,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "选择基分支",
      matchOnDescription: true,
    });

    return selected?.branchName;
  }

  /**
   * 输入分支描述
   */
  private async inputBranchDescription(
    prefix: string,
    username: string
  ): Promise<string | undefined> {
    const config = this.configManager.getConfiguration();
    const currentDate = BranchUtils.formatDate(
      new Date(),
      config.dateFormat as DateFormat
    );

    let previewBranchName = "";

    const description = await vscode.window.showInputBox({
      prompt: "输入分支描述信息",
      placeHolder: "例如：用户登录功能",
      validateInput: (value) => {
        if (!value) {
          return "描述信息不能为空";
        }

        const validation = BranchUtils.validateDescription(value);
        if (!validation.isValid) {
          return validation.error;
        }

        // 实时预览分支名称
        const previewName = BranchUtils.generateBranchName({
          prefix,
          description: value,
          username,
          date: currentDate,
        });

        const branchValidation = BranchUtils.validateBranchName(previewName);
        if (!branchValidation.isValid) {
          return branchValidation.error;
        }

        previewBranchName = previewName;
        return null;
      },
    });

    return description;
  }

  /**
   * 确认创建分支
   */
  private async confirmBranchCreation(
    options: BranchCreationOptions
  ): Promise<boolean> {
    const branchName = BranchUtils.generateBranchName(options);

    const items = [
      `基分支: ${options.baseBranch}`,
      `新分支: ${branchName}`,
      `描述: ${options.description}`,
      `创建者: ${options.username}`,
    ];

    const confirmed = await vscode.window.showInformationMessage(
      "确认创建分支？",
      {
        modal: true,
        detail: items.join("\n"),
      },
      "确认"
    );

    return confirmed === "确认";
  }

  /**
   * 主要的分支创建流程
   */
  async createBranch(): Promise<BranchCreationResult> {
    try {
      if (!(await this.gitOps.checkGitRepository())) {
        throw new Error("当前目录不是Git仓库");
      }

      // 步骤1: 选择分支前缀
      const selectedPrefix = await this.selectBranchPrefix();
      if (!selectedPrefix) {
        return { success: false, error: "未选择分支前缀" };
      }

      // 步骤2: 选择基分支
      const baseBranch = await this.selectBaseBranch();
      if (!baseBranch) {
        return { success: false, error: "未选择基分支" };
      }

      // 步骤3: 获取用户名
      const username = await this.getGitUsername();

      // 步骤4: 输入描述信息
      const description = await this.inputBranchDescription(
        selectedPrefix.prefix,
        username
      );
      if (!description) {
        return { success: false, error: "未输入描述信息" };
      }

      // 步骤5: 生成分支名称
      const config = this.configManager.getConfiguration();
      const currentDate = BranchUtils.formatDate(
        new Date(),
        config.dateFormat as DateFormat
      );

      const branchCreationOptions: BranchCreationOptions = {
        prefix: selectedPrefix.prefix,
        baseBranch,
        description,
        username,
        date: currentDate,
      };

      const branchName = BranchUtils.generateBranchName(branchCreationOptions);

      // 步骤6: 检查分支是否存在
      const exists = await this.branchExists(branchName);
      if (exists) {
        const action = await vscode.window.showWarningMessage(
          `分支 ${branchName} 已存在`,
          "切换到该分支",
          "重新输入",
          "取消"
        );

        if (action === "切换到该分支") {
          await this.checkoutBranch(branchName);
          return { success: true, branchName };
        } else if (action === "重新输入") {
          return await this.createBranch();
        } else {
          return { success: false, error: "取消创建" };
        }
      }

      // 步骤7: 确认创建
      const confirmed = await this.confirmBranchCreation(branchCreationOptions);
      if (!confirmed) {
        return { success: false, error: "用户取消创建" };
      }

      // 步骤8: 创建分支
      await this.createAndCheckoutBranch(branchName, baseBranch);

      return { success: true, branchName };
    } catch (error) {
      console.error("创建分支失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`创建分支失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}

