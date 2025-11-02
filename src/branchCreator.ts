import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import {
  BranchPrefix,
  BranchCreationOptions,
  BranchCreationResult,
  GitBranch,
  DateFormat,
} from "./branchTypes";
import { BranchConfigManager } from "./branchConfigManager";
import { BranchUtils } from "./branchUtils";

const execAsync = promisify(exec);

export class BranchCreator {
  private configManager: BranchConfigManager;

  constructor(configManager: BranchConfigManager) {
    this.configManager = configManager;
  }

  /**
   * 获取工作区根目录
   */
  private getWorkspaceRoot(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("请先打开一个工作区");
    }
    return workspaceFolder.uri.fsPath;
  }

  /**
   * 执行Git命令
   */
  private async executeGitCommand(command: string): Promise<string> {
    const workspaceRoot = this.getWorkspaceRoot();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRoot,
      });
      if (stderr && !stderr.includes("warning")) {
        console.warn("Git命令警告:", stderr);
      }
      return stdout.trim();
    } catch (error: any) {
      console.error("Git命令失败:", error);
      throw new Error(`Git命令执行失败: ${error.message}`);
    }
  }

  /**
   * 检查是否为Git仓库
   */
  private async isGitRepository(): Promise<boolean> {
    try {
      await this.executeGitCommand("git rev-parse --git-dir");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取Git用户名
   */
  private async getGitUsername(): Promise<string> {
    const config = this.configManager.getConfiguration();

    // 如果设置了自定义用户名，使用自定义用户名
    if (config.customGitName) {
      return config.customGitName;
    }

    // 否则从Git配置获取
    try {
      const username = await this.executeGitCommand("git config user.name");
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

      // 获取当前分支
      let currentBranch = "";
      try {
        currentBranch = await this.executeGitCommand(
          "git branch --show-current"
        );
      } catch {
        // 如果获取当前分支失败，可能是在detached HEAD状态
        currentBranch = "";
      }

      // 获取本地分支
      const localBranchOutput = await this.executeGitCommand(
        'git branch --format="%(refname:short)|%(objectname:short)"'
      );
      if (localBranchOutput) {
        const localBranches = localBranchOutput
          .split("\n")
          .filter((line) => line.trim());
        localBranches.forEach((line) => {
          const [name, commit] = line.split("|");
          if (name && name.trim()) {
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
        const remoteBranchOutput = await this.executeGitCommand(
          'git branch -r --format="%(refname:short)|%(objectname:short)"'
        );
        if (remoteBranchOutput) {
          const remoteBranches = remoteBranchOutput
            .split("\n")
            .filter((line) => line.trim());
          remoteBranches.forEach((line) => {
            const [name, commit] = line.split("|");
            if (name && name.trim() && !name.includes("HEAD")) {
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
      await this.executeGitCommand(`git rev-parse --verify ${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否为远程分支
   */
  private isRemoteBranch(branchName: string): boolean {
    // 远程分支通常以 origin/ 或其他远程名称开头
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
        // 创建并切换到新分支
        await this.executeGitCommand(
          `git checkout -b ${branchName} ${baseBranch}`
        );
        vscode.window.showInformationMessage(
          `成功创建分支: ${branchName} (已自动切换)`
        );
      } else {
        // 仅创建分支，不切换
        await this.executeGitCommand(`git branch ${branchName} ${baseBranch}`);
        vscode.window.showInformationMessage(`成功创建分支: ${branchName}`);
      }

      // 如果基分支是远程分支，取消新分支的上游分支设置
      // 这样新分支就不会关联到远程分支，直到用户主动推送
      if (isRemoteBaseBranch) {
        try {
          await this.executeGitCommand(
            `git branch --unset-upstream ${branchName}`
          );
          console.log(`已取消分支 ${branchName} 的远程关联`);
        } catch (error) {
          // 如果取消上游分支失败，记录警告但不影响主流程
          console.warn(`取消分支 ${branchName} 远程关联失败:`, error);
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
    try {
      await this.executeGitCommand(`git checkout ${branchName}`);
      vscode.window.showInformationMessage(`已切换到分支: ${branchName}`);
    } catch (error) {
      throw new Error(`切换分支失败: ${error}`);
    }
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
      description: prefix.description,
      detail: prefix.isDefault ? "默认" : "",
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
      "确认",
      "取消"
    );

    return confirmed === "确认";
  }

  /**
   * 主要的分支创建流程
   */
  async createBranch(): Promise<BranchCreationResult> {
    try {
      // 检查是否为Git仓库
      const isGitRepo = await this.isGitRepository();
      if (!isGitRepo) {
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

