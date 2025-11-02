import * as vscode from 'vscode';
import { GitMergeService } from './gitMergeService';
import { BranchCreator } from './branchCreator';
import { BranchConfigManager } from './branchConfigManager';

/**
 * 插件激活函数
 * @param context - VSCode扩展上下文
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Git工作流助手插件已激活');

    const branchConfigManager = new BranchConfigManager();
    const branchCreator = new BranchCreator(branchConfigManager);

    // 注册创建分支命令
    const createBranchCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.createBranch',
        async () => {
            try {
                await branchCreator.createBranch();
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                vscode.window.showErrorMessage(`创建分支失败: ${errorMessage}`);
            }
        }
    );

    // 注册合并功能分支命令
    const mergeFeatureBranchCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.mergeFeatureBranch',
        async () => {
            try {
                if (!vscode.workspace.workspaceFolders?.length) {
                    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
                    return;
                }
                const gitMergeService = new GitMergeService();
                await gitMergeService.mergeFeatureBranch();
            } catch (error: any) {
                const errorMessage = error?.message || '未知错误';
                vscode.window.showErrorMessage(`合并失败: ${errorMessage}`);
            }
        }
    );

    // 注册配置管理命令
    const manageConfigurationCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.manageConfiguration',
        async () => {
            try {
                if (!vscode.workspace.workspaceFolders?.length) {
                    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
                    return;
                }
                const gitMergeService = new GitMergeService();
                await gitMergeService.manageConfiguration();
            } catch (error: any) {
                const errorMessage = error?.message || '未知错误';
                vscode.window.showErrorMessage(`配置失败: ${errorMessage}`);
            }
        }
    );

    context.subscriptions.push(
        createBranchCommand,
        mergeFeatureBranchCommand,
        manageConfigurationCommand
    );
}

/**
 * 插件停用函数
 */
export function deactivate() {
    console.log('Git工作流助手插件已停用');
} 