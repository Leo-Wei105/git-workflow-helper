#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 版本升级脚本
 * 支持自动升级版本号并更新CHANGELOG
 */
class VersionBumper {
    constructor() {
        this.packagePath = path.join(__dirname, '../package.json');
        this.changelogPath = path.join(__dirname, '../CHANGELOG.md');
    }

    /**
     * 读取package.json文件
     * @returns {Object} package.json内容
     */
    readPackageJson() {
        const content = fs.readFileSync(this.packagePath, 'utf8');
        return JSON.parse(content);
    }

    /**
     * 写入package.json文件
     * @param {Object} packageData - package.json数据
     */
    writePackageJson(packageData) {
        const content = JSON.stringify(packageData, null, 2);
        fs.writeFileSync(this.packagePath, content + '\n');
    }

    /**
     * 读取CHANGELOG.md文件
     * @returns {string} CHANGELOG内容
     */
    readChangelog() {
        if (!fs.existsSync(this.changelogPath)) {
            return '';
        }
        return fs.readFileSync(this.changelogPath, 'utf8');
    }

    /**
     * 写入CHANGELOG.md文件
     * @param {string} content - CHANGELOG内容
     */
    writeChangelog(content) {
        fs.writeFileSync(this.changelogPath, content);
    }

    /**
     * 升级版本号
     * @param {string} currentVersion - 当前版本
     * @param {string} type - 升级类型 (patch|minor|major)
     * @returns {string} 新版本号
     */
    bumpVersion(currentVersion, type = 'patch') {
        const [major, minor, patch] = currentVersion.split('.').map(Number);

        switch (type) {
            case 'major':
                return `${major + 1}.0.0`;
            case 'minor':
                return `${major}.${minor + 1}.0`;
            case 'patch':
            default:
                return `${major}.${minor}.${patch + 1}`;
        }
    }

    /**
     * 获取当前日期字符串
     * @returns {string} 格式化的日期字符串
     */
    getCurrentDate() {
        const now = new Date();
        return now.toISOString().split('T')[0];
    }

    /**
     * 更新CHANGELOG
     * @param {string} newVersion - 新版本号
     * @param {string} releaseNotes - 发布说明
     */
    updateChangelog(newVersion, releaseNotes = '') {
        let changelog = this.readChangelog();
        const currentDate = this.getCurrentDate();

        // 如果没有CHANGELOG文件，创建基础结构
        if (!changelog) {
            changelog = `# 更新日志

所有重要的项目更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增
- 待添加的新功能

### 修改
- 待修改的功能

### 修复
- 待修复的问题

`;
        }

        // 查找[未发布]部分并替换为新版本
        const unreleasedPattern = /## \[未发布\]([\s\S]*?)(?=## \[|$)/;
        const match = changelog.match(unreleasedPattern);

        if (match) {
            const unreleasedContent = match[1].trim();
            let newVersionSection = `## [${newVersion}] - ${currentDate}`;

            if (releaseNotes) {
                newVersionSection += `\n\n### 更新\n- ${releaseNotes}`;
            } else if (unreleasedContent && unreleasedContent !== '' && !unreleasedContent.includes('待添加的新功能')) {
                newVersionSection += `\n${unreleasedContent}`;
            } else {
                newVersionSection += `\n\n### 修改\n- 版本升级和功能优化`;
            }

            // 替换[未发布]部分为新版本，并添加新的[未发布]部分
            const newUnreleasedSection = `## [未发布]

### 新增
- 待添加的新功能

### 修改
- 待修改的功能

### 修复
- 待修复的问题

${newVersionSection}`;

            changelog = changelog.replace(unreleasedPattern, newUnreleasedSection);
        }

        this.writeChangelog(changelog);
    }

    /**
     * 执行版本升级
     * @param {string} type - 升级类型
     * @param {string} releaseNotes - 发布说明
     */
    bump(type = 'patch', releaseNotes = '') {
        try {
            console.log(`🚀 开始执行${type}版本升级...`);

            // 读取当前版本
            const packageData = this.readPackageJson();
            const currentVersion = packageData.version;
            const newVersion = this.bumpVersion(currentVersion, type);

            console.log(`📦 版本升级: ${currentVersion} -> ${newVersion}`);

            // 更新package.json
            packageData.version = newVersion;
            this.writePackageJson(packageData);

            // 更新CHANGELOG
            this.updateChangelog(newVersion, releaseNotes);

            console.log(`✅ 版本升级完成！`);
            console.log(`📝 请检查CHANGELOG.md并根据需要调整发布说明`);

            return newVersion;
        } catch (error) {
            console.error('❌ 版本升级失败:', error.message);
            process.exit(1);
        }
    }
}

// 命令行参数处理
const args = process.argv.slice(2);
const type = args[0] || 'patch';
const releaseNotes = args.slice(1).join(' ');

// 验证升级类型
if (!['patch', 'minor', 'major'].includes(type)) {
    console.error('❌ 无效的升级类型。请使用: patch, minor, 或 major');
    process.exit(1);
}

// 执行版本升级
const bumper = new VersionBumper();
bumper.bump(type, releaseNotes); 