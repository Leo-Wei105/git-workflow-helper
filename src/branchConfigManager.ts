import * as vscode from 'vscode';
import { BranchPrefix, BranchConfigurationSchema, DateFormat } from './branchTypes';
import { BranchUtils } from './branchUtils';

export class BranchConfigManager {
    private readonly configurationSection = 'gitWorkflowHelper';

    /**
     * 解析分支前缀字符串数组为 BranchPrefix 对象数组
     */
    private parseBranchPrefixes(prefixStrings: string[] | undefined): BranchPrefix[] {
        if (!prefixStrings || !Array.isArray(prefixStrings)) {
            return this.getDefaultPrefixes();
        }

        const prefixes = prefixStrings
            .filter((str): str is string => typeof str === 'string' && str.trim().length > 0)
            .map(prefix => ({ 
                prefix: prefix.trim(), 
                description: prefix.trim()
            }));

        return prefixes.length > 0 ? prefixes : this.getDefaultPrefixes();
    }

    /**
     * 将 BranchPrefix 对象数组序列化为字符串数组
     * 现在只是简单的字符串数组
     */
    private serializeBranchPrefixes(prefixes: BranchPrefix[]): string[] {
        return prefixes.map(p => p.prefix);
    }

    /**
     * 获取配置（合并项目级和全局级）
     */
    getConfiguration(): BranchConfigurationSchema {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        const prefixStrings = config.get<string[]>('branchPrefixes');
        
        return {
            branchPrefixes: this.parseBranchPrefixes(prefixStrings),
            customGitName: config.get<string>('customGitName') || '',
            dateFormat: (config.get<string>('dateFormat') || 'yyyyMMdd') as DateFormat,
            autoCheckout: config.get<boolean>('autoCheckout') ?? true
        };
    }

    /**
     * 获取项目级配置
     */
    getWorkspaceConfiguration(): BranchConfigurationSchema {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        const prefixInspect = config.inspect<string[]>('branchPrefixes');
        const prefixStrings = prefixInspect?.workspaceValue ?? prefixInspect?.defaultValue;
        
        return {
            branchPrefixes: this.parseBranchPrefixes(prefixStrings),
            customGitName: config.inspect<string>('customGitName')?.workspaceValue ?? config.inspect<string>('customGitName')?.defaultValue ?? '',
            dateFormat: (config.inspect<string>('dateFormat')?.workspaceValue ?? config.inspect<string>('dateFormat')?.defaultValue ?? 'yyyyMMdd') as DateFormat,
            autoCheckout: config.inspect<boolean>('autoCheckout')?.workspaceValue ?? config.inspect<boolean>('autoCheckout')?.defaultValue ?? true
        };
    }

    /**
     * 获取全局级配置
     */
    getGlobalConfiguration(): BranchConfigurationSchema {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        const prefixInspect = config.inspect<string[]>('branchPrefixes');
        const prefixStrings = prefixInspect?.globalValue ?? prefixInspect?.defaultValue;
        
        return {
            branchPrefixes: this.parseBranchPrefixes(prefixStrings),
            customGitName: config.inspect<string>('customGitName')?.globalValue ?? config.inspect<string>('customGitName')?.defaultValue ?? '',
            dateFormat: (config.inspect<string>('dateFormat')?.globalValue ?? config.inspect<string>('dateFormat')?.defaultValue ?? 'yyyyMMdd') as DateFormat,
            autoCheckout: config.inspect<boolean>('autoCheckout')?.globalValue ?? config.inspect<boolean>('autoCheckout')?.defaultValue ?? true
        };
    }

    /**
     * 获取默认前缀配置
     */
    private getDefaultPrefixes(): BranchPrefix[] {
        return ["feature", "feat", "bugfix", "hotfix", "fix"].map(prefix => ({
            prefix,
            description: prefix
        }));
    }

    /**
     * 获取分支前缀列表
     */
    getBranchPrefixes(): BranchPrefix[] {
        const config = this.getConfiguration();
        return config.branchPrefixes;
    }

    /**
     * 获取默认分支前缀（返回第一个）
     */
    getDefaultPrefix(): BranchPrefix | undefined {
        return this.getBranchPrefixes()[0];
    }

    /**
     * 更新分支前缀配置
     */
    async updateBranchPrefixes(prefixes: BranchPrefix[], target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        const prefixStrings = this.serializeBranchPrefixes(prefixes);
        await config.update('branchPrefixes', prefixStrings, target);
    }

    /**
     * 添加分支前缀
     */
    async addBranchPrefix(prefix: string, description: string, isDefault: boolean = false, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
        const validation = BranchUtils.validatePrefix(prefix);
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        const prefixes = target === vscode.ConfigurationTarget.Workspace 
            ? this.getWorkspaceConfiguration().branchPrefixes 
            : this.getGlobalConfiguration().branchPrefixes;
        
        if (prefixes.some(p => p.prefix === prefix)) {
            throw new Error('分支前缀已存在');
        }

        prefixes.push({ prefix, description: description || prefix });
        await this.updateBranchPrefixes(prefixes, target);
    }

    /**
     * 删除分支前缀
     */
    async removeBranchPrefix(prefix: string, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
        const prefixes = target === vscode.ConfigurationTarget.Workspace 
            ? this.getWorkspaceConfiguration().branchPrefixes 
            : this.getGlobalConfiguration().branchPrefixes;
        const index = prefixes.findIndex(p => p.prefix === prefix);
        
        if (index === -1) {
            throw new Error('分支前缀不存在');
        }

        prefixes.splice(index, 1);
        await this.updateBranchPrefixes(prefixes, target);
    }

    /**
     * 重置配置为默认值
     */
    async resetConfiguration(target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        const defaultPrefixStrings = this.serializeBranchPrefixes(this.getDefaultPrefixes());
        await config.update('branchPrefixes', defaultPrefixStrings, target);
        await config.update('customGitName', '', target);
        await config.update('dateFormat', 'yyyyMMdd', target);
        await config.update('autoCheckout', true, target);
    }

}

