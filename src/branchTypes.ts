export interface BranchPrefix {
    prefix: string;
    description: string;
    isDefault: boolean;
}

export interface BranchCreationOptions {
    prefix: string;
    baseBranch: string;
    description: string;
    username: string;
    date: string;
}

export interface GitBranch {
    name: string;
    current: boolean;
    isRemote: boolean;
    commit: string;
}

export interface ValidationResult {
    isValid: boolean;
    error?: string;
}

export interface BranchCreationResult {
    success: boolean;
    branchName?: string;
    error?: string;
}

export interface BranchConfigurationSchema {
    branchPrefixes: BranchPrefix[];
    customGitName: string;
    dateFormat: string;
    autoCheckout: boolean;
}

export type DateFormat = 'yyyyMMdd' | 'yyyy-MM-dd' | 'yyMMdd';

