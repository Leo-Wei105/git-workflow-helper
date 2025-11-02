import * as vscode from 'vscode';
import { BranchPrefix, BranchConfigurationSchema, DateFormat } from './branchTypes';
import { BranchUtils } from './branchUtils';

export class BranchConfigManager {
    private readonly configurationSection = 'gitWorkflowHelper';

    /**
     * 获取配置
     */
    getConfiguration(): BranchConfigurationSchema {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        
        return {
            branchPrefixes: config.get<BranchPrefix[]>('branchPrefixes') || this.getDefaultPrefixes(),
            customGitName: config.get<string>('customGitName') || '',
            dateFormat: (config.get<string>('dateFormat') || 'yyyyMMdd') as DateFormat,
            autoCheckout: config.get<boolean>('autoCheckout') !== undefined ? config.get<boolean>('autoCheckout')! : true
        };
    }

    /**
     * 获取默认前缀配置
     */
    private getDefaultPrefixes(): BranchPrefix[] {
        return [
            {
                prefix: "feature",
                description: "功能分支",
                isDefault: true
            },
            {
                prefix: "feat",
                description: "功能分支简写",
                isDefault: false
            },
            {
                prefix: "bugfix",
                description: "修复分支",
                isDefault: false
            },
            {
                prefix: "hotfix",
                description: "热修复分支",
                isDefault: false
            },
            {
                prefix: "fix",
                description: "修复分支简写",
                isDefault: false
            }
        ];
    }

    /**
     * 获取分支前缀列表
     */
    getBranchPrefixes(): BranchPrefix[] {
        const config = this.getConfiguration();
        return config.branchPrefixes;
    }

    /**
     * 获取默认分支前缀
     */
    getDefaultPrefix(): BranchPrefix | undefined {
        const prefixes = this.getBranchPrefixes();
        return prefixes.find(p => p.isDefault) || prefixes[0];
    }

