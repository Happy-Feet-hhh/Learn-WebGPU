// high-score.ts - 分数显示
// 本文件实现了游戏分数的记录和屏幕显示。
// 使用精灵字体（Sprite Font）将分数文本渲染到游戏画面左上角。
// 当敌人被子弹击毁时，EnemyManager 会增加 currentScore 的值。

import { vec2 } from "wgpu-matrix";
import { SpriteRenderer } from "../core/sprite-renderer";
import { Content } from "../engine/content";

// HighScore 类 —— 分数管理器
export class HighScore
{
    // 当前得分，初始为 0
    // 每击毁一个敌人增加 10 分（由 EnemyManager 控制）
    public currentScore = 0;

    // 分数文本在屏幕上的显示位置（左上角，坐标 (10, 10)）
    private readonly position = vec2.fromValues(10, 10);

    // 绘制分数文本
    // 使用 SpriteRenderer 的 drawString 方法渲染精灵字体文本
    draw(spriteRenderer: SpriteRenderer)
    {
        spriteRenderer.drawString(
            // 精灵字体资源（包含数字和字母的纹理图集）
            Content.spriteFont,
            // 要显示的文本内容
            `Score: ${this.currentScore}`,
            // 文本左上角在屏幕上的位置
             this.position, 
            // 颜色覆盖（undefined 表示使用原始纹理颜色）
             undefined,
            // 文本缩放比例 0.5（即缩小为原始大小的一半）
             0.5);
    }
}
