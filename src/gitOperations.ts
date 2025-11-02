import { exec } from "child_process";
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
      return false;
    }
  }

  /**
   * 推送分支到远程
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
   * 检查本地分支是否存在
   */
  async checkLocalBranchExists(branchName: string): Promise<boolean> {
    try {
      await this.execGitCommand(`git rev-parse --verify ${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 切换分支（如果本地不存在则从远程创建）
   */
  async checkoutBranch(branchName: string): Promise<void> {
    const localExists = await this.checkLocalBranchExists(branchName);
    
    if (localExists) {
      await this.execGitCommand(`git checkout ${branchName}`);
    } else {
      // 检查远程是否存在
      const remoteExists = await this.checkRemoteBranchExists(branchName);
      if (remoteExists) {
        // 从远程创建本地分支并切换
        await this.execGitCommand(`git checkout -b ${branchName} origin/${branchName}`);
      } else {
        // 如果本地和远程都不存在，尝试创建新分支
        await this.execGitCommand(`git checkout -b ${branchName}`);
      }
    }
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
      const remoteExists = await this.checkRemoteBranchExists(branchName);
      if (!remoteExists) {
        return;
      }

      const upstream = await this.execGitCommand(
        `git rev-parse --abbrev-ref ${branchName}@{upstream}`
      ).catch(() => null);
      
      if (upstream !== `origin/${branchName}`) {
        await this.execGitCommand(
          `git branch --set-upstream-to=origin/${branchName} ${branchName}`
        );
      }
    } catch (error: any) {
      if (error.message?.includes("no upstream")) {
        const remoteExists = await this.checkRemoteBranchExists(branchName);
        if (remoteExists) {
          await this.execGitCommand(
            `git branch --set-upstream-to=origin/${branchName} ${branchName}`
          );
        }
      }
    }
  }

  /**
   * 获取工作区根目录
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}
