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

        if (description.length > 50) {
            return {
                isValid: false,
                error: '描述信息长度不能超过50个字符'
            };
        }

        // 检查是否包含非法字符
        const validPattern = /^[a-zA-Z0-9\u4e00-\u9fa5_-]+$/;
        if (!validPattern.test(description)) {
            return {
                isValid: false,
                error: '描述信息只能包含字母、数字、中文、下划线和短横线'
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

        // 检查是否包含连续斜杠
        if (branchName.includes('//')) {
            return {
                isValid: false,
                error: '分支名称不能包含连续斜杠'
            };
        }

        // 检查是否以斜杠开头或结尾
        if (branchName.startsWith('/') || branchName.endsWith('/')) {
            return {
                isValid: false,
                error: '分支名称不能以斜杠开头或结尾'
            };
        }

        // 检查是否包含空格
        if (branchName.includes(' ')) {
            return {
                isValid: false,
                error: '分支名称不能包含空格'
            };
        }

        // 检查是否包含其他Git不支持的字符
        const invalidChars = /[~^:?*[\]\\]/;
        if (invalidChars.test(branchName)) {
            return {
                isValid: false,
                error: '分支名称包含Git不支持的字符'
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
    }): string {
        const { prefix, description, username, date } = options;
        return `${prefix}/${date}/${description}_${username}`;
    }

    /**
     * 清理字符串，移除非法字符
     */
    static sanitizeString(str: string): string {
        return str.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '');
    }

    /**
     * 截断字符串到指定长度
     */
    static truncateString(str: string, maxLength: number): string {
        if (str.length <= maxLength) {
            return str;
        }
        return str.substring(0, maxLength);
    }
}

