import { DateFormat, ValidationResult } from './branchTypes';

export class BranchUtils {
    /**
     * 根据格式生成日期字符串
     */
    static formatDate(date: Date, format: DateFormat): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        switch (format) {
            case 'yyyyMMdd':
                return `${year}${month}${day}`;
            case 'yyyy-MM-dd':
                return `${year}-${month}-${day}`;
            case 'yyMMdd':
                return `${String(year).slice(2)}${month}${day}`;
            default:
                return `${year}${month}${day}`;
        }
    }

    /**
     * 验证分支描述信息
     */
    static validateDescription(description: string): ValidationResult {
        if (!description || description.trim().length === 0) {
            return {
                isValid: false,
                error: '描述信息不能为空'
            };
        }

        return {
            isValid: true
        };
    }

    /**
     * 验证分支前缀
     */
    static validatePrefix(prefix: string): ValidationResult {
        if (!prefix || prefix.trim().length === 0) {
            return {
                isValid: false,
                error: '分支前缀不能为空'
            };
        }

        // 检查是否包含特殊字符
        const validPattern = /^[a-zA-Z0-9_-]+$/;
        if (!validPattern.test(prefix)) {
            return {
                isValid: false,
                error: '分支前缀只能包含字母、数字、下划线和短横线'
            };
        }

        return {
            isValid: true
        };
    }

    /**
     * 验证分支名称
     */
    static validateBranchName(branchName: string): ValidationResult {
        if (!branchName || branchName.trim().length === 0) {
            return {
                isValid: false,
                error: '分支名称不能为空'
            };
        }

        return {
            isValid: true
        };
    }

    /**
     * 生成分支名称
     */
    static generateBranchName(options: {
        prefix: string;
        description: string;
        username: string;
        date: string;
        format?: string;
    }): string {
        const { prefix, description, username, date, format } = options;
        const template = format && format.trim().length > 0
            ? format
            : '{prefix}/{date}/{description}_{username}';

        return template
            .replace(/\{prefix\}/g, prefix)
            .replace(/\{date\}/g, date)
            .replace(/\{description\}/g, description)
            .replace(/\{username\}/g, username);
    }
}

