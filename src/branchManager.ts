import * as vscode from "vscode";
import { GitOperations } from "./gitOperations";
import { BranchUtils } from "./branchUtils";

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
    return BranchUtils.validateBranchName(branchName).isValid;
  }

  /**
   * 检查当前分支是否为功能分支
   */
  async checkFeatureBranch(
    branchPrefixes: Array<{ prefix: string }>
  ): Promise<boolean> {
    try {
      const currentBranch = await this.gitOps.getCurrentBranch();
      return branchPrefixes.some((prefixConfig) =>
        currentBranch.toLowerCase().startsWith(prefixConfig.prefix.toLowerCase() + '/')
      );
    } catch {
      throw new Error("无法获取当前分支信息，请确保在Git仓库中操作");
    }
  }

  /**
   * 安全合并分支（带冲突处理）
   */
  async safeMergeBranch(
    targetBranch: string,
    sourceBranch: string,
    conflictHandler: (conflictFiles: string[]) => Promise<boolean>,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<boolean> {
    try {
      if (progress) {
        progress.report({ message: `检查远程分支 ${targetBranch}...`, increment: 5 });
      }
      
      const remoteExists = await this.gitOps.checkRemoteBranchExists(targetBranch);
      
      if (progress) {
        progress.report({ message: `切换到目标分支 ${targetBranch}...`, increment: 10 });
      }
      
      // 安全切换分支（如果本地不存在会从远程创建）
      await this.gitOps.checkoutBranch(targetBranch);
      
      // 如果远程分支存在，确保上游关联并拉取最新代码
      if (remoteExists) {
        if (progress) {
          progress.report({ message: `设置上游分支关联...`, increment: 5 });
        }
        await this.gitOps.ensureBranchUpstream(targetBranch);
        
        if (progress) {
          progress.report({ message: `拉取最新代码...`, increment: 10 });
        }
        await this.gitOps.pullBranch(targetBranch);
      }

      if (progress) {
        progress.report({ message: `合并 ${sourceBranch} 到 ${targetBranch}...`, increment: 30 });
      }
      
      try {
        await this.gitOps.mergeBranch(sourceBranch);
      } catch (mergeError) {
        const hasConflicts = await this.gitOps.checkMergeConflicts();
        if (hasConflicts) {
          if (progress) {
            progress.report({ message: `检测到合并冲突，等待处理...`, increment: 0 });
          }
          const conflictFiles = await this.gitOps.getConflictFiles();
          const resolved = await conflictHandler(conflictFiles);
          if (!resolved) {
            return false;
          }
        } else {
          throw mergeError;
        }
      }

      if (progress) {
        progress.report({ message: `推送合并结果到远程...`, increment: 20 });
      }
      
      if (remoteExists) {
        await this.gitOps.pushBranch(targetBranch);
      } else {
        try {
          await this.gitOps.pushBranch(targetBranch, true);
        } catch {
          // 推送失败忽略（可能是权限问题）
        }
      }
      
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
    if (exists) {
      await this.gitOps.ensureBranchUpstream(branchName);
    } else {
      await this.gitOps.pushBranch(branchName, true);
    }
  }
}
