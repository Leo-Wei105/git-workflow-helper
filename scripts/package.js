#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

/**
 * 交互式打包脚本
 * 支持选择版本升级类型和输入发布说明
 */
class InteractivePackager {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    /**
     * 询问用户问题
     * @param {string} question - 问题文本
     * @returns {Promise<string>} 用户输入
     */
    question(question) {
        return new Promise((resolve) => {
            this.rl.question(question, resolve);
        });
    }

    /**
     * 显示当前版本信息
     */
    showCurrentVersion() {
        const packagePath = path.join(__dirname, '../package.json');
        const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        console.log(`📦 当前版本: ${packageData.version}`);
        console.log(`📝 项目名称: ${packageData.displayName || packageData.name}`);
        console.log('');
    }

    /**
     * 选择版本升级类型
     * @returns {Promise<string>} 版本升级类型
     */
    async selectVersionType() {
        console.log('🚀 请选择版本升级类型:');
        console.log('1. patch (修复版本, 如: 1.0.0 -> 1.0.1)');
        console.log('2. minor (功能版本, 如: 1.0.0 -> 1.1.0)');
        console.log('3. major (重大版本, 如: 1.0.0 -> 2.0.0)');
        console.log('');

        const choice = await this.question('请输入选择 (1/2/3) [默认: 1]: ');

        switch (choice.trim()) {
            case '2':
                return 'minor';
            case '3':
                return 'major';
            case '1':
            case '':
            default:
                return 'patch';
        }
    }

    /**
     * 输入发布说明
     * @returns {Promise<string>} 发布说明
     */
    async inputReleaseNotes() {
        console.log('📝 请输入本次发布的主要更改 (可选，直接回车跳过):');
        const notes = await this.question('发布说明: ');
        return notes.trim();
    }

    /**
     * 确认打包
     * @param {string} versionType - 版本类型
     * @param {string} releaseNotes - 发布说明
     * @returns {Promise<boolean>} 是否确认
     */
    async confirmPackage(versionType, releaseNotes) {
        console.log('');
        console.log('📋 打包信息确认:');
        console.log(`   版本升级类型: ${versionType}`);
        console.log(`   发布说明: ${releaseNotes || '(无)'}`);
        console.log('');

        const confirm = await this.question('确认开始打包? (y/N): ');
        return confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes';
    }

    /**
     * 执行打包流程
     * @param {string} versionType - 版本类型
     * @param {string} releaseNotes - 发布说明
     */
    async executePackage(versionType, releaseNotes) {
        try {
            console.log('');
            console.log('🔄 开始打包流程...');

            // 1. 升级版本
            console.log('📦 升级版本号...');
            const versionCmd = releaseNotes
                ? `node scripts/version-bump.js ${versionType} "${releaseNotes}"`
                : `node scripts/version-bump.js ${versionType}`;
            execSync(versionCmd, { stdio: 'inherit' });

            // 2. 编译代码
            console.log('🔨 编译TypeScript代码...');
            execSync('npm run compile', { stdio: 'inherit' });

            // 3. 打包插件
            console.log('📦 生成VSIX包...');
            execSync('npx vsce package', { stdio: 'inherit' });

            console.log('');
            console.log('✅ 打包完成！');
            console.log('📁 生成的包文件位于项目根目录');
            console.log('🚀 您可以通过VSCode安装此包进行测试');

        } catch (error) {
            console.error('❌ 打包失败:', error.message);
            process.exit(1);
        }
    }

    /**
     * 运行交互式打包流程
     */
    async run() {
        try {
            console.log('🎯 Git合并助手 - 交互式打包工具');
            console.log('=====================================');
            console.log('');

            this.showCurrentVersion();

            const versionType = await this.selectVersionType();
            const releaseNotes = await this.inputReleaseNotes();

            const confirmed = await this.confirmPackage(versionType, releaseNotes);

            if (confirmed) {
                await this.executePackage(versionType, releaseNotes);
            } else {
                console.log('❌ 打包已取消');
            }

        } catch (error) {
            console.error('❌ 发生错误:', error.message);
        } finally {
            this.rl.close();
        }
    }
}

// 检查是否有命令行参数（非交互模式）
const args = process.argv.slice(2);
if (args.length > 0) {
    // 非交互模式，直接执行
    const versionType = args[0] || 'patch';
    const releaseNotes = args.slice(1).join(' ');

    console.log(`🚀 自动打包模式: ${versionType}`);

    const packager = new InteractivePackager();
    packager.executePackage(versionType, releaseNotes).then(() => {
        packager.rl.close();
    });
} else {
    // 交互模式
    const packager = new InteractivePackager();
    packager.run();
} 