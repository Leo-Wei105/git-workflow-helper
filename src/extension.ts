import * as vscode from 'vscode';
import { BranchConfigManager } from './branchConfigManager';
import { BranchCreator } from './branchCreator';
import { AppError, isUserCancelledError, toAppError } from './errors';
import { GitMergeService } from './gitMergeService';

async function selectWorkspaceRoot(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new AppError('请先打开一个工作区文件夹', 'INVALID_WORKSPACE', { stage: 'selectWorkspaceRoot' });
    }

    if (workspaceFolders.length === 1) {
        return workspaceFolders[0].uri.fsPath;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
        if (activeFolder) {
            return activeFolder.uri.fsPath;
        }
    }

    const selected = await vscode.window.showQuickPick(
        workspaceFolders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            fsPath: folder.uri.fsPath
        })),
        {
            placeHolder: '检测到多个工作区，请选择要操作的 Git 仓库'
        }
    );

    if (!selected) {
        throw AppError.userCancelled('未选择工作区，操作已取消');
    }

    return selected.fsPath;
}

function handleCommandError(action: string, error: unknown): void {
    const appError = toAppError(error, '未知错误');
    if (isUserCancelledError(appError)) {
        vscode.window.showInformationMessage(`已取消${action}: ${appError.message}`);
        return;
    }
    const stageText = appError.stage ? ` [${appError.stage}]` : '';
    vscode.window.showErrorMessage(`${action}失败${stageText}: ${appError.message}`);
}

/**
 * 插件激活函数
 * @param context - VSCode扩展上下文
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Git工作流助手插件已激活');

    // 注册创建分支命令
    const createBranchCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.createBranch',
        async () => {
            try {
                const workspaceRoot = await selectWorkspaceRoot();
                const branchConfigManager = new BranchConfigManager();
                const branchCreator = new BranchCreator(branchConfigManager, workspaceRoot);
                await branchCreator.createBranch();
            } catch (error: any) {
                handleCommandError('创建分支', error);
            }
        }
    );

    // 注册合并功能分支命令
    const mergeFeatureBranchCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.mergeFeatureBranch',
        async () => {
            try {
                const workspaceRoot = await selectWorkspaceRoot();
                const gitMergeService = new GitMergeService(workspaceRoot);
                await gitMergeService.mergeFeatureBranch();
            } catch (error: any) {
                handleCommandError('合并', error);
            }
        }
    );

    // 注册配置管理命令
    const manageConfigurationCommand = vscode.commands.registerCommand(
        'gitWorkflowHelper.manageConfiguration',
        async () => {
            try {
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    '@ext:Leo-Wei105.git-workflow-helper'
                );
            } catch (error: any) {
                handleCommandError('配置', error);
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