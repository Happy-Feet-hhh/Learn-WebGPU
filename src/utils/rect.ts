/**
 * Rect - 矩形区域描述类
 *
 * 使用左上角坐标 (x, y) 和尺寸 (width, height) 定义一个轴对齐的矩形（AABB）。
 * 常用于表示游戏对象的位置和边界、碰撞检测区域、精灵的绘制范围等。
 *
 * 坐标系：与 Camera 一致，(0,0) 为屏幕左上角，y 轴向下递增
 */
export class Rect 
{
    /**
     * @param x      - 矩形左上角的 x 坐标
     * @param y      - 矩形左上角的 y 坐标
     * @param width  - 矩形的宽度
     * @param height - 矩形的高度
     */
    constructor(public x: number,public y: number,public width: number, public height: number) 
    {
    }

    /**
     * 创建当前矩形的一个副本（深拷贝）。
     * 返回一个新的 Rect 实例，具有相同的 x、y、width、height 值。
     * 用于在需要修改矩形参数但不影响原始数据的场景。
     */
    public copy(): Rect 
    {
        return new Rect(this.x, this.y, this.width, this.height);
    }
}
