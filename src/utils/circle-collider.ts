// circle-collider.ts - 圆形碰撞检测器
// 使用圆形包围盒进行碰撞检测，适用于近似圆形的游戏对象（如飞船、UFO）
// 相比 AABB（轴对齐包围盒），圆形碰撞检测旋转不变性更好

import { Rect } from "./rect";

export class CircleCollider 
{
    // 碰撞圆的半径
    public radius: number = 0;

    // 碰撞圆的中心坐标
    public x: number = 0;
    public y: number = 0;

    // 根据绘制矩形更新碰撞圆的参数
    // 取矩形较短边的一半作为半径，确保圆完全包含在矩形内
    update(drawRect: Rect)
    {
        // 默认取宽度的一半作为半径
        let radius = drawRect.width / 2;

        // 如果高度比宽度小，则使用高度的一半
        // 这样取较小值，保证碰撞圆不会超出精灵的实际范围
        if(drawRect.height < drawRect.width)
        {
            radius = drawRect.height / 2;
        }

        // 碰撞圆中心 = 矩形左上角 + 半径偏移（即矩形中心）
        this.x = drawRect.x + this.radius;
        this.y = drawRect.y + this.radius;
        this.radius = radius;
    }

    // 检测两个圆形碰撞器是否相交
    // 算法：两圆心之间的距离 < 两圆半径之和 → 碰撞
    // 数学公式：sqrt((x1-x2)² + (y1-y2)²) < r1 + r2
    public intersects(other: CircleCollider): boolean
    {
        // 计算两圆心的坐标差
        const dx = this.x - other.x;
        const dy = this.y - other.y;

        // 计算两圆心的欧几里得距离
        const d = Math.sqrt(dx * dx + dy * dy);

        // 两圆半径之和：如果圆心距离小于此值，则两圆重叠
        const r = this.radius + other.radius;
        return d < r;
    }
}
