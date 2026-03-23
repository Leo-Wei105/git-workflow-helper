import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { AppError } from "./errors";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
      throw AppError.gitFailed(`Git命令执行失败: ${errorMessage}`, "execGitCommand", error);
    }
  }

  /**
   * 使用参数数组执行Git命令，避免命令注入和转义问题
   */
  async execGitArgs(args: string[]): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: this.workspaceRoot,
        encoding: "utf8",
      });

      if (stderr && !stderr.includes("warning")) {
        console.warn("Git命令警告:", stderr);
      }

      return stdout.trim();
    } catch (error: any) {
      const errorMessage = error.stderr || error.message || "未知错误";
      const renderedArgs = args.join(" ");
      throw AppError.gitFailed(
        `Git命令执行失败(git ${renderedArgs}): ${errorMessage}`,
        "execGitArgs",
        error
      );
    }
  }

  /**
   * 检查Git仓库状态
   */
  async checkGitRepository(): Promise<boolean> {
    try {
      await this.execGitArgs(["status"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前分支名
   */
  async getCurrentBranch(): Promise<string> {
    return await this.execGitArgs(["branch", "--show-current"]);
  }

  /**
   * 检查是否有未提交的更改
   */
  async checkUncommittedChanges(): Promise<boolean> {
    const status = await this.execGitArgs(["status", "--porcelain"]);
    return status.length > 0;
  }

  /**
   * 检查是否存在合并冲突
   */
  async checkMergeConflicts(): Promise<boolean> {
    try {
      const status = await this.execGitArgs(["status", "--porcelain"]);
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
      const status = await this.execGitArgs([
        "diff",
        "--name-only",
        "--diff-filter=U",
      ]);
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
      const remoteBranch = await this.execGitArgs([
        "ls-remote",
        "--heads",
        "origin",
        branchName,
      ]);
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
    const args = setUpstream
      ? ["push", "-u", "origin", branchName]
      : ["push", "origin", branchName];
    await this.execGitArgs(args);
  }

  /**
   * 检查本地分支是否存在
   */
  async checkLocalBranchExists(branchName: string): Promise<boolean> {
    try {
      await this.execGitArgs(["show-ref", "--verify", `refs/heads/${branchName}`]);
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
      await this.execGitArgs(["checkout", branchName]);
    } else {
      // 检查远程是否存在
      const remoteExists = await this.checkRemoteBranchExists(branchName);
      if (remoteExists) {
        // 从远程创建本地分支并切换
        await this.execGitArgs([
          "checkout",
          "-b",
          branchName,
          `origin/${branchName}`,
        ]);
      } else {
        // 如果本地和远程都不存在，尝试创建新分支
        await this.execGitArgs(["checkout", "-b", branchName]);
      }
    }
  }

  /**
   * 拉取远程分支
   */
  async pullBranch(branchName: string): Promise<void> {
    await this.execGitArgs(["pull", "origin", branchName]);
  }

  /**
   * 合并分支
   */
  async mergeBranch(sourceBranch: string): Promise<void> {
    await this.execGitArgs(["merge", sourceBranch]);
  }

  /**
   * 提交更改
   */
  async commitChanges(message: string): Promise<void> {
    await this.execGitArgs(["add", "."]);
    await this.execGitArgs(["commit", "-m", message]);
  }

  /**
   * 中止合并
   */
  async abortMerge(): Promise<void> {
    await this.execGitArgs(["merge", "--abort"]);
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

      const upstream = await this.execGitArgs([
        "rev-parse",
        "--abbrev-ref",
        `${branchName}@{upstream}`,
      ]).catch(() => null);
      
      if (upstream !== `origin/${branchName}`) {
        await this.execGitArgs([
          "branch",
          `--set-upstream-to=origin/${branchName}`,
          branchName,
        ]);
      }
    } catch (error: any) {
      if (error.message?.includes("no upstream")) {
        const remoteExists = await this.checkRemoteBranchExists(branchName);
        if (remoteExists) {
          await this.execGitArgs([
            "branch",
            `--set-upstream-to=origin/${branchName}`,
            branchName,
          ]);
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