    /**
     * 更新分支前缀配置
     */
    async updateBranchPrefixes(prefixes: BranchPrefix[]): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        await config.update('branchPrefixes', prefixes, vscode.ConfigurationTarget.Global);
    }

    /**
     * 添加分支前缀
     */
    async addBranchPrefix(prefix: string, description: string, isDefault: boolean = false): Promise<void> {
        const validation = BranchUtils.validatePrefix(prefix);
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        const prefixes = this.getBranchPrefixes();
        
        // 检查是否已存在
        if (prefixes.some(p => p.prefix === prefix)) {
            throw new Error('分支前缀已存在');
        }

        // 如果设置为默认，取消其他默认设置
        if (isDefault) {
            prefixes.forEach(p => p.isDefault = false);
        }

        prefixes.push({
            prefix,
            description,
            isDefault
        });

        await this.updateBranchPrefixes(prefixes);
    }

    /**
     * 删除分支前缀
     */
    async removeBranchPrefix(prefix: string): Promise<void> {
        const prefixes = this.getBranchPrefixes();
        const index = prefixes.findIndex(p => p.prefix === prefix);
        
        if (index === -1) {
            throw new Error('分支前缀不存在');
        }

        prefixes.splice(index, 1);
        
        // 如果删除的是默认前缀，设置第一个为默认
        if (prefixes.length > 0 && !prefixes.some(p => p.isDefault)) {
            prefixes[0].isDefault = true;
        }

        await this.updateBranchPrefixes(prefixes);
    }

    /**
     * 设置默认分支前缀
     */
    async setDefaultPrefix(prefix: string): Promise<void> {
        const prefixes = this.getBranchPrefixes();
        
        // 取消所有默认设置
        prefixes.forEach(p => p.isDefault = false);
        
        // 设置新的默认
        const targetPrefix = prefixes.find(p => p.prefix === prefix);
        if (targetPrefix) {
            targetPrefix.isDefault = true;
        } else {
            throw new Error('分支前缀不存在');
        }

        await this.updateBranchPrefixes(prefixes);
    }

    /**
     * 重置配置为默认值
     */
    async resetConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        await config.update('branchPrefixes', this.getDefaultPrefixes(), vscode.ConfigurationTarget.Global);
        await config.update('customGitName', '', vscode.ConfigurationTarget.Global);
        await config.update('dateFormat', 'yyyyMMdd', vscode.ConfigurationTarget.Global);
        await config.update('autoCheckout', true, vscode.ConfigurationTarget.Global);
    }

    /**
     * 管理分支前缀的交互式界面
     */
    async managePrefixes(): Promise<void> {
        const actions = [
            '添加新前缀',
            '删除前缀',
            '设置默认前缀',
            '重置为默认配置'
        ];

        const selectedAction = await vscode.window.showQuickPick(actions, {
            placeHolder: '选择要执行的操作'
        });

        if (!selectedAction) {
            return;
        }

        switch (selectedAction) {
            case '添加新前缀':
                await this.addPrefixInteractive();
                break;
            case '删除前缀':
                await this.removePrefixInteractive();
                break;
            case '设置默认前缀':
                await this.setDefaultPrefixInteractive();
                break;
            case '重置为默认配置':
                await this.resetConfigurationInteractive();
                break;
        }
    }

    /**
     * 交互式添加前缀
     */
    private async addPrefixInteractive(): Promise<void> {
        const prefix = await vscode.window.showInputBox({
            prompt: '输入分支前缀',
            placeHolder: '例如：feature, bugfix, hotfix',
            validateInput: (value) => {
                const validation = BranchUtils.validatePrefix(value);
                return validation.isValid ? null : validation.error;
            }
        });

        if (!prefix) {
            return;
        }

        const description = await vscode.window.showInputBox({
            prompt: '输入前缀描述',
            placeHolder: '例如：功能分支, 修复分支'
        });

        if (!description) {
            return;
        }

        const isDefault = await vscode.window.showQuickPick(['是', '否'], {
            placeHolder: '是否设为默认前缀？'
        });

        try {
            await this.addBranchPrefix(prefix, description, isDefault === '是');
            vscode.window.showInformationMessage(`成功添加分支前缀: ${prefix}`);
        } catch (error) {
            vscode.window.showErrorMessage(`添加前缀失败: ${error}`);
        }
    }

    /**
     * 交互式删除前缀
     */
    private async removePrefixInteractive(): Promise<void> {
        const prefixes = this.getBranchPrefixes();
        const items = prefixes.map(p => ({
            label: p.prefix,
            description: p.description,
            detail: p.isDefault ? '默认' : ''
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要删除的前缀'
        });

        if (!selected) {
            return;
        }

        try {
            await this.removeBranchPrefix(selected.label);
            vscode.window.showInformationMessage(`成功删除分支前缀: ${selected.label}`);
        } catch (error) {
            vscode.window.showErrorMessage(`删除前缀失败: ${error}`);
        }
    }

    /**
     * 交互式设置默认前缀
     */
    private async setDefaultPrefixInteractive(): Promise<void> {
        const prefixes = this.getBranchPrefixes();
        const items = prefixes.map(p => ({
            label: p.prefix,
            description: p.description,
            detail: p.isDefault ? '当前默认' : ''
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择默认前缀'
        });

        if (!selected) {
            return;
        }

        try {
            await this.setDefaultPrefix(selected.label);
            vscode.window.showInformationMessage(`成功设置默认前缀: ${selected.label}`);
        } catch (error) {
            vscode.window.showErrorMessage(`设置默认前缀失败: ${error}`);
        }
    }

    /**
     * 交互式重置配置
     */
    private async resetConfigurationInteractive(): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            '确定要重置为默认配置吗？这将删除所有自定义配置。',
            '确定',
            '取消'
        );

        if (confirmed !== '确定') {
            return;
        }

        try {
            await this.resetConfiguration();
            vscode.window.showInformationMessage('配置已重置为默认值');
        } catch (error) {
            vscode.window.showErrorMessage(`重置配置失败: ${error}`);
        }
    }
}

