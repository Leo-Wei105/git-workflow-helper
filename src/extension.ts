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

    // 初始化分支创建相关的管理器
    const branchConfigManager = new BranchConfigManager();
    const branchCreator = new BranchCreator(branchConfigManager);

    // 注册创建分支命令
    const createBranchCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.createBranch',
        async () => {
            try {
                await branchCreator.createBranch();
            } catch (error) {
                vscode.window.showErrorMessage(`创建分支失败: ${error}`);
            }
        }
    );

    // 注册管理分支前缀命令
    const managePrefixesCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.managePrefixes',
        async () => {
            try {
                await branchConfigManager.managePrefixes();
            } catch (error) {
                vscode.window.showErrorMessage(`管理前缀失败: ${error}`);
            }
        }
    );

    // 注册状态栏项
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.command = 'gitWorkflowHelper.createBranch';
    statusBarItem.text = '$(git-branch) 创建分支';
    statusBarItem.tooltip = '快速创建Git分支';
    statusBarItem.show();

    // 注册合并Feature分支命令
    const mergeFeatureBranchCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.mergeFeatureBranch',
        async () => {
            try {
                // 检查是否有工作区
                if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
                    return;
                }

                const gitMergeService = new GitMergeService();
                await gitMergeService.mergeFeatureBranch();
            } catch (error: any) {
                const errorMessage = error.message || '未知错误';
                vscode.window.showErrorMessage(`合并失败: ${errorMessage}`);
                console.error('合并失败:', error);
            }
        }
    );

    // 注册快速提交并合并命令
    const quickCommitAndMergeCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.quickCommitAndMerge',
        async () => {
            try {
                // 检查是否有工作区
                if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
                    return;
                }

                const gitMergeService = new GitMergeService();
                await gitMergeService.quickCommitAndMerge();
            } catch (error: any) {
                const errorMessage = error.message || '未知错误';
                vscode.window.showErrorMessage(`操作失败: ${errorMessage}`);
                console.error('操作失败:', error);
            }
        }
    );

    // 注册配置管理命令
    const manageConfigurationCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.manageConfiguration',
        async () => {
            try {
                // 检查是否有工作区
                if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
                    return;
                }

                const gitMergeService = new GitMergeService();
                await gitMergeService.manageConfiguration();
            } catch (error: any) {
                const errorMessage = error.message || '未知错误';
                vscode.window.showErrorMessage(`配置失败: ${errorMessage}`);
                console.error('配置失败:', error);
            }
        }
    );

    // 将命令添加到上下文订阅中
    context.subscriptions.push(
        createBranchCommand,
        managePrefixesCommand,
        mergeFeatureBranchCommand,
        quickCommitAndMergeCommand,
        manageConfigurationCommand,
        statusBarItem
    );

    // 只在有工作区时显示激活消息
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        vscode.window.showInformationMessage('Git工作流助手已准备就绪！');
    }
}

/**
 * 插件停用函数
 */
export function deactivate() {
    console.log('Git工作流助手插件已停用');
} 